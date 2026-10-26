import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import type { Config } from '../config';
import { ApiError, type UserRow } from '../http';
import type { ChannelRow } from './permissions';
import { computeChannelPermissions, canViewChannel } from './permissions';
import { Perm, has } from '../../shared/permissions';
import { newId } from '../util/ids';
import { toUser, parseJson } from '../repos/users';
import { serializeMessages, getMessageRow, type MessageRow } from '../repos/messages';
import { toChannel } from '../repos/servers';
import { grantAchievement } from './achievements';
import { notify } from './notifications';
import type { Channel, Message, User } from '../../shared/types';

export const MESSAGES_MAX_CONTENT = 4_000;
export const MESSAGES_MAX_ENCRYPTED = 8_000;
export const MESSAGES_MAX_ATTACHMENTS = 10;

/** Typing throttle: one broadcast per user/channel per 3 seconds. */
const typingThrottle = new Map<string, number>();
const TYPING_INTERVAL_MS = 3_000;

export function messages_typingAllowed(channelId: string, userId: string): boolean {
  const key = `${channelId}:${userId}`;
  const now = Date.now();
  const last = typingThrottle.get(key) ?? 0;
  if (now - last < TYPING_INTERVAL_MS) return false;
  typingThrottle.set(key, now);
  if (typingThrottle.size > 20_000) {
    for (const [k, at] of typingThrottle) if (now - at > TYPING_INTERVAL_MS * 4) typingThrottle.delete(k);
  }
  return true;
}

export interface ParsedMentions {
  users: string[];
  roles: string[];
  channels: string[];
  everyone: boolean;
}

export interface CreateMessageInput {
  channelId: string;
  authorId: string;
  content: string;
  type?: string;
  replyToId?: string | null;
  attachmentIds?: string[];
  poll?: { question: string; options: string[]; multiple?: boolean; durationHours?: number } | null;
  tts?: boolean;
  encrypted?: boolean;
  cryptoMeta?: unknown;
  stickerId?: string | null;
  nonce?: string | null;
  mentions?: ParsedMentions | null;
  flags?: Record<string, unknown>;
  /** System/webhook/seed callers bypass permission-style gates (timeout/locked/slowmode/upload ownership). */
  skipChecks?: boolean;
  createdAt?: number;
}

export function messages_channelDto(row: ChannelRow): Channel {
  return toChannel(row);
}

export function messages_canAccessChannel(db: DatabaseWrapper, userId: string, channel: ChannelRow, isAdmin = false): boolean {
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    return !!db.get('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', channel.id, userId);
  }
  if (isAdmin) return true;
  return canViewChannel(db, userId, channel);
}

export function messages_channelsForViewer(db: DatabaseWrapper, userId: string): ChannelRow[] {
  const rows = db.all<ChannelRow>(
    `SELECT c.* FROM channels c
     WHERE (c.server_id IS NOT NULL AND EXISTS (SELECT 1 FROM members m WHERE m.server_id = c.server_id AND m.user_id = ?))
        OR (c.server_id IS NULL AND EXISTS (SELECT 1 FROM dm_members d WHERE d.channel_id = c.id AND d.user_id = ?))`,
    userId, userId,
  );
  return rows.filter((c) => messages_canAccessChannel(db, userId, c));
}

export function messages_canReadChannel(db: DatabaseWrapper, userId: string, channel: ChannelRow, isAdmin = false): boolean {
  if (!messages_canAccessChannel(db, userId, channel, isAdmin)) return false;
  if (channel.type === 'dm' || channel.type === 'group_dm') return true;
  if (isAdmin) return true;
  return has(computeChannelPermissions(db, userId, channel), Perm.READ_MESSAGE_HISTORY);
}

export function messages_sendPermission(channel: ChannelRow): number {
  return channel.type === 'thread' ? Perm.SEND_IN_THREADS : Perm.SEND_MESSAGES;
}

