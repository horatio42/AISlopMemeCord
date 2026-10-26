import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import type { UserRow } from '../http';
import { ApiError } from '../http';
import { toUser } from '../repos/users';
import { serializeMessages, type MessageRow } from '../repos/messages';
import { newId } from '../util/ids';
import type { DMChannel, Message, User } from '../../shared/types';

export const DM_MAX_MEMBERS = 10;

export interface DmChannelRow {
  id: string; server_id: string | null; type: string; name: string; topic: string | null; nsfw: number;
  slowmode: number; position: number; parent_id: string | null; locked: number; archived: number;
  last_message_id: string | null; tags: string; icon: string | null; default_sort: string | null;
  voting_enabled: number; origin_message_id: string | null; created_at: number;
}

export interface DmMemberRow {
  channel_id: string; user_id: string; joined_at: number; last_read_id: string | null; closed: number;
}

interface MemberUserRow extends UserRow {
  channel_id: string;
  joined_at: number;
  closed: number;
  dm_last_read_id: string | null;
}

export function dmNotFound(): ApiError {
  return new ApiError(404, 'DM_NOT_FOUND', "That conversation is not in your inbox. Maybe it never existed. Schrodinger's DM.");
}

export function dmChannelRow(db: DatabaseWrapper, channelId: string): DmChannelRow | null {
  return db.get<DmChannelRow>(
    `SELECT * FROM channels WHERE id = ? AND server_id IS NULL AND type IN ('dm', 'group_dm')`,
    channelId,
  );
}

export function dmMembership(db: DatabaseWrapper, channelId: string, userId: string): DmMemberRow | null {
  return db.get<DmMemberRow>('SELECT * FROM dm_members WHERE channel_id = ? AND user_id = ?', channelId, userId);
}

/** Membership gate for every /api/dms/:id route. Non-members get a 404 so channel existence never leaks. */
export function requireDmMembership(db: DatabaseWrapper, channelId: string, userId: string): { channel: DmChannelRow; membership: DmMemberRow } {
  const channel = dmChannelRow(db, channelId);
  if (!channel) throw dmNotFound();
  const membership = dmMembership(db, channelId, userId);
  if (!membership) throw dmNotFound();
  return { channel, membership };
}

export function dmMemberIds(db: DatabaseWrapper, channelId: string): string[] {
  return db.all<{ user_id: string }>('SELECT user_id FROM dm_members WHERE channel_id = ?', channelId).map((r) => r.user_id);
}

export function dmMembers(db: DatabaseWrapper, channelId: string): UserRow[] {
  return db.all<UserRow>(
    `SELECT u.* FROM dm_members dm JOIN users u ON u.id = dm.user_id
     WHERE dm.channel_id = ? ORDER BY dm.joined_at ASC, dm.rowid ASC`,
    channelId,
  );
}

/**
 * Group ownership isn't stored in the schema: the creator is the earliest dm_members row, so ownership
 * transfers to the next-oldest member if the owner leaves. 1:1 DMs have no owner.
 */
export function groupOwnerId(db: DatabaseWrapper, channelId: string): string | null {
  return db.get<{ user_id: string }>(
    'SELECT user_id FROM dm_members WHERE channel_id = ? ORDER BY joined_at ASC, rowid ASC LIMIT 1',
    channelId,
  )?.user_id ?? null;
}

export function isGroupOwner(db: DatabaseWrapper, channelId: string, userId: string): boolean {
  return groupOwnerId(db, channelId) === userId;
}

/** Find an existing 1:1 channel containing exactly these two users, closed or not. */
export function findDirectDm(db: DatabaseWrapper, a: string, b: string): DmChannelRow | null {
  return db.get<DmChannelRow>(
    `SELECT c.* FROM channels c
     JOIN dm_members ma ON ma.channel_id = c.id AND ma.user_id = ?
     JOIN dm_members mb ON mb.channel_id = c.id AND mb.user_id = ?
     WHERE c.server_id IS NULL AND c.type = 'dm'
       AND (SELECT COUNT(*) FROM dm_members x WHERE x.channel_id = c.id) = 2
     ORDER BY c.created_at ASC LIMIT 1`,
    a, b,
  );
}

