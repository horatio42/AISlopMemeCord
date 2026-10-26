import type { DatabaseWrapper } from '../db';
import type { UserRow } from '../http';
import type { User, PublicProfile, Achievement, ThemeName, UserStatus } from '../../shared/types';
import { newId } from '../util/ids';

export function parseJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    bannerColor: row.banner_color,
    bio: row.bio,
    pronouns: row.pronouns,
    status: row.status as UserStatus,
    customStatus: row.custom_status,
    isAdmin: !!row.is_admin,
    isBot: !!row.is_bot,
    badges: parseJson<string[]>(row.badges, []),
    karma: row.karma,
    createdAt: row.created_at,
    publicKey: row.public_key,
    theme: row.theme as ThemeName,
  };
}

export function getUser(db: DatabaseWrapper, id: string): UserRow | null {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}
export function getUserByUsername(db: DatabaseWrapper, username: string): UserRow | null {
  return db.get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
}
export function requireUser(db: DatabaseWrapper, id: string): UserRow {
  const u = getUser(db, id);
  if (!u) throw new Error('User not found: ' + id);
  return u;
}

export async function createUser(db: DatabaseWrapper, input: {
  username: string; displayName: string; passwordHash: string; avatar?: string | null;
  isAdmin?: boolean; isBot?: boolean; bio?: string | null; pronouns?: string | null;
}): Promise<UserRow> {
  const id = newId('u');
  const now = Date.now();
  db.run(
    `INSERT INTO users (id, username, display_name, password_hash, avatar, is_admin, is_bot, bio, pronouns, created_at, last_seen_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline')`,
    id, input.username, input.displayName, input.passwordHash, input.avatar ?? null,
    input.isAdmin ? 1 : 0, input.isBot ? 1 : 0, input.bio ?? null, input.pronouns ?? null, now, now,
  );
  return getUser(db, id)!;
}

export function toPublicProfile(row: UserRow, extra: Partial<PublicProfile> = {}): PublicProfile {
  return { ...toUser(row), ...extra };
}

export function achievementsFor(db: DatabaseWrapper, userId: string): Achievement[] {
  return db.all<{ key: string; earned_at: number }>('SELECT key, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at DESC', userId)
    .map((a) => ({ key: a.key, name: a.key, description: '', emoji: '\ud83c\udfc6', earnedAt: a.earned_at }));
}

export function userBadgesFromKarma(karma: number, createdAt: number): string[] {
  const badges: string[] = [];
  if (Date.now() - createdAt > 365 * 86400_000) badges.push('ancient_slop');
  if (karma >= 100) badges.push('slop_celebrity');
  if (karma >= 500) badges.push('touch_grass_denied');
  return badges;
}