/** Throws when the actor cannot post right now. Permission bits themselves are checked by the route. */
export function messages_gateSend(db: DatabaseWrapper, channel: ChannelRow, actor: UserRow, permissions: number, opts: { skipChecks?: boolean } = {}): void {
  if (opts.skipChecks) return;
  const admin = !!actor.is_admin || has(permissions, Perm.ADMINISTRATOR);
  if (channel.type !== 'dm' && channel.type !== 'group_dm') {
    if (channel.archived && channel.type === 'thread' && !has(permissions, Perm.MANAGE_THREADS) && !admin) {
      throw new ApiError(403, 'THREAD_ARCHIVED', 'This thread is archived. Necromancy is a moderator-only feature.');
    }
    if (channel.locked && !admin) {
      const bypass = channel.type === 'thread' ? Perm.MANAGE_THREADS : Perm.MANAGE_MESSAGES;
      if (!has(permissions, bypass)) {
        throw new ApiError(403, channel.type === 'thread' ? 'THREAD_LOCKED' : 'CHANNEL_LOCKED', 'This channel is locked. Take it up with the janitor.');
      }
    }
    const member = channel.server_id
      ? db.get<{ timeout_until: number | null }>('SELECT timeout_until FROM members WHERE server_id = ? AND user_id = ?', channel.server_id, actor.id)
      : null;
    if (member?.timeout_until && member.timeout_until > Date.now() && !admin) {
      throw new ApiError(403, 'MEMBER_TIMED_OUT', `You are timed out until ${new Date(member.timeout_until).toISOString()}. Sit in the corner.`);
    }
  }
  if (channel.slowmode > 0 && !admin && !has(permissions, Perm.MANAGE_MESSAGES)) {
    const last = db.get<{ created_at: number }>(
      "SELECT created_at FROM messages WHERE channel_id = ? AND author_id = ? AND deleted_at IS NULL AND type = 'default' ORDER BY created_at DESC LIMIT 1",
      channel.id, actor.id,
    );
    if (last && Date.now() - last.created_at < channel.slowmode * 1000) {
      const wait = Math.ceil((channel.slowmode * 1000 - (Date.now() - last.created_at)) / 1000);
      throw new ApiError(429, 'SLOWMODE', `Slowmode is on. Try again in ${wait}s, speed demon.`);
    }
  }
}

const CUSTOM_EMOJI_INLINE_RE = /<a?:([a-z0-9_\-]{2,32}):([a-z0-9_]{4,64})>/gi;

/** Custom emoji tokens in message content must exist and be usable by the author. */
export function messages_validateInlineEmojis(db: DatabaseWrapper, content: string, channel: ChannelRow, permissions: number): void {
  for (const match of content.matchAll(CUSTOM_EMOJI_INLINE_RE)) {
    const id = match[2]!;
    const emoji = db.get<{ id: string; server_id: string | null }>('SELECT id, server_id FROM emojis WHERE id = ?', id);
    if (!emoji) throw new ApiError(400, 'INVALID_EMOJI', `Custom emoji ${match[0]} does not exist. Stop inventing slop.`);
    if (!emoji.server_id) continue;
    if (channel.type === 'dm' || channel.type === 'group_dm') continue;
    if (emoji.server_id === channel.server_id) continue;
    if (!has(permissions, Perm.EXTERNAL_EMOJIS) && !has(permissions, Perm.ADMINISTRATOR)) {
      throw new ApiError(400, 'INVALID_EMOJI', 'That emoji lives in another server. You need EXTERNAL_EMOJIS to steal it.');
    }
  }
}

export function messages_validatePoll(poll: unknown): { question: string; options: string[]; multiple: boolean; closesAt: number | null } {
  if (!poll || typeof poll !== 'object' || Array.isArray(poll)) throw new ApiError(400, 'INVALID_POLL', 'Poll payload is cooked.');
  const raw = poll as { question?: unknown; options?: unknown; multiple?: unknown; durationHours?: unknown };
  const question = String(raw.question ?? '').trim();
  if (question.length < 1 || question.length > 300) throw new ApiError(400, 'INVALID_POLL', 'Poll question must be 1-300 characters.');
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 10) {
    throw new ApiError(400, 'INVALID_POLL', 'Polls need 2-10 options. Democracy has limits.');
  }
  const options = raw.options.map((o) => String(o ?? '').trim());
  if (options.some((o) => o.length < 1 || o.length > 100)) throw new ApiError(400, 'INVALID_POLL', 'Each poll option must be 1-100 characters.');
  const seen = new Set<string>();
  for (const o of options) {
    if (seen.has(o.toLowerCase())) throw new ApiError(400, 'INVALID_POLL', 'Duplicate poll option. Pick something original.');
    seen.add(o.toLowerCase());
  }
  let closesAt: number | null = null;
  if (raw.durationHours !== undefined && raw.durationHours !== null) {
    const hours = Number(raw.durationHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 336) throw new ApiError(400, 'INVALID_POLL', 'Poll duration must be 1-336 hours.');
    closesAt = Date.now() + Math.floor(hours) * 3_600_000;
  }
  return { question, options, multiple: raw.multiple === true, closesAt };
}