export function insertDmChannel(db: DatabaseWrapper, input: {
  type: 'dm' | 'group_dm';
  name: string;
  icon?: string | null;
  memberIds: string[];
}): DmChannelRow {
  const id = newId('c');
  const now = Date.now();
  db.run(
    `INSERT INTO channels (id, server_id, type, name, icon, created_at) VALUES (?, NULL, ?, ?, ?, ?)`,
    id, input.type, input.name, input.icon ?? null, now,
  );
  // Insertion order is creator-first; groupOwnerId relies on it for joined_at ties.
  for (const userId of input.memberIds) {
    db.run('INSERT INTO dm_members (channel_id, user_id, joined_at, closed) VALUES (?, ?, ?, 0)', id, userId, now);
  }
  return db.get<DmChannelRow>('SELECT * FROM channels WHERE id = ?', id)!;
}

export function dmChannelsForUser(db: DatabaseWrapper, userId: string, includeClosed = false): DmChannelRow[] {
  return db.all<DmChannelRow>(
    `SELECT c.* FROM dm_members dm JOIN channels c ON c.id = dm.channel_id
     WHERE dm.user_id = ? AND c.server_id IS NULL AND c.type IN ('dm', 'group_dm')
       ${includeClosed ? '' : 'AND dm.closed = 0'}
     ORDER BY c.created_at DESC`,
    userId,
  );
}

interface ChannelStats { unread: number; mentions: number; lastReadId: string | null }

/** Batched unread/mention arithmetic so a 30-DM sidebar stays one query family. */
function statsForViewer(db: DatabaseWrapper, viewerId: string, channelIds: string[]): Map<string, ChannelStats> {
  const out = new Map<string, ChannelStats>();
  if (!channelIds.length) return out;
  const ph = channelIds.map(() => '?').join(',');
  const lastReads = new Map(
    db.all<{ channel_id: string; last_read_id: string | null }>(
      `SELECT channel_id, last_read_id FROM read_states WHERE user_id = ? AND channel_id IN (${ph})`,
      viewerId, ...channelIds,
    ).map((r) => [r.channel_id, r.last_read_id]),
  );
  const memberReads = new Map(
    db.all<{ channel_id: string; last_read_id: string | null }>(
      `SELECT channel_id, last_read_id FROM dm_members WHERE user_id = ? AND channel_id IN (${ph})`,
      viewerId, ...channelIds,
    ).map((r) => [r.channel_id, r.last_read_id]),
  );
  for (const id of channelIds) {
    out.set(id, { unread: 0, mentions: 0, lastReadId: lastReads.get(id) ?? memberReads.get(id) ?? null });
  }
  const unread = db.all<{ channel_id: string; n: number }>(
    `SELECT m.channel_id AS channel_id, COUNT(*) AS n
     FROM messages m
     JOIN dm_members dm ON dm.channel_id = m.channel_id AND dm.user_id = ?
     LEFT JOIN read_states rs ON rs.channel_id = m.channel_id AND rs.user_id = ?
     WHERE m.channel_id IN (${ph}) AND m.deleted_at IS NULL AND m.author_id != ?
       AND m.id > COALESCE(rs.last_read_id, dm.last_read_id, '')
     GROUP BY m.channel_id`,
    viewerId, viewerId, ...channelIds, viewerId,
  );
  for (const row of unread) {
    const entry = out.get(row.channel_id);
    if (entry) entry.unread = row.n;
  }
  const mentions = db.all<{ channel_id: string; n: number }>(
    `SELECT m.channel_id AS channel_id, COUNT(*) AS n
     FROM message_mentions mm
     JOIN messages m ON m.id = mm.message_id
     JOIN dm_members dm ON dm.channel_id = m.channel_id AND dm.user_id = ?
     LEFT JOIN read_states rs ON rs.channel_id = m.channel_id AND rs.user_id = ?
     WHERE mm.mention_type = 'user' AND mm.target_id = ? AND m.channel_id IN (${ph})
       AND m.deleted_at IS NULL AND m.author_id != ?
       AND m.id > COALESCE(rs.last_read_id, dm.last_read_id, '')
     GROUP BY m.channel_id`,
    viewerId, viewerId, viewerId, ...channelIds, viewerId,
  );
  for (const row of mentions) {
    const entry = out.get(row.channel_id);
    if (entry) entry.mentions = row.n;
  }
  return out;
}

/**
 * Build DMChannel DTOs for a viewer in one pass: members, last message, unread + mention counts.
 * 1:1 names/icons are derived from the other member so the stored channel row stays symmetric.
 */
