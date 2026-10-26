import { Router, json, readJson, ApiError, type Ctx } from '../http';
import { ValidationError, text, bool, int, idList } from '../util/validate';
import { Perm } from '../../shared/permissions';
import type { ChannelRow } from '../services/permissions';
import { channelForUser, assertChannelPermission, getServer } from '../services/permissions';
import { getMessageRow, serializeMessages, type MessageRow } from '../repos/messages';
import { toUser } from '../repos/users';
import { logAudit } from '../services/audit';
import { notify } from '../services/notifications';
import { grantAchievement } from '../services/achievements';
import { newId } from '../util/ids';
import { AWARDS } from '../../shared/memes';
import {
  createMessage,
  messages_channelDto,
  messages_sendPermission,
  messages_serializeOne,
  messages_markRead,
  messages_typingAllowed,
  messages_applyVote,
  messages_voteAchievements,
  messages_normalizeReaction,
  messages_validateInlineEmojis,
  search_messages,
  forum_listPosts,
  forum_createPostTags,
  messages_threadCreatorId,
} from '../services/messages';

function queryInt(ctx: Ctx, name: string, min: number, max: number, fallback: number): number {
  const raw = ctx.url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  return int(raw, name, min, max);
}

function optQuery(ctx: Ctx, name: string, maxLen = 100): string | null {
  const raw = ctx.url.searchParams.get(name);
  if (!raw) return null;
  if (raw.length > maxLen) throw new ValidationError({ [name]: `Must be at most ${maxLen} characters.` });
  return raw;
}

function bodyString(body: Record<string, unknown>, field: string, max: number): string {
  const raw = body[field];
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new ValidationError({ [field]: 'Expected a string.' });
  if (raw.length > max) throw new ValidationError({ [field]: `Must be at most ${max} characters.` });
  return raw;
}

function optBodyString(body: Record<string, unknown>, field: string, max: number): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new ValidationError({ [field]: 'Expected a string.' });
  if (raw.length > max) throw new ValidationError({ [field]: `Must be at most ${max} characters.` });
  return raw;
}

function bodyAttachments(body: Record<string, unknown>): string[] {
  const raw = body.attachmentIds;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError({ attachmentIds: 'Expected an array of upload ids.' });
  return idList(raw, 10);
}

function visibleRow(ctx: Ctx, id: string, opts: { history?: boolean; allowDeleted?: boolean } = {}): { row: MessageRow; channel: ChannelRow } {
  const row = getMessageRow(ctx.db, id);
  if (!row || (row.deleted_at && !opts.allowDeleted)) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message fell into the slop pit.');
  const channel = channelForUser(ctx, row.channel_id);
  if (opts.history) assertChannelPermission(ctx, channel, Perm.READ_MESSAGE_HISTORY);
  return { row, channel };
}

function canModerate(ctx: Ctx, channel: ChannelRow): boolean {
  if (channel.type === 'dm' || channel.type === 'group_dm') return false;
  const perms = assertChannelPermission(ctx, channel, Perm.VIEW_CHANNEL);
  return !!ctx.user!.is_admin || (perms & Perm.MANAGE_MESSAGES) === Perm.MANAGE_MESSAGES;
}