const USER_MENTION_RE = /<@!?([a-z0-9_]{4,64})>/gi;
const ROLE_MENTION_RE = /<@&([a-z0-9_]{4,64})>/gi;
const CHANNEL_MENTION_RE = /<#([a-z0-9_]{4,64})>/gi;
const EVERYONE_RE = /(^|[\s(.,!?])@(everyone|here)\b/gi;

export function messages_parseMentions(
  db: DatabaseWrapper,
  content: string,
  channel: ChannelRow,
  author: UserRow,
  permissions: number,
): ParsedMentions {
  const out: ParsedMentions = { users: [], roles: [], channels: [], everyone: false };
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const canEveryone = !isDm && (!!author.is_admin || has(permissions, Perm.ADMINISTRATOR) || has(permissions, Perm.MENTION_EVERYONE));
  for (const m of content.matchAll(EVERYONE_RE)) {
    if (m[2]) {
      if (!canEveryone) throw new ApiError(403, 'MISSING_PERMISSIONS', 'Pinging @everyone without permission? Bold. Denied.');
      out.everyone = true;
    }
  }
  const userIds = new Set<string>();
  for (const m of content.matchAll(USER_MENTION_RE)) {
    const id = m[1]!;
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    if (!user) continue;
    if (isDm) {
      if (!db.get('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', channel.id, id)) continue;
    } else if (!messages_canAccessChannel(db, id, channel)) continue;
    userIds.add(id);
  }
  const roleIds = new Set<string>();
  for (const m of content.matchAll(ROLE_MENTION_RE)) {
    if (!channel.server_id) continue;
    const role = db.get<{ id: string; mentionable: number; permissions: number }>('SELECT id, mentionable, permissions FROM roles WHERE id = ? AND server_id = ?', m[1]!, channel.server_id);
    if (!role) continue;
    roleIds.add(role.id);
  }
  const channelIds = new Set<string>();
  for (const m of content.matchAll(CHANNEL_MENTION_RE)) {
    if (!channel.server_id) continue;
    const target = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ? AND server_id = ?', m[1]!, channel.server_id);
    if (!target) continue;
    if (!messages_canAccessChannel(db, author.id, target)) continue;
    channelIds.add(target.id);
  }
  out.users = [...userIds];
  out.roles = [...roleIds];
  out.channels = [...channelIds];
  return out;
}

export function messages_insertMentions(db: DatabaseWrapper, messageId: string, mentions: ParsedMentions): void {
  for (const id of mentions.users) db.run('INSERT OR IGNORE INTO message_mentions (message_id, mention_type, target_id) VALUES (?, \'user\', ?)', messageId, id);
  for (const id of mentions.roles) db.run('INSERT OR IGNORE INTO message_mentions (message_id, mention_type, target_id) VALUES (?, \'role\', ?)', messageId, id);
  for (const id of mentions.channels) db.run('INSERT OR IGNORE INTO message_mentions (message_id, mention_type, target_id) VALUES (?, \'channel\', ?)', messageId, id);
  if (mentions.everyone) db.run('INSERT OR IGNORE INTO message_mentions (message_id, mention_type, target_id) VALUES (?, \'everyone\', NULL)', messageId);
}

export function messages_incrementMention(db: DatabaseWrapper, userId: string, channelId: string): void {
  const now = Date.now();
  db.run(
    `INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, NULL, 1, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET mention_count = mention_count + 1, updated_at = excluded.updated_at`,
    userId, channelId, now,
  );
}

export function messages_markRead(db: DatabaseWrapper, userId: string, channelId: string, lastReadId: string | null): void {
  const now = Date.now();
  db.run(
    `INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id, mention_count = 0, updated_at = excluded.updated_at`,
    userId, channelId, lastReadId, now,
  );
  db.run('UPDATE dm_members SET last_read_id = ? WHERE channel_id = ? AND user_id = ?', lastReadId, channelId, userId);
}

interface UploadRow {
  id: string; owner_id: string; purpose: string; filename: string; content_type: string; size: number;
  path: string; sha256: string; width: number | null; height: number | null; message_id: string | null; created_at: number;
}

export function messages_attachUploads(db: DatabaseWrapper, messageId: string, authorId: string, ids: string[], skipOwnership = false): void {
  if (!ids.length) return;
  if (ids.length > MESSAGES_MAX_ATTACHMENTS) throw new ApiError(400, 'TOO_MANY_ATTACHMENTS', `Max ${MESSAGES_MAX_ATTACHMENTS} attachments per message. This is not a fileserver.`);
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'DUPLICATE_ATTACHMENT', 'The same upload twice? Bold, but no.');
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const upload = db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', id);
    if (!upload) throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'That upload evaporated.');
    if (!skipOwnership && upload.owner_id !== authorId) throw new ApiError(403, 'NOT_YOUR_UPLOAD', 'That upload belongs to someone else. Hands off.');
    if (upload.purpose !== 'attachment') throw new ApiError(400, 'INVALID_ATTACHMENT', 'That upload was not made for attaching to a message.');
    if (upload.message_id) throw new ApiError(409, 'ATTACHMENT_ALREADY_USED', 'That upload is already attached to a message.');
    db.run(
      `INSERT INTO attachments (id, message_id, filename, content_type, size, path, width, height, spoiler, alt, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      upload.id, messageId, upload.filename, upload.content_type, upload.size, upload.path,
      upload.width, upload.height, upload.sha256, Date.now(),
    );
    db.run('UPDATE uploads SET message_id = ? WHERE id = ?', messageId, upload.id);
  }
}

export function messages_addKarma(db: DatabaseWrapper, userId: string, delta: number): number {
  if (delta !== 0) db.run('UPDATE users SET karma = karma + ? WHERE id = ?', delta, userId);
  return db.get<{ karma: number }>('SELECT karma FROM users WHERE id = ?', userId)?.karma ?? 0;
}

export function messages_applyVote(db: DatabaseWrapper, message: MessageRow, userId: string, value: -1 | 0 | 1): { score: number; myVote: -1 | 0 | 1; karma: number } {
  const existing = db.get<{ value: number }>('SELECT value FROM votes WHERE message_id = ? AND user_id = ?', message.id, userId);
  const previous = (existing?.value ?? 0) as -1 | 0 | 1;
  const delta = value - previous;
  if (delta !== 0) {
    if (value === 0) db.run('DELETE FROM votes WHERE message_id = ? AND user_id = ?', message.id, userId);
    else db.run(
      `INSERT INTO votes (message_id, user_id, value, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
      message.id, userId, value, Date.now(),
    );
    db.run('UPDATE messages SET score = score + ? WHERE id = ?', delta, message.id);
  }
  const score = db.get<{ score: number }>('SELECT score FROM messages WHERE id = ?', message.id)?.score ?? message.score;
  const karma = messages_addKarma(db, message.author_id, delta);
  return { score, myVote: value, karma };
}

