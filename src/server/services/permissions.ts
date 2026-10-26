import { Perm, has } from '../../shared/permissions';
import { ApiError, type Ctx } from '../http';

export interface RoleRow {
  id: string; server_id: string; name: string; color: string; position: number;
  permissions: number; mentionable: number; hoist: number; is_default: number; icon: string | null; created_at: number;
}
export interface ChannelRow {
  id: string; server_id: string | null; type: string; name: string; topic: string | null;
  nsfw: number; slowmode: number; position: number; parent_id: string | null; locked: number;
  archived: number; last_message_id: string | null; tags: string; icon: string | null;
  default_sort: string | null; voting_enabled: number; origin_message_id: string | null; created_at: number;
}

export function getServer(db: Ctx['db'], serverId: string) {
  return db.get<{ id: string; owner_id: string; name: string }>('SELECT id, owner_id, name FROM servers WHERE id = ?', serverId);
}

export function isServerMember(db: Ctx['db'], serverId: string, userId: string): boolean {
  return !!db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', serverId, userId);
}

export function getMemberRoles(db: Ctx['db'], serverId: string, userId: string): RoleRow[] {
  return db.all<RoleRow>(
    `SELECT r.* FROM roles r
     JOIN member_roles mr ON mr.role_id = r.id
     WHERE r.server_id = ? AND mr.user_id = ? ORDER BY r.position DESC`,
    serverId, userId,
  );
}

export function getEveryoneRole(db: Ctx['db'], serverId: string): RoleRow | null {
  return db.get<RoleRow>('SELECT * FROM roles WHERE server_id = ? AND is_default = 1 LIMIT 1', serverId);
}

export function computeBasePermissions(db: Ctx['db'], serverId: string, userId: string): { permissions: number; isOwner: boolean; topPosition: number; roles: RoleRow[] } {
  const server = getServer(db, serverId);
  if (!server) return { permissions: 0, isOwner: false, topPosition: 0, roles: [] };
  if (!isServerMember(db, serverId, userId)) return { permissions: 0, isOwner: false, topPosition: 0, roles: [] };
  const roles = getMemberRoles(db, serverId, userId);
  const everyone = getEveryoneRole(db, serverId);
  let permissions = everyone ? everyone.permissions : 0;
  for (const role of roles) {
    if (role.is_default) continue;
    permissions |= role.permissions;
  }
  const isOwner = server.owner_id === userId;
  if (isOwner) permissions |= Perm.ADMINISTRATOR;
  const topPosition = roles.length ? Math.max(...roles.map((r) => r.position)) : 0;
  return { permissions, isOwner, topPosition, roles };
}

function applyOverwrites(base: number, overwrites: { target_type: string; target_id: string; allow: number; deny: number }[], everyoneId: string | null, roleIds: string[], userId: string): number {
  let perms = base;
  const everyoneOw = overwrites.find((o) => o.target_type === 'role' && o.target_id === everyoneId);
  if (everyoneOw) perms = (perms & ~everyoneOw.deny) | everyoneOw.allow;
  let deny = 0, allow = 0;
  for (const o of overwrites) {
    if (o.target_type === 'role' && o.target_id !== everyoneId && roleIds.includes(o.target_id)) { deny |= o.deny; allow |= o.allow; }
  }
  perms = (perms & ~deny) | allow;
  const memberOw = overwrites.find((o) => o.target_type === 'user' && o.target_id === userId);
  if (memberOw) perms = (perms & ~memberOw.deny) | memberOw.allow;
  return perms;
}

export function computeChannelPermissions(db: Ctx['db'], userId: string, channel: ChannelRow): number {
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    const member = db.get('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', channel.id, userId);
    return member ? 0x7fffffff : 0;
  }
  if (!channel.server_id) return 0;
  const base = computeBasePermissions(db, channel.server_id, userId);
  if (!isServerMember(db, channel.server_id, userId)) return 0;
  if (has(base.permissions, Perm.ADMINISTRATOR)) return base.permissions;
  const everyone = getEveryoneRole(db, channel.server_id);
  const roleIds = base.roles.map((r) => r.id);
  let perms = base.permissions;
  const channelIds: ChannelRow[] = [];
  let cursor: ChannelRow | null = channel;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    channelIds.push(cursor);
    if (!cursor.parent_id) break;
    cursor = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', cursor.parent_id);
  }
  // Parent-first: category / parent channel overwrites apply before the channel itself.
  for (const ch of channelIds.reverse()) {
    const overwrites = db.all<{ target_type: string; target_id: string; allow: number; deny: number }>(
      'SELECT target_type, target_id, allow, deny FROM channel_overrides WHERE channel_id = ?', ch.id,
    );
    perms = applyOverwrites(perms, overwrites, everyone?.id ?? null, roleIds, userId);
  }
  return perms;
}

export function canViewChannel(db: Ctx['db'], userId: string, channel: ChannelRow): boolean {
  if (channel.locked && channel.type !== 'thread') {
    const perms = computeChannelPermissions(db, userId, channel);
    return has(perms, Perm.VIEW_CHANNEL);
  }
  return has(computeChannelPermissions(db, userId, channel), Perm.VIEW_CHANNEL);
}

export function channelForUser(ctx: Ctx, channelId: string, permission?: number): ChannelRow {
  const channel = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channelId);
  if (!channel) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel fell into the slop pit.');
  if (channel.server_id) {
    if (!isServerMember(ctx.db, channel.server_id, ctx.user!.id) && !ctx.user!.is_admin) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel fell into the slop pit.');
    }
    const perms = ctx.user!.is_admin ? 0x7fffffff : computeChannelPermissions(ctx.db, ctx.user!.id, channel);
    if (!has(perms, Perm.VIEW_CHANNEL)) throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot even see this channel. Classic.');
    if (permission && !has(perms, permission)) throw new ApiError(403, 'MISSING_PERMISSIONS', 'You do not have permission to do that.');
  } else {
    const member = ctx.db.get('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', channelId, ctx.user!.id);
    if (!member) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That conversation is not yours.');
  }
  return channel;
}

export function assertServerMember(ctx: Ctx, serverId: string): { permissions: number; isOwner: boolean; topPosition: number; roles: RoleRow[] } {
  const base = computeBasePermissions(ctx.db, serverId, ctx.user!.id);
  if (!base.roles.length && !isServerMember(ctx.db, serverId, ctx.user!.id)) {
    if (!ctx.user!.is_admin) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  }
  return base;
}

export function assertServerPermission(ctx: Ctx, serverId: string, permission: number): { permissions: number; isOwner: boolean; topPosition: number; roles: RoleRow[] } {
  const base = assertServerMember(ctx, serverId);
  if (ctx.user!.is_admin || has(base.permissions, Perm.ADMINISTRATOR) || has(base.permissions, permission)) return base;
  throw new ApiError(403, 'MISSING_PERMISSIONS', 'You lack the required permission. The audacity.');
}

export function assertChannelPermission(ctx: Ctx, channel: ChannelRow, permission: number): number {
  if (!ctx.user!.is_admin) {
    const perms = computeChannelPermissions(ctx.db, ctx.user!.id, channel);
    if (!has(perms, Perm.VIEW_CHANNEL)) throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot see this channel.');
    if (!has(perms, permission)) throw new ApiError(403, 'MISSING_PERMISSIONS', 'You lack the required permission. The audacity.');
    return perms;
  }
  return 0x7fffffff;
}

export function canManageRole(actorTop: number, isOwner: boolean, targetRole: RoleRow): boolean {
  return isOwner || targetRole.position < actorTop;
}
