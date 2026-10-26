import type { DatabaseWrapper } from '../db';
import type { Ctx, UserRow } from '../http';
import { ApiError } from '../http';
import { ValidationError, int } from '../util/validate';
import { newId } from '../util/ids';
import { Perm, has } from '../../shared/permissions';
import type {
  Channel, Emoji, Role, Server, ServerEvent, ServerMember, Sound, Sticker, Webhook,
} from '../../shared/types';
import {
  channelsForServer, getMemberRow, getServerRow, overridesForChannel, rolesForServer, toChannel, toMember,
  toRole, toServer, unreadCounts, type ServerRow,
} from '../repos/servers';
import { toUser } from '../repos/users';
import { serializeMessages, type MessageRow } from '../repos/messages';
import {
  computeBasePermissions, computeChannelPermissions, isServerMember, type ChannelRow,
} from './permissions';

export const UPLOAD_URL_PREFIX = '/api/media/uploads/';

function assetUrl(path: string): string {
  if (path.startsWith('/')) return path;
  return UPLOAD_URL_PREFIX + path;
}

export interface UploadRow {
  id: string;
  owner_id: string;
  purpose: string;
  filename: string;
  content_type: string;
  size: number;
  path: string;
  sha256: string;
  width: number | null;
  height: number | null;
  message_id: string | null;
  created_at: number;
}

export interface UploadRules {
  purposes: readonly string[];
  kind: 'image' | 'audio';
}

export const UPLOAD_PURPOSES = {
  icon: ['server_icon'],
  banner: ['server_banner', 'banner'],
  emoji: ['emoji'],
  sticker: ['sticker'],
  sound: ['sound'],
  cover: ['event_cover'],
  webhookAvatar: ['webhook_avatar'],
} as const;

const UPLOAD_URL_RE = /^\/api\/media\/uploads\/([A-Za-z0-9_-]{1,64})$/;
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolves a client-supplied upload URL to an upload owned by the caller.
 * Never accepts filesystem paths or remote URLs.
 */
export function resolveUpload(ctx: Ctx, value: unknown, field: string, rules: UploadRules): { upload: UploadRow; url: string } {
  const raw = String(value ?? '').trim();
  const urlMatch = UPLOAD_URL_RE.exec(raw);
  const uploadId = urlMatch ? urlMatch[1] : UPLOAD_ID_RE.exec(raw)?.[0];
  if (!uploadId) {
    throw new ValidationError({ [field]: 'Expected an upload id or /api/media/uploads/<id> URL.' });
  }
  const upload = ctx.db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', uploadId);
  if (!upload) throw new ValidationError({ [field]: 'That upload does not exist. Nice try.' });
  if (upload.owner_id !== ctx.user!.id) throw new ValidationError({ [field]: 'You can only use uploads you own.' });
  if (!rules.purposes.includes(upload.purpose)) {
    throw new ValidationError({ [field]: `Upload purpose must be one of: ${rules.purposes.join(', ')}.` });
  }
  if (rules.kind === 'image' && !upload.content_type.startsWith('image/')) {
    throw new ValidationError({ [field]: 'That upload is not an image.' });
  }
  if (rules.kind === 'audio' && !upload.content_type.startsWith('audio/')) {
    throw new ValidationError({ [field]: 'That upload is not an audio file.' });
  }
  return { upload, url: UPLOAD_URL_PREFIX + upload.id };
}

/** Resolves an optional image/asset field. Returns undefined when absent, null when explicitly cleared. */
export function optionalUpload(ctx: Ctx, body: Record<string, unknown>, field: string, rules: UploadRules): string | null | undefined {
  if (!(field in body)) return undefined;
  if (body[field] === null || body[field] === '') return null;
  return resolveUpload(ctx, body[field], field, rules).url;
}

export function requireServer(ctx: Ctx, serverId: string, opts: { member?: boolean } = {}): ServerRow {
  const row = getServerRow(ctx.db, serverId);
  if (!row) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it was eaten by the slop goblin.');
  if (opts.member !== false && !isServerMember(ctx.db, serverId, ctx.user!.id) && !ctx.user!.is_admin) {
    throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it was eaten by the slop goblin.');
  }
  return row;
}