export function messages_voteAchievements(db: DatabaseWrapper, hub: Hub | null, message: MessageRow, score: number, karma: number): void {
  if (karma >= 100) grantAchievement(db, hub, message.author_id, 'based');
  if (score <= -10) grantAchievement(db, hub, message.author_id, 'ratio');
}

export function messages_postAchievements(db: DatabaseWrapper, hub: Hub | null, authorId: string, createdAt: number, encrypted: boolean): void {
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE author_id = ? AND deleted_at IS NULL', authorId)?.n ?? 0;
  if (count === 1) grantAchievement(db, hub, authorId, 'first_message');
  if (count >= 100) grantAchievement(db, hub, authorId, 'shitposter');
  const hour = new Date(createdAt).getHours();
  if (hour >= 2 && hour < 5) grantAchievement(db, hub, authorId, 'night_owl');
  if (encrypted) grantAchievement(db, hub, authorId, 'e2ee');
}

export function messages_notifyParticipants(
  db: DatabaseWrapper,
  hub: Hub | null,
  channel: ChannelRow,
  message: Message,
  author: UserRow,
  mentions: ParsedMentions,
  replyToAuthorId: string | null,
): void {
  const recipients = new Map<string, 'mention' | 'reply'>();
  const add = (userId: string, kind: 'mention' | 'reply') => {
    if (userId === author.id) return;
    if (recipients.get(userId) === 'mention') return;
    recipients.set(userId, kind);
  };
  for (const id of mentions.users) add(id, 'mention');
  if (channel.server_id) {
    for (const roleId of mentions.roles) {
      for (const m of db.all<{ user_id: string }>(
        'SELECT mr.user_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ? AND mr.role_id = ? AND r.mentionable = 1 LIMIT 200',
        channel.server_id, roleId,
      )) add(m.user_id, 'mention');
    }
    if (mentions.everyone) {
      for (const m of db.all<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = ? LIMIT 1000', channel.server_id)) add(m.user_id, 'mention');
    }
  }
  if (replyToAuthorId) add(replyToAuthorId, 'reply');
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const body = message.encrypted ? '[encrypted message]' : message.content.slice(0, 120) || '[attachment]';
  for (const [userId, kind] of recipients) {
    if (db.get('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', userId, author.id)) continue;
    if (!messages_canAccessChannel(db, userId, channel)) continue;
    notify(db, hub, {
      userId,
      type: kind,
      title: kind === 'mention' ? `${author.display_name} mentioned you in #${channel.name}` : `${author.display_name} replied to you in #${channel.name}`,
      body,
      serverId: channel.server_id,
      channelId: channel.id,
      messageId: message.id,
      actorId: author.id,
    });
    if (!isDm) messages_incrementMention(db, userId, channel.id);
  }
}

export function messages_serializeOne(db: DatabaseWrapper, messageId: string, viewerId: string): Message {
  const row = getMessageRow(db, messageId);
  if (!row) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message fell into the slop pit.');
  return serializeMessages(db, [row], viewerId)[0]!;
}

function messages_jsonFlags(input: CreateMessageInput): string {
  const flags: Record<string, unknown> = { ...(input.flags ?? {}) };
  if (input.nonce) flags.nonce = input.nonce;
  if (input.stickerId) flags.stickerId = input.stickerId;
  return JSON.stringify(flags);
}

export function createMessage(db: DatabaseWrapper, hub: Hub | null, input: CreateMessageInput, config: Config): Message {
  void config;
  const channel = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', input.channelId);
  if (!channel) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel fell into the slop pit.');
  const author = db.get<UserRow>('SELECT * FROM users WHERE id = ?', input.authorId);
  if (!author) throw new ApiError(404, 'USER_NOT_FOUND', 'Author does not exist. Ghost posting?');

  if (input.nonce) {
    const existing = db.get<MessageRow>(
      'SELECT * FROM messages WHERE channel_id = ? AND author_id = ? AND json_extract(flags, \'$.nonce\') = ? LIMIT 1',
      channel.id, input.authorId, input.nonce,
    );
    if (existing) return serializeMessages(db, [existing], input.authorId)[0]!;
  }

  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const encrypted = !!input.encrypted;
  if (encrypted && !isDm) throw new ApiError(400, 'ENCRYPTION_NOT_ALLOWED', 'End-to-end encrypted messages are DM-only. Server channels are public slop.');
  const content = typeof input.content === 'string' ? input.content : '';
  const max = encrypted ? MESSAGES_MAX_ENCRYPTED : MESSAGES_MAX_CONTENT;
  if (content.length > max) throw new ApiError(400, 'CONTENT_TOO_LONG', `Message must be at most ${max} characters.`);
  if (content.includes('\u0000')) throw new ApiError(400, 'INVALID_CONTENT', 'NUL bytes are not allowed in messages.');
  const attachmentIds = input.attachmentIds ?? [];
  const hasPayload = content.trim().length > 0 || attachmentIds.length > 0 || !!input.poll || !!input.stickerId;
  if (!hasPayload) throw new ApiError(400, 'EMPTY_MESSAGE', 'Empty message. Say something, coward.');

  let reply: MessageRow | null = null;
  if (input.replyToId) {
    reply = getMessageRow(db, input.replyToId);
    if (!reply || reply.deleted_at) throw new ApiError(404, 'REPLY_NOT_FOUND', 'You cannot reply to a message that does not exist.');
    if (reply.channel_id !== channel.id) throw new ApiError(400, 'REPLY_WRONG_CHANNEL', 'Replies must stay in the same channel. Travel bans exist.');
  }

  if (input.stickerId) {
    const sticker = db.get<{ id: string; server_id: string | null }>('SELECT id, server_id FROM stickers WHERE id = ?', input.stickerId);
    if (!sticker) throw new ApiError(404, 'STICKER_NOT_FOUND', 'That sticker is not a thing.');
    if (sticker.server_id && sticker.server_id !== channel.server_id) throw new ApiError(403, 'STICKER_FORBIDDEN', 'That sticker belongs to another server.');
  }

  const poll = input.poll ? messages_validatePoll(input.poll) : null;
  const permissions = input.skipChecks
    ? 0x7fffffff
    : channel.server_id
      ? computeChannelPermissions(db, input.authorId, channel)
      : 0x7fffffff;
  if (!input.skipChecks) {
    if (channel.server_id && !has(permissions, messages_sendPermission(channel))) {
      throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot send messages here. The audacity.');
    }
    messages_gateSend(db, channel, author, permissions, { skipChecks: input.skipChecks });
  }
  if (!encrypted) messages_validateInlineEmojis(db, content, channel, permissions);
  const mentions = input.mentions && typeof input.mentions === 'object'
    ? input.mentions
    : encrypted
      ? { users: [], roles: [], channels: [], everyone: false }
      : messages_parseMentions(db, content, channel, author, permissions);

  const id = newId('m');
  const createdAt = input.createdAt ?? Date.now();
  const type = input.type ?? 'default';
  const flags = messages_jsonFlags(input);
  const cryptoMeta = input.cryptoMeta === undefined || input.cryptoMeta === null
    ? null
    : typeof input.cryptoMeta === 'string' ? input.cryptoMeta : JSON.stringify(input.cryptoMeta);

  db.transaction(() => {
    db.run(
      `INSERT INTO messages (id, channel_id, server_id, author_id, content, type, reply_to_id, pinned, pinned_at, pinned_by,
        edited_at, deleted_at, deleted_by, tts, encrypted, crypto_meta, score, flags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 0, ?, ?)`,
      id, channel.id, channel.server_id, input.authorId, content, type, reply?.id ?? null,
      input.tts ? 1 : 0, encrypted ? 1 : 0, cryptoMeta, flags, createdAt,
    );
    if (poll) {
      const pollId = newId('poll');
      db.run('INSERT INTO polls (id, message_id, question, multiple, closes_at) VALUES (?, ?, ?, ?, ?)', pollId, id, poll.question, poll.multiple ? 1 : 0, poll.closesAt);
      poll.options.forEach((label, index) => {
        db.run('INSERT INTO poll_options (id, poll_id, label, position) VALUES (?, ?, ?, ?)', newId('po'), pollId, label, index);
      });
    }
    if (attachmentIds.length) messages_attachUploads(db, id, input.authorId, attachmentIds, input.skipChecks);
    messages_insertMentions(db, id, mentions);
    db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', id, channel.id);
    messages_markRead(db, input.authorId, channel.id, id);
  });

  const message = messages_serializeOne(db, id, input.authorId);
  hub?.broadcastChannel(channel.id, 'MESSAGE_CREATE', { message });
  if (!encrypted) {
    messages_notifyParticipants(db, hub, channel, message, author, mentions, reply?.author_id ?? null);
  }
  messages_postAchievements(db, hub, input.authorId, createdAt, encrypted);
  return message;
}

// ---- search ----

function search_ftsQuery(q: string): string | null {
  const tokens = (q.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 12);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}

function search_likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

function search_bound(column: string, op: '<' | '>', raw: string): { sql: string; param: string | number } {
  return /^\d{10,}$/.test(raw)
    ? { sql: `${column.replace(/\.id$/, '.created_at')} ${op} ?`, param: Number(raw) }
    : { sql: `${column} ${op} ?`, param: raw };
}

export interface SearchParams {
  q: string;
  serverId?: string | null;
  channelId?: string | null;
  authorId?: string | null;
  has?: 'image' | 'file' | 'link' | null;
  before?: string | null;
  after?: string | null;
  limit?: number;
  offset?: number;
}

export function search_accessibleChannelIds(
  db: DatabaseWrapper,
  userId: string,
  params: { serverId?: string | null; channelId?: string | null },
  isAdmin = false,
): string[] {
  const readable = (channel: ChannelRow) => messages_canReadChannel(db, userId, channel, isAdmin);
  if (params.channelId) {
    const channel = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', params.channelId);
    if (!channel) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel fell into the slop pit.');
    if (!readable(channel)) throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot search a channel you cannot read. Nice try.');
    return [channel.id];
  }
  const candidates = isAdmin
    ? db.all<ChannelRow>(
      'SELECT * FROM channels WHERE server_id IS NOT NULL OR id IN (SELECT channel_id FROM dm_members WHERE user_id = ?)',
      userId,
    )
    : messages_channelsForViewer(db, userId);
  if (params.serverId) {
    if (!isAdmin && !db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', params.serverId, userId)) {
      throw new ApiError(403, 'MISSING_PERMISSIONS', 'You are not in that server, so its messages are not yours to search.');
    }
    return candidates.filter((c) => c.server_id === params.serverId && readable(c)).map((c) => c.id);
  }
  const ids: string[] = [];
  for (const channel of candidates) {
    if (!db.get('SELECT 1 FROM channels WHERE id = ?', channel.id)) continue;
    if (readable(channel)) ids.push(channel.id);
  }
  return ids;
}

export function search_messages(db: DatabaseWrapper, viewerId: string, params: SearchParams, viewerIsAdmin = false): { messages: Message[]; total: number; took: number } {
  const started = Date.now();
  const q = String(params.q ?? '').trim();
  if (!q) throw new ApiError(400, 'EMPTY_QUERY', 'Search needs an actual query. Words. Letters. Something.');
  if (q.length > 200) throw new ApiError(400, 'QUERY_TOO_LONG', 'Search query is too long (max 200).');
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));
  const offset = Math.max(0, params.offset ?? 0);
  const channelIds = search_accessibleChannelIds(db, viewerId, { serverId: params.serverId, channelId: params.channelId }, viewerIsAdmin);
  if (!channelIds.length) return { messages: [], total: 0, took: Date.now() - started };

  const where: string[] = ['m.deleted_at IS NULL', 'm.encrypted = 0'];
  const filterParams: unknown[] = [];
  where.push(`m.channel_id IN (${channelIds.map(() => '?').join(',')})`);
  filterParams.push(...channelIds);
  if (params.authorId) { where.push('m.author_id = ?'); filterParams.push(params.authorId); }
  if (params.before) { const b = search_bound('m.id', '<', params.before); where.push(b.sql); filterParams.push(b.param); }
  if (params.after) { const a = search_bound('m.id', '>', params.after); where.push(a.sql); filterParams.push(a.param); }
  if (params.has === 'image') where.push("EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%')");
  else if (params.has === 'file') where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)');
  else if (params.has === 'link') where.push("(m.content LIKE '%http://%' OR m.content LIKE '%https://%' OR m.content LIKE '%www.%')");

  const ftsQuery = search_ftsQuery(q);
  let rows: MessageRow[] = [];
  let total = 0;
  if (ftsQuery) {
    try {
      const clause = where.join(' AND ');
      const count = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages m JOIN messages_fts ON messages_fts.rowid = m.rowid WHERE messages_fts MATCH ? AND ${clause}`,
        ftsQuery, ...filterParams,
      );
      total = count?.n ?? 0;
      rows = db.all<MessageRow>(
        `SELECT m.* FROM messages m JOIN messages_fts ON messages_fts.rowid = m.rowid WHERE messages_fts MATCH ? AND ${clause} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
        ftsQuery, ...filterParams, limit, offset,
      );
    } catch {
      rows = [];
      total = -1;
    }
  }
  if (!ftsQuery || total < 0) {
    where.push("m.content LIKE ? ESCAPE '\\'");
    filterParams.push(search_likePattern(q));
    const clause = where.join(' AND ');
    total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM messages m WHERE ${clause}`, ...filterParams)?.n ?? 0;
    rows = db.all<MessageRow>(`SELECT m.* FROM messages m WHERE ${clause} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...filterParams, limit, offset);
  }
  return { messages: serializeMessages(db, rows, viewerId), total, took: Date.now() - started };
}

