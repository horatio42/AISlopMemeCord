import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import type { UserRow } from '../http';
import { toUser } from '../repos/users';
import { grantAchievement } from './achievements';
import type { Friend, PublicProfile } from '../../shared/types';

export interface FriendshipRow {
  id: string; requester_id: string; addressee_id: string; status: string; created_at: number; updated_at: number;
}

export type FriendStatus = NonNullable<PublicProfile['friendStatus']>;

export function friendshipBetween(db: DatabaseWrapper, a: string, b: string): FriendshipRow | null {
  return db.get<FriendshipRow>(
    `SELECT * FROM friendships
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
     ORDER BY updated_at DESC LIMIT 1`,
    a, b, b, a,
  );
}

export function friendshipDirections(db: DatabaseWrapper, a: string, b: string): { outgoing: FriendshipRow | null; incoming: FriendshipRow | null } {
  return {
    outgoing: db.get<FriendshipRow>('SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ?', a, b),
    incoming: db.get<FriendshipRow>('SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ?', b, a),
  };
}

export function hasBlocked(db: DatabaseWrapper, blockerId: string, blockedId: string): boolean {
  return !!db.get('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', blockerId, blockedId);
}

/** Blocks are mutual walls: either direction prevents DMs, friend requests and group invites. */
export function blockedEither(db: DatabaseWrapper, a: string, b: string): boolean {
  return hasBlocked(db, a, b) || hasBlocked(db, b, a);
}

export function friendStatusFor(db: DatabaseWrapper, viewerId: string, otherId: string): FriendStatus {
  if (hasBlocked(db, viewerId, otherId)) return 'blocked';
  if (hasBlocked(db, otherId, viewerId)) return 'blocked_by';
  const friendship = friendshipBetween(db, viewerId, otherId);
  if (!friendship) return 'none';
  if (friendship.status === 'accepted') return 'friends';
  if (friendship.status === 'pending') return friendship.requester_id === viewerId ? 'pending_out' : 'pending_in';
  return 'none';
}

/** Friend entry from one viewer's perspective. Blocked-by is reported as null so blocks stay quiet. */
export function friendFor(db: DatabaseWrapper, viewerId: string, other: UserRow): Friend | null {
  const status = friendStatusFor(db, viewerId, other.id);
  if (status === 'none' || status === 'blocked_by') return null;
  const friendStatus: Friend['status'] = status === 'friends' ? 'accepted' : status;
  let createdAt = 0;
  if (friendStatus === 'blocked') {
    createdAt = db.get<{ created_at: number }>(
      'SELECT created_at FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', viewerId, other.id,
    )?.created_at ?? 0;
  } else {
    createdAt = friendshipBetween(db, viewerId, other.id)?.created_at ?? 0;
  }
  return { user: toUser(other), status: friendStatus, createdAt };
}

export function friendUpdatePayload(db: DatabaseWrapper, viewerId: string, otherId: string) {
  const other = db.get<UserRow>('SELECT * FROM users WHERE id = ?', otherId);
  return { userId: otherId, friend: other ? friendFor(db, viewerId, other) : null };
}

/** Notify both sides of a friendship/block change; each gets their own perspective. */
export function broadcastFriendUpdate(db: DatabaseWrapper, hub: Hub, a: string, b: string) {
  hub.send(a, 'FRIEND_UPDATE', friendUpdatePayload(db, a, b));
  hub.send(b, 'FRIEND_UPDATE', friendUpdatePayload(db, b, a));
}

export function friendAchievements(db: DatabaseWrapper, hub: Hub | null, a: string, b: string) {
  grantAchievement(db, hub, a, 'friend');
  grantAchievement(db, hub, b, 'friend');
}

export interface FriendLists {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
  blocked: Friend[];
}

function entryFor(db: DatabaseWrapper, otherId: string, status: Friend['status'], createdAt: number): Friend | null {
  const row = db.get<UserRow>('SELECT * FROM users WHERE id = ?', otherId);
  return row ? { user: toUser(row), status, createdAt } : null;
}

/** Private lists for the caller only; blocked_by is never disclosed. */
export function friendLists(db: DatabaseWrapper, userId: string): FriendLists {
  const accepted = db.all<FriendshipRow>(
    `SELECT * FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
     ORDER BY updated_at DESC`,
    userId, userId,
  );
  const incoming = db.all<FriendshipRow>(
    `SELECT * FROM friendships WHERE status = 'pending' AND addressee_id = ? ORDER BY updated_at DESC`,
    userId,
  );
  const outgoing = db.all<FriendshipRow>(
    `SELECT * FROM friendships WHERE status = 'pending' AND requester_id = ? ORDER BY updated_at DESC`,
    userId,
  );
  const blocks = db.all<{ blocked_id: string; created_at: number }>(
    'SELECT blocked_id, created_at FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC',
    userId,
  );
  const collect = (rows: FriendshipRow[], status: Friend['status']) => rows
    .map((f) => entryFor(db, f.requester_id === userId ? f.addressee_id : f.requester_id, status, f.created_at))
    .filter((f): f is Friend => !!f);
  return {
    friends: collect(accepted, 'accepted'),
    incoming: collect(incoming, 'pending_in'),
    outgoing: collect(outgoing, 'pending_out'),
    blocked: blocks.map((b) => entryFor(db, b.blocked_id, 'blocked', b.created_at)).filter((f): f is Friend => !!f),
  };
}
