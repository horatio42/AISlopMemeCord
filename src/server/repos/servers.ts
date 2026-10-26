import type { DatabaseWrapper } from '../db';
import { parseJson, toUser } from './users';
import type { UserRow } from '../http';
import type { Server, Channel, Role, ServerMember, ChannelOverride, ChannelType } from '../../shared/types';
import type { RoleRow, ChannelRow } from '../services/permissions';

export interface ServerRow {
  id: string; name: string; icon: string | null; banner: string | null; banner_color: string | null;
  description: string | null; owner_id: string; member_count: number; is_public: number; nsfw: number;
  welcome_channel_id: string | null; system_channel_id: string | null; motd: string | null;
  traits: string; created_at: number;
}
export interface MemberRow {
  server_id: string; user_id: string; nickname: string | null; joined_at: number; timeout_until: number | null;
}

export function toServer(row: ServerRow): Server {
  return {
    id: row.id, name: row.name, icon: row.icon, banner: row.banner, bannerColor: row.banner_color,
    description: row.description, ownerId: row.owner_id, memberCount: row.member_count,
    createdAt: row.created_at, isPublic: !!row.is_public, nsfw: !!row.nsfw,
    welcomeChannelId: row.welcome_channel_id, systemChannelId: row.system_channel_id,
    motd: row.motd, traits: parseJson<string[]>(row.traits, []),
  };
}

export function toRole(row: RoleRow, memberCount?: number): Role {
  return {
    id: row.id, serverId: row.server_id, name: row.name, color: row.color, position: row.position,
    permissions: row.permissions, mentionable: !!row.mentionable, hoist: !!row.hoist,
    isDefault: !!row.is_default, icon: row.icon, memberCount,
  };
}

export function toChannel(row: ChannelRow, extra: Partial<Channel> = {}): Channel {
  return {
    id: row.id, serverId: row.server_id, type: row.type as ChannelType, name: row.name,
    topic: row.topic, nsfw: !!row.nsfw, slowmode: row.slowmode, position: row.position,
    parentId: row.parent_id, locked: !!row.locked, archived: !!row.archived,
    lastMessageId: row.last_message_id, createdAt: row.created_at,
    tags: parseJson<string[]>(row.tags, []), icon: row.icon,
    defaultSort: row.default_sort as Channel['defaultSort'], votingEnabled: !!row.voting_enabled,
    originMessageId: row.origin_message_id, ...extra,
  };
}

export function getServerRow(db: DatabaseWrapper, serverId: string): ServerRow | null {
  return db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', serverId);
}

export function getMemberRow(db: DatabaseWrapper, serverId: string, userId: string): MemberRow | null {
  return db.get<MemberRow>('SELECT * FROM members WHERE server_id = ? AND user_id = ?', serverId, userId);
}

export function memberRoleIds(db: DatabaseWrapper, serverId: string, userId: string): string[] {
  return db.all<{ role_id: string }>('SELECT role_id FROM member_roles WHERE server_id = ? AND user_id = ?', serverId, userId).map((r) => r.role_id);
}

export function toMember(db: DatabaseWrapper, row: MemberRow, userRow?: UserRow | null): ServerMember {
  const user = userRow ?? db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id);
  return {
    serverId: row.server_id,
    user: toUser(user!),
    nickname: row.nickname,
    roles: memberRoleIds(db, row.server_id, row.user_id),
    joinedAt: row.joined_at,
    timeoutUntil: row.timeout_until,
  };
}

export function rolesForServer(db: DatabaseWrapper, serverId: string): RoleRow[] {
  return db.all<RoleRow>('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC, created_at ASC', serverId);
}

export function channelsForServer(db: DatabaseWrapper, serverId: string): ChannelRow[] {
  return db.all<ChannelRow>('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC', serverId);
}

export function overridesForChannel(db: DatabaseWrapper, channelId: string): ChannelOverride[] {
  return db.all<{ target_type: string; target_id: string; allow: number; deny: number }>(
    'SELECT target_type, target_id, allow, deny FROM channel_overrides WHERE channel_id = ?', channelId,
  ).map((o) => ({ targetType: o.target_type as 'role' | 'user', targetId: o.target_id, allow: o.allow, deny: o.deny }));
}

export function incrementMemberCount(db: DatabaseWrapper, serverId: string, delta: number) {
  db.run('UPDATE servers SET member_count = MAX(0, member_count + ?) WHERE id = ?', delta, serverId);
}

export function defaultRole(db: DatabaseWrapper, serverId: string): RoleRow | null {
  return db.get<RoleRow>('SELECT * FROM roles WHERE server_id = ? AND is_default = 1', serverId);
}

export function unreadCounts(db: DatabaseWrapper, userId: string): Record<string, { count: number; mentions: number; lastReadId: string | null }> {
  const out: Record<string, { count: number; mentions: number; lastReadId: string | null }> = {};
  const rows = db.all<{ channel_id: string; last_read_id: string | null; mention_count: number }>(
    'SELECT channel_id, last_read_id, mention_count FROM read_states WHERE user_id = ?', userId,
  );
  for (const r of rows) {
    out[r.channel_id] = { count: 0, mentions: r.mention_count, lastReadId: r.last_read_id };
    if (r.last_read_id) {
      const row = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND id > ? AND deleted_at IS NULL AND author_id != ?`,
        r.channel_id, r.last_read_id, userId,
      );
      out[r.channel_id]!.count = row?.n ?? 0;
    }
  }
  return out;
}