export function assertOwnerOrAdmin(ctx: Ctx, server: ServerRow): void {
  if (server.owner_id !== ctx.user!.id && !ctx.user!.is_admin) {
    throw new ApiError(403, 'OWNER_ONLY', 'Only the owner or an instance admin can do that.');
  }
}

export function serverName(value: unknown): string {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 100) throw new ValidationError({ name: 'Server name must be 1-100 characters.' });
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new ValidationError({ name: 'No control characters in the server name.' });
  return s;
}

export function channelName(value: unknown): string {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 100) throw new ValidationError({ name: 'Channel name must be 1-100 characters.' });
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new ValidationError({ name: 'No control characters in the channel name.' });
  return s;
}

export function stringList(value: unknown, field: string, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) throw new ValidationError({ [field]: 'Expected an array of strings.' });
  if (value.length > maxItems) throw new ValidationError({ [field]: `Too many entries (max ${maxItems}).` });
  const out: string[] = [];
  for (const item of value) {
    const s = String(item ?? '').trim();
    if (!s || s.length > maxLen) throw new ValidationError({ [field]: `Each entry must be 1-${maxLen} characters.` });
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function permissionMask(value: unknown, field: string): number {
  return int(value, field, 0, 0x7fffffff);
}

export function channelType(value: unknown): 'text' | 'voice' | 'category' | 'forum' | 'announcement' {
  const s = String(value ?? '');
  if (s === 'text' || s === 'voice' || s === 'category' || s === 'forum' || s === 'announcement') return s;
  throw new ValidationError({ type: 'Channel type must be one of: text, voice, category, forum, announcement.' });
}

export function defaultSort(value: unknown): 'hot' | 'new' | 'top' | null {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (s === 'hot' || s === 'new' || s === 'top') return s;
  throw new ValidationError({ defaultSort: 'Sort must be hot, new or top.' });
}

export function slowmode(value: unknown): number {
  return int(value, 'slowmode', 0, 21600);
}

export function isChannelManager(ctx: Ctx, serverId: string, viewerId: string): boolean {
  if (ctx.user!.is_admin) return true;
  const base = computeBasePermissions(ctx.db, serverId, viewerId);
  return has(base.permissions, Perm.ADMINISTRATOR) || has(base.permissions, Perm.MANAGE_CHANNELS);
}

export function roleDtos(db: DatabaseWrapper, serverId: string, memberCount: number): Role[] {
  const counts = new Map<string, number>();
  for (const r of db.all<{ role_id: string; n: number }>(
    'SELECT role_id, COUNT(*) AS n FROM member_roles WHERE server_id = ? GROUP BY role_id', serverId,
  )) counts.set(r.role_id, r.n);
  return rolesForServer(db, serverId).map((r) => toRole(r, r.is_default ? memberCount : (counts.get(r.id) ?? 0)));
}

export function channelDtos(ctx: Ctx, serverId: string, viewerId: string, includeAll: boolean): Channel[] {
  const unread = unreadCounts(ctx.db, viewerId);
  const visible: Channel[] = [];
  for (const row of channelsForServer(ctx.db, serverId)) {
    if (!includeAll && !channelVisible(ctx.db, viewerId, row)) continue;
    const u = unread[row.id];
    const extra: Partial<Channel> = {
      unreadCount: u?.count ?? 0,
      mentionCount: u?.mentions ?? 0,
      lastReadId: u?.lastReadId ?? null,
    };
    if (includeAll) extra.overrides = overridesForChannel(ctx.db, row.id);
    visible.push(toChannel(row, extra));
  }
  return visible;
}

function channelVisible(db: DatabaseWrapper, viewerId: string, row: ChannelRow): boolean {
  if (row.archived && row.type === 'thread') return false;
  return has(computeChannelPermissions(db, viewerId, row), Perm.VIEW_CHANNEL);
}

export function channelDto(db: DatabaseWrapper, row: ChannelRow): Channel {
  return toChannel(row, { overrides: overridesForChannel(db, row.id) });
}

export function memberDto(db: DatabaseWrapper, serverId: string, userId: string): ServerMember | null {
  const row = getMemberRow(db, serverId, userId);
  if (!row) return null;
  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId);
  return user ? toMember(db, row, user) : null;
}