export function register(router: Router) {
  // ---- channel history ----
  router.get('/api/channels/:id/messages', (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, Perm.READ_MESSAGE_HISTORY);
    const limit = queryInt(ctx, 'limit', 1, 100, 50);
    const before = optQuery(ctx, 'before');
    const after = optQuery(ctx, 'after');
    const around = optQuery(ctx, 'around');
    const deletedClause = around ? '' : ' AND deleted_at IS NULL';
    let rows: MessageRow[] = [];
    let hasMore = false;
    if (around) {
      const pivot = ctx.db.get<MessageRow>('SELECT * FROM messages WHERE id = ? AND channel_id = ?', around, channel.id);
      if (!pivot) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'That message does not exist in this channel.');
      const olderLimit = Math.ceil(limit / 2);
      const newerLimit = Math.floor(limit / 2);
      const older = ctx.db.all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND id <= ? ORDER BY id DESC LIMIT ?', channel.id, around, olderLimit);
      const newer = ctx.db.all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND id > ? ORDER BY id ASC LIMIT ?', channel.id, around, newerLimit);
      rows = [...older.reverse(), ...newer];
      const oldest = rows[0]?.id;
      hasMore = oldest ? !!ctx.db.get('SELECT 1 FROM messages WHERE channel_id = ? AND id < ?', channel.id, oldest) : false;
    } else if (after && before) {
      rows = ctx.db.all<MessageRow>(
        `SELECT * FROM messages WHERE channel_id = ? AND id > ? AND id < ?${deletedClause} ORDER BY id ASC LIMIT ?`,
        channel.id, after, before, limit,
      );
      const newest = rows[rows.length - 1]?.id;
      hasMore = newest
        ? !!ctx.db.get(`SELECT 1 FROM messages WHERE channel_id = ? AND id > ? AND id < ?${deletedClause}`, channel.id, newest, before)
        : false;
    } else if (after) {
      rows = ctx.db.all<MessageRow>(
        `SELECT * FROM messages WHERE channel_id = ? AND id > ?${deletedClause} ORDER BY id ASC LIMIT ?`,
        channel.id, after, limit,
      );
      const newest = rows[rows.length - 1]?.id;
      hasMore = newest ? !!ctx.db.get(`SELECT 1 FROM messages WHERE channel_id = ? AND id > ?${deletedClause}`, channel.id, newest) : false;
    } else {
      rows = ctx.db.all<MessageRow>(
        `SELECT * FROM messages WHERE channel_id = ?${deletedClause}${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
        ...(before ? [channel.id, before, limit] : [channel.id, limit]),
      );
      rows.reverse();
      const oldest = rows[0]?.id;
      hasMore = oldest ? !!ctx.db.get(`SELECT 1 FROM messages WHERE channel_id = ? AND id < ?${deletedClause}`, channel.id, oldest) : false;
    }
    return json({ messages: serializeMessages(ctx.db, rows, ctx.user!.id), hasMore });
  });

  router.get('/api/messages/:id', (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!, { history: true });
    return json({ message: messages_serializeOne(ctx.db, row.id, ctx.user!.id), channel: messages_channelDto(channel) });
  });

  // ---- send ----
  router.post('/api/channels/:id/messages', async (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, messages_sendPermission(channel));
    const body = await readJson(ctx.req);
    const encrypted = bool(body.encrypted);
    const content = bodyString(body, 'content', encrypted ? 8_000 : 4_000);
    let cryptoMeta: unknown = body.cryptoMeta ?? null;
    if (cryptoMeta !== null && typeof cryptoMeta !== 'string' && typeof cryptoMeta !== 'object') {
      throw new ValidationError({ cryptoMeta: 'Expected a string or object.' });
    }
    if (cryptoMeta !== null && typeof cryptoMeta === 'object' && JSON.stringify(cryptoMeta).length > 8_000) {
      throw new ValidationError({ cryptoMeta: 'cryptoMeta is too large.' });
    }
    if (body.tts !== undefined && typeof body.tts !== 'boolean') throw new ValidationError({ tts: 'Expected a boolean.' });
    if (body.poll !== undefined && body.poll !== null && (typeof body.poll !== 'object' || Array.isArray(body.poll))) {
      throw new ValidationError({ poll: 'Expected a poll object.' });
    }
    const message = createMessage(ctx.db, ctx.hub, {
      channelId: channel.id,
      authorId: ctx.user!.id,
      content,
      nonce: optBodyString(body, 'nonce', 64),
      replyToId: optBodyString(body, 'replyToId', 64),
      attachmentIds: bodyAttachments(body),
      poll: (body.poll as { question: string; options: string[]; multiple?: boolean; durationHours?: number } | null | undefined) ?? null,
      tts: body.tts === true,
      encrypted,
      cryptoMeta,
      stickerId: optBodyString(body, 'stickerId', 64),
    }, ctx.config);
    return json({ message });
  });

  // ---- edit ----
  router.patch('/api/messages/:id', async (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    if (row.author_id !== ctx.user!.id) throw new ApiError(403, 'NOT_MESSAGE_AUTHOR', 'Only the author can edit their own slop.');
    const body = await readJson(ctx.req);
    const content = bodyString(body, 'content', row.encrypted ? 8_000 : 4_000);
    if (!content.trim()) throw new ApiError(400, 'EMPTY_MESSAGE', 'Edited message cannot be empty. Say something.');
    if (!row.encrypted) messages_validateInlineEmojis(ctx.db, content, channel, assertChannelPermission(ctx, channel, Perm.VIEW_CHANNEL));
    ctx.db.run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', content, Date.now(), row.id);
    const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
    ctx.hub.broadcastChannel(channel.id, 'MESSAGE_UPDATE', { message });
    return json({ message });
  });

  // ---- delete ----
  router.delete('/api/messages/:id', (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    const isAuthor = row.author_id === ctx.user!.id;
    if (!isAuthor && !canModerate(ctx, channel)) {
      throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot delete someone else\u2019s banger. Get MANAGE_MESSAGES.');
    }
    const now = Date.now();
    ctx.db.transaction(() => {
      ctx.db.run('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', now, ctx.user!.id, row.id);
      ctx.db.run('UPDATE users SET karma = karma - ? WHERE id = ?', row.score, row.author_id);
    });
    ctx.hub.broadcastChannel(channel.id, 'MESSAGE_DELETE', { messageId: row.id, channelId: channel.id, deletedBy: ctx.user!.id });
    if (!isAuthor && channel.server_id) {
      logAudit(ctx.db, {
        serverId: channel.server_id, actorId: ctx.user!.id, action: 'MESSAGE_DELETE', targetType: 'message',
        targetId: row.id, reason: 'moderator delete', changes: { authorId: row.author_id, channelId: channel.id },
      });
    }
    return json({ deleted: true, messageId: row.id });
  });

  // ---- purge ----
  router.post('/api/channels/:id/purge', async (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    if (channel.type === 'dm' || channel.type === 'group_dm') throw new ApiError(400, 'NOT_A_SERVER_CHANNEL', 'DMs are private. No purging.');
    assertChannelPermission(ctx, channel, Perm.MANAGE_MESSAGES);
    const body = await readJson(ctx.req);
    const amount = int(body.amount, 'amount', 1, 100, 10);
    const userId = optBodyString(body, 'userId', 64);
    const before = optBodyString(body, 'before', 64);
    const clauses = ['channel_id = ?', 'deleted_at IS NULL'];
    const params: unknown[] = [channel.id];
    if (userId) { clauses.push('author_id = ?'); params.push(userId); }
    if (before) { clauses.push('id < ?'); params.push(before); }
    const rows = ctx.db.all<MessageRow>(`SELECT * FROM messages WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`, ...params, amount);
    if (!rows.length) return json({ deleted: 0 });
    const now = Date.now();
    ctx.db.transaction(() => {
      for (const row of rows) {
        ctx.db.run('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', now, ctx.user!.id, row.id);
        ctx.db.run('UPDATE users SET karma = karma - ? WHERE id = ?', row.score, row.author_id);
      }
    });
    const messageIds = rows.map((r) => r.id);
    ctx.hub.broadcastChannel(channel.id, 'MESSAGE_BULK_DELETE', { channelId: channel.id, messageIds, deletedBy: ctx.user!.id });
    logAudit(ctx.db, {
      serverId: channel.server_id, actorId: ctx.user!.id, action: 'MESSAGE_PURGE', targetType: 'channel', targetId: channel.id,
      reason: 'bulk purge', changes: { amount: messageIds.length, userId, before, messageIds },
    });
    return json({ deleted: messageIds.length });
  });

  // ---- pins ----
  router.get('/api/channels/:id/pins', (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, Perm.READ_MESSAGE_HISTORY);
    const rows = ctx.db.all<MessageRow>('SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY pinned_at DESC LIMIT 50', channel.id);
    return json({ pins: serializeMessages(ctx.db, rows, ctx.user!.id) });
  });

  router.post('/api/messages/:id/pin', (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, Perm.PIN_MESSAGES);
    if (!row.pinned) {
      ctx.db.run('UPDATE messages SET pinned = 1, pinned_at = ?, pinned_by = ? WHERE id = ?', Date.now(), ctx.user!.id, row.id);
      const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
      ctx.hub.broadcastChannel(channel.id, 'MESSAGE_UPDATE', { message });
      return json({ message });
    }
    return json({ message: messages_serializeOne(ctx.db, row.id, ctx.user!.id) });
  });

  router.delete('/api/messages/:id/pin', (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, Perm.PIN_MESSAGES);
    ctx.db.run('UPDATE messages SET pinned = 0, pinned_at = NULL, pinned_by = NULL WHERE id = ?', row.id);
    const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
    ctx.hub.broadcastChannel(channel.id, 'MESSAGE_UPDATE', { message });
    return json({ message });
  });

  // ---- reactions ----
  const react = (ctx: Ctx, remove: boolean) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!, { allowDeleted: true });
    assertChannelPermission(ctx, channel, Perm.ADD_REACTIONS);
    const emoji = messages_normalizeReaction(ctx.db, ctx.params.emoji!, channel, ctx.user!.id);
    if (!emoji) throw new ApiError(400, 'INVALID_EMOJI', 'That reaction is not a valid emoji, custom emoji, or short enough for this server.');
    if (!remove) {
      ctx.db.run('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', row.id, ctx.user!.id, emoji, Date.now());
      const given = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reactions WHERE user_id = ?', ctx.user!.id)?.n ?? 0;
      if (given >= 50) grantAchievement(ctx.db, ctx.hub, ctx.user!.id, 'reaction_goblin');
    } else {
      ctx.db.run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', row.id, ctx.user!.id, emoji);
    }
    const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
    ctx.hub.broadcastChannel(channel.id, remove ? 'REACTION_REMOVE' : 'REACTION_ADD', {
      messageId: row.id, channelId: channel.id, emoji, userId: ctx.user!.id, reactions: message.reactions,
    });
    return json({ reactions: message.reactions });
  };
  router.put('/api/messages/:id/reactions/:emoji', (ctx) => react(ctx, false));
  router.delete('/api/messages/:id/reactions/:emoji', (ctx) => react(ctx, true));

  // ---- votes ----
  router.put('/api/messages/:id/vote', async (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    const body = await readJson(ctx.req);
    const value = int(body.value, 'value', -1, 1) as -1 | 0 | 1;
    if (channel.type === 'thread' && channel.parent_id) {
      const parent = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channel.parent_id);
      if (parent?.type === 'forum' && !parent.voting_enabled) throw new ApiError(400, 'VOTING_DISABLED', 'Voting is disabled on this forum.');
    }
    const result = messages_applyVote(ctx.db, row, ctx.user!.id, value);
    messages_voteAchievements(ctx.db, ctx.hub, row, result.score, result.karma);
    ctx.hub.broadcastChannel(channel.id, 'MESSAGE_VOTE', {
      messageId: row.id, channelId: channel.id, score: result.score, userId: ctx.user!.id, value,
    });
    return json(result);
  });

  // ---- awards ----
  router.post('/api/messages/:id/award', async (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    const body = await readJson(ctx.req);
    const award = text(body.award, 'award', 1, 32);
    if (!AWARDS.some((a) => a.key === award)) throw new ApiError(400, 'INVALID_AWARD', 'That award does not exist in the slop economy. Try a real one.');
    ctx.db.run('INSERT INTO awards (id, message_id, user_id, award, created_at) VALUES (?, ?, ?, ?, ?)', newId('aw'), row.id, ctx.user!.id, award, Date.now());
    const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
    ctx.hub.broadcastChannel(channel.id, 'MESSAGE_UPDATE', { message });
    return json({ message });
  });

  // ---- saved ----
  router.post('/api/messages/:id/save', (ctx) => {
    const { row } = visibleRow(ctx, ctx.params.id!);
    ctx.db.run('INSERT OR IGNORE INTO saved_messages (user_id, message_id, created_at) VALUES (?, ?, ?)', ctx.user!.id, row.id, Date.now());
    return json({ saved: true, messageId: row.id });
  });
  router.delete('/api/messages/:id/save', (ctx) => {
    const { row } = visibleRow(ctx, ctx.params.id!);
    ctx.db.run('DELETE FROM saved_messages WHERE user_id = ? AND message_id = ?', ctx.user!.id, row.id);
    return json({ saved: false, messageId: row.id });
  });

  // ---- reports ----
  router.post('/api/messages/:id/report', async (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!, { allowDeleted: true });
    const body = await readJson(ctx.req);
    const reason = text(body.reason, 'reason', 3, 1_000);
    const duplicate = ctx.db.get('SELECT 1 FROM reports WHERE reporter_id = ? AND message_id = ? AND status = \'open\'', ctx.user!.id, row.id);
    if (duplicate) throw new ApiError(409, 'REPORT_EXISTS', 'You already reported that message. Touch grass while we review it.');
    const id = newId('r');
    const now = Date.now();
    ctx.db.run(
      `INSERT INTO reports (id, server_id, reporter_id, target_user_id, message_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      id, channel.server_id, ctx.user!.id, row.author_id, row.id, reason, now,
    );
    const recipientIds = new Set<string>();
    for (const admin of ctx.db.all<{ id: string }>('SELECT id FROM users WHERE is_admin = 1 AND disabled = 0')) recipientIds.add(admin.id);
    if (channel.server_id) {
      const server = getServer(ctx.db, channel.server_id);
      if (server) recipientIds.add(server.owner_id);
      for (const m of ctx.db.all<{ user_id: string }>(
        `SELECT DISTINCT m.user_id FROM members m
         JOIN member_roles mr ON mr.user_id = m.user_id AND mr.server_id = m.server_id
         JOIN roles r ON r.id = mr.role_id
         WHERE m.server_id = ? AND ((r.permissions & ?) != 0 OR (r.permissions & ?) != 0 OR (r.permissions & ?) != 0)`,
        channel.server_id, Perm.MANAGE_MESSAGES, Perm.MANAGE_SERVER, Perm.ADMINISTRATOR,
      )) recipientIds.add(m.user_id);
    }
    for (const userId of recipientIds) {
      if (userId === ctx.user!.id) continue;
      notify(ctx.db, ctx.hub, {
        userId, type: 'report', title: 'New report', body: reason.slice(0, 500),
        serverId: channel.server_id, channelId: channel.id, messageId: row.id, actorId: ctx.user!.id,
      });
    }
    const authorRow = ctx.db.get<Parameters<typeof toUser>[0]>('SELECT * FROM users WHERE id = ?', row.author_id);
    return json({
      report: {
        id,
        guildId: channel.server_id,
        reporter: toUser(ctx.user!),
        targetUser: authorRow ? toUser(authorRow) : null,
        message: serializeMessages(ctx.db, [row], ctx.user!.id)[0] ?? null,
        reason,
        status: 'open',
        resolution: null,
        resolvedBy: null,
        createdAt: now,
        resolvedAt: null,
      },
    });
  });

  // ---- read state ----
  router.post('/api/channels/:id/read', async (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    const body = await readJson(ctx.req);
    const messageId = optBodyString(body, 'messageId', 64);
    if (messageId) {
      const target = getMessageRow(ctx.db, messageId);
      if (!target || target.channel_id !== channel.id) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'Cannot mark read up to a message from another channel.');
    }
    const lastReadId = messageId ?? channel.last_message_id;
    messages_markRead(ctx.db, ctx.user!.id, channel.id, lastReadId);
    ctx.hub.send(ctx.user!.id, 'READ_STATE_UPDATE', { channelId: channel.id, lastReadId, mentionCount: 0 });
    return json({ channelId: channel.id, lastReadId, mentionCount: 0 });
  });

  // ---- typing ----
  router.post('/api/channels/:id/typing', (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, messages_sendPermission(channel));
    if (!messages_typingAllowed(channel.id, ctx.user!.id)) return json({ ok: true, throttled: true });
    ctx.hub.broadcastChannel(channel.id, 'TYPING_START', {
      channelId: channel.id,
      user: { id: ctx.user!.id, displayName: ctx.user!.display_name, avatar: ctx.user!.avatar },
      at: Date.now(),
    }, ctx.user!.id);
    return json({ ok: true, throttled: false });
  });

  // ---- threads ----
  function insertThread(ctx: Ctx, parent: ChannelRow, name: string, tags: string, originMessageId: string | null): string {
    const id = newId('ch');
    const position = (ctx.db.get<{ p: number | null }>('SELECT MAX(position) AS p FROM channels WHERE server_id = ?', parent.server_id)?.p ?? 0) + 1;
    ctx.db.run(
      `INSERT INTO channels (id, server_id, type, name, topic, nsfw, slowmode, position, parent_id, locked, archived,
        last_message_id, tags, icon, default_sort, voting_enabled, origin_message_id, created_at)
       VALUES (?, ?, 'thread', ?, NULL, ?, 0, ?, ?, 0, 0, NULL, ?, NULL, NULL, ?, ?, ?)`,
      id, parent.server_id, name, parent.nsfw, position, parent.id, tags, parent.voting_enabled,
      originMessageId, Date.now(),
    );
    return id;
  }

  router.post('/api/messages/:id/thread', async (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    if (!channel.server_id || channel.type === 'dm' || channel.type === 'group_dm') throw new ApiError(400, 'THREADS_UNAVAILABLE', 'Threads require a server channel. DMs are already threaded.');
    if (channel.type === 'thread') throw new ApiError(400, 'ALREADY_A_THREAD', 'You cannot thread a thread. Inception is banned.');
    assertChannelPermission(ctx, channel, Perm.CREATE_THREADS);
    const body = await readJson(ctx.req);
    const name = text(body.name, 'name', 2, 100);
    const threadId = insertThread(ctx, channel, name, '[]', row.id);
    const systemMessage = createMessage(ctx.db, ctx.hub, {
      channelId: threadId, authorId: ctx.user!.id, content: `started a thread: ${name}`, type: 'system', skipChecks: true,
    }, ctx.config);
    const thread = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', threadId)!;
    const dto = messages_channelDto(thread);
    ctx.hub.broadcastChannel(channel.id, 'CHANNEL_CREATE', { channel: dto });
    ctx.hub.broadcastChannel(channel.id, 'THREAD_CREATE', { thread: dto, message: systemMessage });
    return json({ thread: dto, message: systemMessage });
  });

  router.get('/api/channels/:id/threads', (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    assertChannelPermission(ctx, channel, Perm.READ_MESSAGE_HISTORY);
    const includeArchived = bool(ctx.url.searchParams.get('includeArchived') ?? '');
    const limit = queryInt(ctx, 'limit', 1, 100, 50);
    const rows = ctx.db.all<ChannelRow>(
      `SELECT * FROM channels WHERE parent_id = ? AND type = 'thread'${includeArchived ? '' : ' AND archived = 0'}
       ORDER BY created_at DESC LIMIT ?`,
      channel.id, limit,
    );
    return json({ threads: rows.map(messages_channelDto) });
  });

  router.patch('/api/threads/:id', async (ctx) => {
    const thread = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', ctx.params.id!);
    if (!thread || thread.type !== 'thread') throw new ApiError(404, 'THREAD_NOT_FOUND', 'That thread does not exist. It never did.');
    channelForUser(ctx, thread.id);
    const perms = assertChannelPermission(ctx, thread, Perm.VIEW_CHANNEL);
    const creatorId = messages_threadCreatorId(ctx.db, thread);
    const canManage = !!ctx.user!.is_admin || (perms & Perm.MANAGE_THREADS) === Perm.MANAGE_THREADS;
    if (creatorId !== ctx.user!.id && !canManage) throw new ApiError(403, 'MISSING_PERMISSIONS', 'Only the thread creator or a thread janitor can edit this.');
    const body = await readJson(ctx.req);
    const updates: string[] = [];
    const params: unknown[] = [];
    if (body.name !== undefined) {
      const name = text(body.name, 'name', 2, 100);
      updates.push('name = ?'); params.push(name);
    }
    if (body.tags !== undefined) {
      const parent = thread.parent_id ? ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', thread.parent_id) : null;
      let tags: string[];
      if (parent?.type === 'forum') tags = forum_createPostTags(parent, body.tags);
      else {
        if (!Array.isArray(body.tags)) throw new ValidationError({ tags: 'Expected an array.' });
        tags = body.tags.slice(0, 5).map((t) => String(t ?? '').trim().slice(0, 32)).filter(Boolean);
      }
      updates.push('tags = ?'); params.push(JSON.stringify(tags));
    }
    if (body.archived !== undefined) { updates.push('archived = ?'); params.push(bool(body.archived) ? 1 : 0); }
    if (body.locked !== undefined) { updates.push('locked = ?'); params.push(bool(body.locked) ? 1 : 0); }
    if (!updates.length) return json({ thread: messages_channelDto(thread) });
    ctx.db.run(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`, ...params, thread.id);
    const updated = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', thread.id)!;
    const dto = messages_channelDto(updated);
    ctx.hub.invalidateChannel(thread.id);
    if (thread.parent_id) ctx.hub.broadcastChannel(thread.parent_id, 'THREAD_UPDATE', { thread: dto });
    ctx.hub.broadcastChannel(thread.id, 'CHANNEL_UPDATE', { channel: dto });
    if (thread.server_id) {
      logAudit(ctx.db, {
        serverId: thread.server_id, actorId: ctx.user!.id, action: 'THREAD_UPDATE', targetType: 'thread', targetId: thread.id,
        changes: { name: body.name, tags: body.tags, archived: body.archived, locked: body.locked },
      });
    }
    return json({ thread: dto });
  });

  // ---- forums ----
  router.post('/api/channels/:id/posts', async (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    if (channel.type !== 'forum') throw new ApiError(400, 'NOT_A_FORUM', 'That channel is not a forum. Posts go in forums.');
    assertChannelPermission(ctx, channel, Perm.CREATE_THREADS);
    assertChannelPermission(ctx, channel, Perm.SEND_IN_THREADS);
    const body = await readJson(ctx.req);
    const title = text(body.title, 'title', 2, 100);
    const content = bodyString(body, 'content', 4_000);
    const attachmentIds = bodyAttachments(body);
    if (!content.trim() && !attachmentIds.length) throw new ApiError(400, 'EMPTY_POST', 'Forum posts need content or attachments. Title alone is not a post.');
    const tags = forum_createPostTags(channel, body.tags);
    const threadId = insertThread(ctx, channel, title, JSON.stringify(tags), null);
    let message;
    try {
      message = createMessage(ctx.db, ctx.hub, {
        channelId: threadId, authorId: ctx.user!.id, content, attachmentIds,
      }, ctx.config);
    } catch (error) {
      ctx.db.run('DELETE FROM channels WHERE id = ?', threadId);
      throw error;
    }
    ctx.db.run('UPDATE channels SET origin_message_id = ? WHERE id = ?', message.id, threadId);
    ctx.db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', message.id, channel.id);
    const thread = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', threadId)!;
    const dto = messages_channelDto(thread);
    ctx.hub.broadcastChannel(channel.id, 'CHANNEL_CREATE', { channel: dto });
    ctx.hub.broadcastChannel(channel.id, 'THREAD_CREATE', { thread: dto, message });
    return json({ thread: dto, firstMessage: message });
  });

  router.get('/api/channels/:id/posts', (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    if (channel.type !== 'forum') throw new ApiError(400, 'NOT_A_FORUM', 'That channel is not a forum.');
    assertChannelPermission(ctx, channel, Perm.READ_MESSAGE_HISTORY);
    const rawSort = ctx.url.searchParams.get('sort') ?? channel.default_sort ?? 'hot';
    if (!['hot', 'new', 'top'].includes(rawSort)) throw new ValidationError({ sort: 'Must be hot, new, or top.' });
    const tag = optQuery(ctx, 'tag', 32);
    const includeArchived = bool(ctx.url.searchParams.get('includeArchived') ?? '');
    const limit = queryInt(ctx, 'limit', 1, 100, 25);
    const offset = queryInt(ctx, 'offset', 0, 10_000, 0);
    const result = forum_listPosts(ctx.db, channel, ctx.user!.id, {
      sort: rawSort as 'hot' | 'new' | 'top', tag, includeArchived, limit, offset,
    });
    return json(result);
  });

  // ---- poll votes ----
  router.post('/api/messages/:id/poll/vote', async (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    const poll = ctx.db.get<{ id: string; multiple: number; closes_at: number | null }>('SELECT id, multiple, closes_at FROM polls WHERE message_id = ?', row.id);
    if (!poll) throw new ApiError(404, 'POLL_NOT_FOUND', 'That message has no poll. Inventing democracy?');
    if (poll.closes_at && poll.closes_at <= Date.now()) throw new ApiError(400, 'POLL_CLOSED', 'This poll is closed. The people have spoken.');
    const body = await readJson(ctx.req);
    const rawIds = Array.isArray(body.optionIds) ? idList(body.optionIds, 10) : body.optionId !== undefined ? [String(body.optionId)] : [];
    if (!rawIds.length) throw new ApiError(400, 'NO_OPTION', 'Pick at least one poll option.');
    if (!poll.multiple && rawIds.length > 1) throw new ApiError(400, 'POLL_SINGLE_CHOICE', 'This poll is single-choice. One vote, one destiny.');
    const valid = new Set(ctx.db.all<{ id: string }>('SELECT id FROM poll_options WHERE poll_id = ?', poll.id).map((o) => o.id));
    for (const id of rawIds) if (!valid.has(id)) throw new ApiError(400, 'INVALID_OPTION', 'That poll option does not belong to this poll.');
    const now = Date.now();
    ctx.db.transaction(() => {
      ctx.db.run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', poll.id, ctx.user!.id);
      for (const id of rawIds) {
        ctx.db.run('INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)', poll.id, ctx.user!.id, id, now);
      }
    });
    const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
    ctx.hub.broadcastChannel(channel.id, 'POLL_UPDATE', { messageId: row.id, channelId: channel.id, poll: message.poll });
    return json({ poll: message.poll });
  });

  router.delete('/api/messages/:id/poll/vote', (ctx) => {
    const { row, channel } = visibleRow(ctx, ctx.params.id!);
    const poll = ctx.db.get<{ id: string }>('SELECT id FROM polls WHERE message_id = ?', row.id);
    if (!poll) throw new ApiError(404, 'POLL_NOT_FOUND', 'That message has no poll.');
    ctx.db.run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', poll.id, ctx.user!.id);
    const message = messages_serializeOne(ctx.db, row.id, ctx.user!.id);
    ctx.hub.broadcastChannel(channel.id, 'POLL_UPDATE', { messageId: row.id, channelId: channel.id, poll: message.poll });
    return json({ poll: message.poll });
  });

  // ---- search ----
  router.get('/api/search', (ctx) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const rawHas = ctx.url.searchParams.get('has');
    if (rawHas && !['image', 'file', 'link'].includes(rawHas)) throw new ValidationError({ has: 'Must be image, file, or link.' });
    const result = search_messages(ctx.db, ctx.user!.id, {
      q,
      serverId: optQuery(ctx, 'serverId', 64),
      channelId: optQuery(ctx, 'channelId', 64),
      authorId: optQuery(ctx, 'authorId', 64),
      has: rawHas as 'image' | 'file' | 'link' | null,
      before: optQuery(ctx, 'before', 64),
      after: optQuery(ctx, 'after', 64),
      limit: queryInt(ctx, 'limit', 1, 100, 25),
      offset: queryInt(ctx, 'offset', 0, 10_000, 0),
    }, !!ctx.user!.is_admin);
    return json(result);
  });
}