// ---- forums ----

export interface ForumPost {
  thread: Channel;
  firstMessage: Message;
  replyCount: number;
  score: number;
  lastActivityAt: number;
  participants: User[];
}

export interface ForumListParams {
  sort: 'hot' | 'new' | 'top';
  tag: string | null;
  includeArchived: boolean;
  limit: number;
  offset: number;
}

export function forum_listPosts(db: DatabaseWrapper, channel: ChannelRow, viewerId: string, params: ForumListParams): { posts: ForumPost[]; hasMore: boolean } {
  const where = ["t.type = 'thread'", 't.parent_id = ?'];
  const queryParams: unknown[] = [channel.id];
  if (!params.includeArchived) where.push('t.archived = 0');
  if (params.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(t.tags) WHERE json_each.value = ?)');
    queryParams.push(params.tag);
  }
  const threads = db.all<ChannelRow>(`SELECT t.* FROM channels t WHERE ${where.join(' AND ')}`, ...queryParams);
  const now = Date.now();
  const posts: ForumPost[] = [];
  for (const thread of threads) {
    const firstRow = thread.origin_message_id
      ? getMessageRow(db, thread.origin_message_id)
      : db.get<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1', thread.id);
    if (!firstRow || firstRow.deleted_at) continue;
    const replyCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND id != ? AND deleted_at IS NULL', thread.id, firstRow.id)?.n ?? 0;
    const lastAt = db.get<{ at: number | null }>('SELECT MAX(created_at) AS at FROM messages WHERE channel_id = ? AND deleted_at IS NULL', thread.id)?.at;
    const authorRows = db.all<{ author_id: string }>('SELECT DISTINCT author_id FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 5', thread.id);
    const participants: User[] = [];
    for (const a of authorRows) {
      const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', a.author_id);
      if (user) participants.push(toUser(user));
    }
    posts.push({
      thread: toChannel(thread),
      firstMessage: serializeMessages(db, [firstRow], viewerId)[0]!,
      replyCount,
      score: firstRow.score,
      lastActivityAt: lastAt ?? thread.created_at,
      participants,
    });
  }
  const sort = params.sort;
  posts.sort((a, b) => {
    if (sort === 'new') return b.thread.createdAt - a.thread.createdAt || b.lastActivityAt - a.lastActivityAt;
    if (sort === 'top') return b.score - a.score || b.lastActivityAt - a.lastActivityAt || b.thread.createdAt - a.thread.createdAt;
    const hot = (p: ForumPost) => (p.score + p.replyCount * 2 + 1) / Math.pow(Math.max(0.25, (now - p.lastActivityAt) / 3_600_000) + 2, 0.6);
    return hot(b) - hot(a) || b.lastActivityAt - a.lastActivityAt;
  });
  const limited = posts.slice(params.offset, params.offset + params.limit);
  return { posts: limited, hasMore: posts.length > params.offset + params.limit };
}