export interface EmojiRow {
  id: string; server_id: string | null; name: string; path: string; animated: number;
  uploader_id: string | null; created_at: number;
}
export interface StickerRow {
  id: string; server_id: string | null; name: string; path: string; description: string | null;
  tags: string; uploader_id: string | null; created_at: number;
}
export interface SoundRow {
  id: string; server_id: string | null; name: string; path: string; emoji: string;
  uploader_id: string | null; created_at: number;
}

export function emojiDtos(db: DatabaseWrapper, serverId: string): Emoji[] {
  return db.all<EmojiRow>('SELECT * FROM emojis WHERE server_id = ? ORDER BY created_at ASC', serverId)
    .map((r) => ({ id: r.id, serverId: r.server_id, name: r.name, url: assetUrl(r.path), animated: !!r.animated }));
}

export function stickerDtos(db: DatabaseWrapper, serverId: string): Sticker[] {
  return db.all<StickerRow>('SELECT * FROM stickers WHERE server_id = ? ORDER BY created_at ASC', serverId)
    .map((r) => ({
      id: r.id, serverId: r.server_id, name: r.name, url: assetUrl(r.path),
      description: r.description, tags: safeJson<string[]>(r.tags, []),
    }));
}

export function soundDtos(db: DatabaseWrapper, serverId: string): Sound[] {
  return db.all<SoundRow>('SELECT * FROM sounds WHERE server_id = ? ORDER BY created_at ASC', serverId)
    .map((r) => ({ id: r.id, serverId: r.server_id, name: r.name, url: assetUrl(r.path), emoji: r.emoji }));
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export interface EventRow {
  id: string; server_id: string; channel_id: string | null; name: string; description: string | null;
  starts_at: number; ends_at: number | null; creator_id: string; cover: string | null; created_at: number;
}

export function toEventDto(db: DatabaseWrapper, row: EventRow, viewerId: string): ServerEvent {
  const creator = db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.creator_id);
  if (!creator) throw new ApiError(404, 'EVENT_NOT_FOUND', 'This event lost its creator to the void.');
  const counts = { interested: 0, going: 0 };
  for (const r of db.all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM event_rsvps WHERE event_id = ? GROUP BY status', row.id,
  )) {
    if (r.status === 'interested') counts.interested = r.n;
    else if (r.status === 'going') counts.going = r.n;
  }
  const mine = db.get<{ status: string }>('SELECT status FROM event_rsvps WHERE event_id = ? AND user_id = ?', row.id, viewerId);
  const rsvp = mine?.status === 'interested' || mine?.status === 'going' ? mine.status : null;
  return {
    id: row.id, serverId: row.server_id, channelId: row.channel_id, name: row.name,
    description: row.description, startsAt: row.starts_at, endsAt: row.ends_at,
    creator: toUser(creator), cover: row.cover, rsvp, counts,
  };
}

export function eventDtos(db: DatabaseWrapper, serverId: string, viewerId: string): ServerEvent[] {
  return db.all<EventRow>('SELECT * FROM server_events WHERE server_id = ? ORDER BY starts_at ASC, created_at ASC', serverId)
    .map((row) => toEventDto(db, row, viewerId));
}

export interface WebhookRow {
  id: string; server_id: string; channel_id: string; name: string; avatar: string | null;
  token_hash: string; created_by: string; created_at: number; last_used_at: number | null;
}

export function toWebhookDto(row: WebhookRow, token?: string): Webhook {
  return {
    id: row.id, serverId: row.server_id, channelId: row.channel_id, name: row.name,
    avatar: row.avatar, createdAt: row.created_at, lastUsedAt: row.last_used_at,
    ...(token ? { token } : {}),
  };
}

export function broadcastServerUpdate(ctx: Ctx, row: ServerRow): Server {
  const dto = { ...toServer(row), roles: roleDtos(ctx.db, row.id, row.member_count) };
  ctx.hub.broadcastServer(row.id, 'SERVER_UPDATE', dto);
  return dto;
}

/** Inserts a system message in a channel and broadcasts it. Author must already be allowed to see it. */
export function insertSystemMessage(ctx: Ctx, input: { channelId: string; serverId: string; authorId: string; content: string }): void {
  const id = newId('m');
  const now = Date.now();
  ctx.db.run(
    `INSERT INTO messages (id, channel_id, server_id, author_id, content, type, created_at)
     VALUES (?, ?, ?, ?, ?, 'system', ?)`,
    id, input.channelId, input.serverId, input.authorId, input.content.slice(0, 2000), now,
  );
  ctx.db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', id, input.channelId);
  const row = ctx.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
  if (row) {
    const [dto] = serializeMessages(ctx.db, [row], input.authorId);
    ctx.hub.invalidateChannel(input.channelId);
    ctx.hub.broadcastChannel(input.channelId, 'MESSAGE_CREATE', { message: dto });
  }
}