export function buildDmChannels(db: DatabaseWrapper, viewerId: string, channels: DmChannelRow[]): DMChannel[] {
  if (!channels.length) return [];
  const ids = channels.map((c) => c.id);
  const ph = ids.map(() => '?').join(',');
  const memberRows = db.all<MemberUserRow>(
    `SELECT dm.channel_id, dm.joined_at, dm.closed, dm.last_read_id AS dm_last_read_id, u.*
     FROM dm_members dm JOIN users u ON u.id = dm.user_id
     WHERE dm.channel_id IN (${ph}) ORDER BY dm.joined_at ASC, dm.rowid ASC`,
    ...ids,
  );
  const membersByChannel = new Map<string, User[]>();
  for (const row of memberRows) {
    const list = membersByChannel.get(row.channel_id) ?? [];
    list.push(toUser(row));
    membersByChannel.set(row.channel_id, list);
  }

  const lastRows = db.all<MessageRow>(
    `SELECT m.* FROM messages m
     WHERE m.channel_id IN (${ph}) AND m.deleted_at IS NULL
       AND m.id = (SELECT MAX(x.id) FROM messages x WHERE x.channel_id = m.channel_id AND x.deleted_at IS NULL)`,
    ...ids,
  );
  const lastByChannel = new Map<string, Message>();
  for (const message of serializeMessages(db, lastRows, viewerId)) lastByChannel.set(message.channelId, message);

  const stats = statsForViewer(db, viewerId, ids);

  return channels.map((channel) => {
    const members = membersByChannel.get(channel.id) ?? [];
    const isGroup = channel.type === 'group_dm';
    const other = members.find((m) => m.id !== viewerId) ?? null;
    const stat = stats.get(channel.id) ?? { unread: 0, mentions: 0, lastReadId: null };
    return {
      id: channel.id,
      type: isGroup ? 'group_dm' : 'dm',
      name: isGroup ? channel.name : other ? other.displayName || other.username : channel.name,
      icon: isGroup ? channel.icon : other?.avatar ?? null,
      members,
      lastMessage: lastByChannel.get(channel.id) ?? null,
      ownerId: isGroup ? members[0]?.id ?? null : null,
      unreadCount: stat.unread,
      mentionCount: stat.mentions,
      createdAt: channel.created_at,
      lastReadId: stat.lastReadId,
    };
  });
}

export function buildDmChannel(db: DatabaseWrapper, channel: DmChannelRow, viewerId: string): DMChannel {
  return buildDmChannels(db, viewerId, [channel])[0]!;
}

/** Sidebar order: most recent activity first, new-empty channels after. */
export function listDmChannels(db: DatabaseWrapper, userId: string): DMChannel[] {
  const channels = dmChannelsForUser(db, userId);
  return buildDmChannels(db, userId, channels).sort((a, b) => {
    const at = a.lastMessage?.createdAt ?? a.createdAt;
    const bt = b.lastMessage?.createdAt ?? b.createdAt;
    if (bt !== at) return bt - at;
    return b.createdAt - a.createdAt;
  });
}

function sendPerMember(db: DatabaseWrapper, hub: Hub, channelId: string, event: 'DM_CREATE' | 'DM_UPDATE', memberIds?: string[]) {
  hub.invalidateChannel(channelId);
  const channel = dmChannelRow(db, channelId);
  if (!channel) return;
  const ids = memberIds ?? dmMemberIds(db, channelId);
  for (const userId of ids) {
    if (!dmMembership(db, channelId, userId)) continue;
    hub.send(userId, event, { channel: buildDmChannel(db, channel, userId) });
  }
}

export function broadcastDmCreate(db: DatabaseWrapper, hub: Hub, channelId: string, memberIds?: string[]) {
  sendPerMember(db, hub, channelId, 'DM_CREATE', memberIds);
}

export function broadcastDmUpdate(db: DatabaseWrapper, hub: Hub, channelId: string, memberIds?: string[]) {
  sendPerMember(db, hub, channelId, 'DM_UPDATE', memberIds);
}

/** Tell specific users the conversation vanished for them (deleted, closed, or they left). */
export function broadcastDmGone(hub: Hub, channelId: string, userIds: string[]) {
  for (const userId of userIds) hub.send(userId, 'DM_UPDATE', { channelId, channel: null });
}
