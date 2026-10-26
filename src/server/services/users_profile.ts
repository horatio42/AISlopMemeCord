import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import type { UserRow } from '../http';
import type { Achievement, PublicProfile, User, UserStatus } from '../../shared/types';
import { ACHIEVEMENTS } from '../../shared/memes';
import { toUser } from '../repos/users';
import { ValidationError } from '../util/validate';
import { canViewChannel, isServerMember, type ChannelRow } from './permissions';

const ACHIEVEMENT_DEFS = new Map<string, { key: string; name: string; description: string; emoji: string }>(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);

export function decorateAchievements(db: DatabaseWrapper, userId: string): Achievement[] {
  return db.all<{ key: string; earned_at: number }>(
    'SELECT key, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at DESC',
    userId,
  ).map((row) => {
    const def = ACHIEVEMENT_DEFS.get(row.key);
    return {
      key: row.key,
      name: def?.name ?? row.key,
      description: def?.description ?? 'A secret achievement. Suspicious.',
      emoji: def?.emoji ?? '\ud83c\udfc6',
      earnedAt: row.earned_at,
    };
  });
}

export type FriendStatus = NonNullable<PublicProfile['friendStatus']>;

export function friendStatusFor(db: DatabaseWrapper, viewerId: string, targetId: string): FriendStatus {
  if (viewerId === targetId) return 'none';
  if (db.get('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', viewerId, targetId)) return 'blocked';
  if (db.get('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', targetId, viewerId)) return 'blocked_by';
  const friendship = db.get<{ requester_id: string; status: string }>(
    `SELECT requester_id, status FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    viewerId, targetId, targetId, viewerId,
  );
  if (!friendship) return 'none';
  if (friendship.status === 'accepted') return 'friends';
  if (friendship.status === 'blocked') return viewerId === friendship.requester_id ? 'blocked' : 'blocked_by';
  return friendship.requester_id === viewerId ? 'pending_out' : 'pending_in';
}

export function mutualServerIds(db: DatabaseWrapper, viewerId: string, targetId: string): string[] {
  if (viewerId === targetId) {
    return db.all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ? ORDER BY joined_at ASC', viewerId)
      .map((r) => r.server_id);
  }
  return db.all<{ server_id: string }>(
    `SELECT mine.server_id FROM members mine
     JOIN members theirs ON theirs.server_id = mine.server_id
     WHERE mine.user_id = ? AND theirs.user_id = ?
     ORDER BY mine.joined_at ASC`,
    viewerId, targetId,
  ).map((r) => r.server_id);
}

interface ProfileMessageRow {
  id: string; channel_id: string; content: string; score: number; created_at: number;
  channel_name: string; channel_type: string; channel_server_id: string | null;
  server_name: string | null; server_public: number | null;
}

function viewerCanReadProfileMessage(db: DatabaseWrapper, viewerId: string, row: ProfileMessageRow): boolean {
  if (row.channel_type === 'dm' || row.channel_type === 'group_dm') {
    return !!db.get('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', row.channel_id, viewerId);
  }
  if (!row.channel_server_id) return false;
  if (row.server_public) return true; // public server content is discoverable
  if (!isServerMember(db, row.channel_server_id, viewerId)) return false;
  const channel = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', row.channel_id);
  return !!channel && canViewChannel(db, viewerId, channel);
}

export function topMessagesFor(db: DatabaseWrapper, viewerId: string, targetId: string): NonNullable<PublicProfile['topMessages']> {
  const rows = db.all<ProfileMessageRow>(
    `SELECT m.id, m.channel_id, m.content, m.score, m.created_at,
            c.name AS channel_name, c.type AS channel_type, c.server_id AS channel_server_id,
            s.name AS server_name, s.is_public AS server_public
     FROM messages m
     JOIN channels c ON c.id = m.channel_id
     LEFT JOIN servers s ON s.id = c.server_id
     WHERE m.author_id = ? AND m.deleted_at IS NULL AND m.encrypted = 0
       AND m.type = 'default' AND m.content != ''
     ORDER BY m.score DESC, m.created_at DESC LIMIT 60`,
    targetId,
  );
  return rows
    .filter((row) => viewerCanReadProfileMessage(db, viewerId, row))
    .slice(0, 5)
    .map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      serverName: row.server_name,
      content: row.content,
      score: row.score,
      createdAt: row.created_at,
    }));
}

export function overlayStatus(hub: Hub, row: UserRow, viewerId: string): UserStatus {
  return (viewerId === row.id ? row.status : hub.visibleStatus(row.id)) as UserStatus;
}

export function publicProfile(db: DatabaseWrapper, hub: Hub, viewerId: string, row: UserRow): PublicProfile {
  return {
    ...toUser(row),
    status: overlayStatus(hub, row, viewerId),
    serverIds: mutualServerIds(db, viewerId, row.id),
    achievements: decorateAchievements(db, row.id),
    topMessages: topMessagesFor(db, viewerId, row.id),
    friendStatus: friendStatusFor(db, viewerId, row.id),
  };
}

export function searchUsers(db: DatabaseWrapper, hub: Hub, viewerId: string, q: string, limit: number): User[] {
  const needle = q.trim();
  if (needle.length < 2) throw new ValidationError({ q: 'Search needs at least 2 characters. One letter is not a personality.' });
  if (needle.length > 64) throw new ValidationError({ q: 'Search query is too long (max 64 characters).' });
  const escaped = needle.replace(/[\\%_]/g, '\\$&');
  const contains = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const now = Date.now();
  const rows = db.all<UserRow>(
    `SELECT * FROM users
     WHERE disabled = 0 AND (banned_until IS NULL OR banned_until <= ?)
       AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
     ORDER BY CASE WHEN username LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, karma DESC, created_at ASC
     LIMIT ?`,
    now, contains, contains, prefix, limit,
  );
  // Never leak another user's invisible/offline choice through search results.
  return rows.map((row) => ({ ...toUser(row), status: overlayStatus(hub, row, viewerId) }));
}

export function broadcastUserUpdate(db: DatabaseWrapper, hub: Hub, user: User): void {
  const servers = db.all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ?', user.id);
  for (const s of servers) hub.broadcastServer(s.server_id, 'USER_UPDATE', { user });
  const notified = new Set<string>();
  const dms = db.all<{ channel_id: string }>('SELECT channel_id FROM dm_members WHERE user_id = ?', user.id);
  for (const dm of dms) {
    for (const m of db.all<{ user_id: string }>('SELECT user_id FROM dm_members WHERE channel_id = ?', dm.channel_id)) {
      if (m.user_id === user.id || notified.has(m.user_id)) continue;
      notified.add(m.user_id);
      hub.send(m.user_id, 'USER_UPDATE', { user });
    }
  }
}

export interface LeaderboardEntry {
  rank: number;
  user: User;
  karma: number;
  messageCount: number;
}

function messageCountFor(db: DatabaseWrapper, authorId: string, since: number | null): number {
  const row = since
    ? db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE author_id = ? AND deleted_at IS NULL AND created_at >= ?', authorId, since)
    : db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE author_id = ? AND deleted_at IS NULL', authorId);
  return row?.n ?? 0;
}

/**
 * range=all uses users.karma; week/month sum vote values on messages created in
 * the window (the authoritative karma trail, no fabricated numbers).
 */
export function karmaLeaderboard(
  db: DatabaseWrapper, hub: Hub, viewerId: string, range: 'week' | 'month' | 'all', limit: number,
): LeaderboardEntry[] {
  const since = range === 'all' ? null : Date.now() - (range === 'week' ? 7 : 30) * 86400_000;
  const viewer = db.get<UserRow>('SELECT * FROM users WHERE id = ?', viewerId);
  const entries: LeaderboardEntry[] = [];

  if (since === null) {
    const rows = db.all<{ id: string; karma: number }>(
      `SELECT id, karma FROM users WHERE disabled = 0
       ORDER BY karma DESC, created_at ASC LIMIT ?`,
      limit,
    );
    for (const row of rows) {
      const userRow = db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.id);
      if (!userRow) continue;
      entries.push({ rank: entries.length + 1, user: { ...toUser(userRow), status: overlayStatus(hub, userRow, viewerId) }, karma: row.karma, messageCount: messageCountFor(db, row.id, null) });
    }
    if (viewer && !entries.some((e) => e.user.id === viewerId)) {
      const ahead = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE disabled = 0 AND karma > ?', viewer.karma)?.n ?? 0;
      entries.push({
        rank: ahead + 1,
        user: { ...toUser(viewer), status: viewer.status as UserStatus },
        karma: viewer.karma,
        messageCount: messageCountFor(db, viewerId, null),
      });
    }
    return entries;
  }

  const aggregated = db.all<{ id: string; karma: number }>(
    `SELECT m.author_id AS id, SUM(v.value) AS karma
     FROM votes v
     JOIN messages m ON m.id = v.message_id
     JOIN users u ON u.id = m.author_id
     WHERE m.created_at >= ? AND m.deleted_at IS NULL AND u.disabled = 0
     GROUP BY m.author_id
     ORDER BY karma DESC, id ASC LIMIT ?`,
    since, limit,
  );
  for (const row of aggregated) {
    const userRow = db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.id);
    if (!userRow) continue;
    entries.push({
      rank: entries.length + 1,
      user: { ...toUser(userRow), status: overlayStatus(hub, userRow, viewerId) },
      karma: row.karma,
      messageCount: messageCountFor(db, row.id, since),
    });
  }
  if (viewer && !entries.some((e) => e.user.id === viewerId)) {
    const mine = db.get<{ karma: number | null }>(
      `SELECT SUM(v.value) AS karma FROM votes v JOIN messages m ON m.id = v.message_id
       WHERE m.author_id = ? AND m.created_at >= ? AND m.deleted_at IS NULL`,
      viewerId, since,
    );
    const myKarma = mine?.karma ?? 0;
    const ahead = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT m.author_id, SUM(v.value) AS k FROM votes v JOIN messages m ON m.id = v.message_id
         JOIN users u ON u.id = m.author_id
         WHERE m.created_at >= ? AND m.deleted_at IS NULL AND u.disabled = 0
         GROUP BY m.author_id HAVING k > ?
       )`,
      since, myKarma,
    )?.n ?? 0;
    entries.push({
      rank: ahead + 1,
      user: { ...toUser(viewer), status: viewer.status as UserStatus },
      karma: myKarma,
      messageCount: messageCountFor(db, viewerId, since),
    });
  }
  return entries;
}

export function achievementLeaderboard(db: DatabaseWrapper, hub: Hub, viewerId: string, limit = 10): { user: User; count: number }[] {
  const rows = db.all<{ user_id: string; n: number }>(
    `SELECT a.user_id, COUNT(*) AS n FROM achievements a
     JOIN users u ON u.id = a.user_id
     WHERE u.disabled = 0
     GROUP BY a.user_id ORDER BY n DESC, a.user_id ASC LIMIT ?`,
    limit,
  );
  const out: { user: User; count: number }[] = [];
  for (const row of rows) {
    const userRow = db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id);
    if (!userRow) continue;
    out.push({ user: { ...toUser(userRow), status: overlayStatus(hub, userRow, viewerId) }, count: row.n });
  }
  return out;
}