export function nextChannelPosition(db: DatabaseWrapper, serverId: string): number {
  return (db.get<{ n: number | null }>('SELECT MAX(position) AS n FROM channels WHERE server_id = ?', serverId)?.n ?? -1) + 1;
}

export interface ChannelInput {
  name: string;
  type: string;
  parentId: string | null;
  topic: string | null;
  nsfw: boolean;
  slowmode: number;
  votingEnabled: boolean;
  defaultSort: 'hot' | 'new' | 'top' | null;
  locked?: boolean;
  archived?: boolean;
  tags?: string[];
  icon?: string | null;
}

export function insertChannel(ctx: Ctx, serverId: string, input: ChannelInput): ChannelRow {
  const id = newId('c');
  const position = nextChannelPosition(ctx.db, serverId);
  ctx.db.run(
    `INSERT INTO channels (id, server_id, type, name, topic, nsfw, slowmode, position, parent_id, locked, archived, tags, icon, default_sort, voting_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, serverId, input.type, input.name, input.topic, input.nsfw ? 1 : 0, input.slowmode, position,
    input.parentId, input.locked ? 1 : 0, input.archived ? 1 : 0, JSON.stringify(input.tags ?? []),
    input.icon ?? null, input.defaultSort, input.votingEnabled ? 1 : 0, Date.now(),
  );
  return ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', id)!;
}

export function assertChannelManager(ctx: Ctx, channel: ChannelRow): number {
  if (!channel.server_id) throw new ApiError(400, 'NOT_A_SERVER_CHANNEL', 'That channel is not part of a server.');
  if (ctx.user!.is_admin) return 0x7fffffff;
  const perms = computeChannelPermissions(ctx.db, ctx.user!.id, channel);
  if (!has(perms, Perm.VIEW_CHANNEL)) throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot even see this channel.');
  const bits = channel.type === 'thread' ? [Perm.MANAGE_THREADS, Perm.MANAGE_CHANNELS] : [Perm.MANAGE_CHANNELS];
  if (!bits.some((bit) => has(perms, bit))) {
    throw new ApiError(403, 'MISSING_PERMISSIONS', 'You lack the required permission. The audacity.');
  }
  return perms;
}

export function getChannelOr404(ctx: Ctx, channelId: string): ChannelRow {
  const channel = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channelId);
  if (!channel) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel fell into the slop pit.');
  return channel;
}

export function getChannelInServer(ctx: Ctx, serverId: string, channelId: string, field = 'channelId'): ChannelRow {
  const channel = getChannelOr404(ctx, channelId);
  if (channel.server_id !== serverId) throw new ValidationError({ [field]: 'That channel belongs to a different server.' });
  return channel;
}

export function categoryParent(
  ctx: Ctx, serverId: string, parentId: unknown, selfId?: string, field = 'parentId', childType?: string,
): string | null {
  if (parentId === undefined || parentId === null || parentId === '') return null;
  const id = String(parentId);
  if (selfId && id === selfId) throw new ValidationError({ [field]: 'A channel cannot be its own parent.' });
  const parent = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', id);
  if (!parent || parent.server_id !== serverId) throw new ValidationError({ [field]: 'Parent channel must belong to this server.' });
  if (childType === 'thread') {
    if (parent.type === 'category') throw new ValidationError({ [field]: 'Threads live under text or forum channels, not categories.' });
    return id;
  }
  if (parent.type !== 'category') throw new ValidationError({ [field]: 'Parent must be a category channel.' });
  return id;
}

export function clearChannelRefs(db: DatabaseWrapper, serverId: string, channelId: string) {
  db.run('UPDATE servers SET welcome_channel_id = NULL WHERE id = ? AND welcome_channel_id = ?', serverId, channelId);
  db.run('UPDATE servers SET system_channel_id = NULL WHERE id = ? AND system_channel_id = ?', serverId, channelId);
}