export function forum_createPostTags(channel: ChannelRow, tags: unknown): string[] {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags)) throw new ApiError(400, 'INVALID_TAGS', 'Tags must be an array.');
  const allowed = parseJson<string[]>(channel.tags, []);
  const out: string[] = [];
  for (const raw of tags.slice(0, 5)) {
    const tag = String(raw ?? '').trim();
    if (!tag) continue;
    if (!allowed.includes(tag)) throw new ApiError(400, 'INVALID_TAG', `Tag "${tag}" is not allowed on this forum.`);
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}


export function messages_normalizeReaction(db: DatabaseWrapper, raw: string, channel: ChannelRow, userId: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const wrapped = value.match(/^<a?:([a-z0-9_\-]{2,32}):([a-z0-9_]{4,64})>$/i);
  const bare = value.match(/^(?:a?:)?([a-z0-9_\-]{2,32}):([a-z0-9_]{4,64})$/i);
  if (wrapped || bare) {
    const match = wrapped ?? bare!;
    const id = match[2]!;
    const emoji = db.get<{ id: string; server_id: string | null }>('SELECT id, server_id FROM emojis WHERE id = ?', id);
    if (!emoji) return null;
    if (emoji.server_id && emoji.server_id !== channel.server_id) {
      const perms = channel.server_id ? computeChannelPermissions(db, userId, channel) : 0x7fffffff;
      if (!has(perms, Perm.EXTERNAL_EMOJIS) && !has(perms, Perm.ADMINISTRATOR)) return null;
    }
    const animated = match[0].startsWith('<a:') || match[0].startsWith('a:');
    return `<${animated ? 'a' : ''}:${match[1]}:${id}>`;
  }
  return [...value].length <= 64 ? value : null;
}

export function messages_threadCreatorId(db: DatabaseWrapper, thread: ChannelRow): string | null {
  if (!thread.origin_message_id) return null;
  return db.get<{ author_id: string }>('SELECT author_id FROM messages WHERE id = ?', thread.origin_message_id)?.author_id ?? null;
}
