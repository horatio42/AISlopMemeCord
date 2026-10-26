import type { DatabaseWrapper } from '../db';
import { ApiError, type Ctx } from '../http';
import { Perm, has } from '../../shared/permissions';
import { assertServerPermission, type RoleRow } from './permissions';
import { getServerRow, memberRoleIds, rolesForServer, toRole, type ServerRow } from '../repos/servers';
import { getMember } from '../repos/members_repo';
import { logAudit } from './audit';
import { assertCanGrantPermissions, type ActorContext } from './members_moderation';
import { newId } from '../util/ids';
import type { Role } from '../../shared/types';

const MAX_POSITION = 1_000_000;

function roleRow(db: DatabaseWrapper, roleId: string): RoleRow | null {
  return db.get<RoleRow>('SELECT * FROM roles WHERE id = ?', roleId);
}

function serverForRole(ctx: Ctx, roleId: string): { role: RoleRow; server: ServerRow } {
  const role = roleRow(ctx.db, roleId);
  if (!role) throw new ApiError(404, 'ROLE_NOT_FOUND', 'That role was deleted by the slop void.');
  const server = getServerRow(ctx.db, role.server_id);
  if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  return { role, server };
}

export function roleDto(db: DatabaseWrapper, row: RoleRow): Role {
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM member_roles WHERE role_id = ?', row.id)?.n ?? 0;
  return toRole(row, count);
}

export function roleDtos(db: DatabaseWrapper, serverId: string): Role[] {
  const rows = rolesForServer(db, serverId);
  if (!rows.length) return [];
  const counts = new Map<string, number>();
  for (const row of db.all<{ role_id: string; n: number }>(
    'SELECT role_id, COUNT(*) AS n FROM member_roles WHERE server_id = ? GROUP BY role_id', serverId,
  )) counts.set(row.role_id, row.n);
  return rows.map((row) => toRole(row, counts.get(row.id) ?? 0));
}

/** Owner bypasses hierarchy; @everyone edits are reserved for owner/administrator. */
function assertCanManageRole(actor: ActorContext, role: RoleRow): void {
  if (role.is_default) {
    if (!actor.isOwner && !has(actor.permissions, Perm.ADMINISTRATOR)) {
      throw new ApiError(403, 'ROLE_HIERARCHY', 'The @everyone role is sacred. Only the owner or an administrator may edit it.');
    }
    return;
  }
  if (!actor.isOwner && role.position >= actor.topPosition) {
    throw new ApiError(403, 'ROLE_HIERARCHY', 'That role sits at or above your highest role. You cannot manage it.');
  }
}

function assertPositionBelow(actor: ActorContext, position: number): void {
  if (!actor.isOwner && position >= actor.topPosition) {
    throw new ApiError(403, 'ROLE_HIERARCHY', 'You cannot place a role at or above your own highest role. Ambition has limits.');
  }
}

function assertPositionValue(position: number): void {
  if (!Number.isInteger(position) || position < 0 || position > MAX_POSITION) {
    throw new ApiError(400, 'INVALID_POSITION', `Role positions must be integers between 0 and ${MAX_POSITION}.`);
  }
}

export interface RoleInput {
  name?: string;
  color?: string;
  permissions?: number;
  hoist?: boolean;
  mentionable?: boolean;
  icon?: string | null;
}

export function createRole(ctx: Ctx, serverId: string, input: RoleInput): Role {
  const server = getServerRow(ctx.db, serverId);
  if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  const actor = assertServerPermission(ctx, serverId, Perm.MANAGE_ROLES);
  if (!input.name) throw new ApiError(400, 'VALIDATION_ERROR', 'A role needs a name, even a bad one.');
  const permissions = input.permissions ?? 0;
  assertCanGrantPermissions(actor, permissions);
  const existing = rolesForServer(ctx.db, serverId);
  const maxPosition = existing.reduce((max, r) => Math.max(max, r.position), 0);
  let position: number;
  if (actor.isOwner) position = maxPosition + 1;
  else {
    if (actor.topPosition < 2) {
      throw new ApiError(403, 'ROLE_HIERARCHY', 'You need a role strictly above @everyone before you can invent new roles.');
    }
    position = Math.min(maxPosition + 1, actor.topPosition - 1);
  }
  assertPositionValue(position);
  assertPositionBelow(actor, position);
  const id = newId('r');
  const now = Date.now();
  const color = input.color ?? '#99aab5';
  ctx.db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, icon, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id, serverId, input.name, color, position, permissions, input.hoist ? 1 : 0, input.mentionable ? 1 : 0,
    input.icon ?? null, now,
  );
  const row = roleRow(ctx.db, id)!;
  const dto = roleDto(ctx.db, row);
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'ROLE_CREATE', targetType: 'role', targetId: id,
    changes: { name: row.name, color: row.color, position: row.position, permissions: row.permissions, hoist: !!row.hoist, mentionable: !!row.mentionable },
  });
  ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'ROLE_CREATE', { serverId, role: dto });
  return dto;
}

export type RolePatchInput = RoleInput & { position?: number };

export function updateRole(ctx: Ctx, roleId: string, input: RolePatchInput): Role {
  const { role, server } = serverForRole(ctx, roleId);
  const actor = assertServerPermission(ctx, server.id, Perm.MANAGE_ROLES);
  assertCanManageRole(actor, role);
  if (input.permissions !== undefined) assertCanGrantPermissions(actor, input.permissions);

  const next = {
    name: input.name ?? role.name,
    color: input.color ?? role.color,
    position: role.position,
    permissions: input.permissions ?? role.permissions,
    hoist: input.hoist === undefined ? !!role.hoist : !!input.hoist,
    mentionable: input.mentionable === undefined ? !!role.mentionable : !!input.mentionable,
    icon: input.icon === undefined ? role.icon : input.icon,
  };

  if (role.is_default) {
    if (input.name !== undefined && input.name !== role.name) {
      throw new ApiError(400, 'DEFAULT_ROLE_NAME', 'The @everyone role cannot be renamed. It is eternal.');
    }
    if (input.position !== undefined && input.position !== role.position) {
      throw new ApiError(400, 'DEFAULT_ROLE_POSITION', '@everyone always sits at the bottom. That is its whole personality.');
    }
  } else if (input.position !== undefined) {
    assertPositionValue(input.position);
    assertPositionBelow(actor, input.position);
    next.position = input.position;
  }
  if (next.name.trim().length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'A role needs a name, even a bad one.');

  ctx.db.run(
    `UPDATE roles SET name = ?, color = ?, position = ?, permissions = ?, hoist = ?, mentionable = ?, icon = ? WHERE id = ?`,
    next.name, next.color, next.position, next.permissions, next.hoist ? 1 : 0, next.mentionable ? 1 : 0, next.icon, role.id,
  );
  const row = roleRow(ctx.db, role.id)!;
  const dto = roleDto(ctx.db, row);
  const changedKeys = Object.keys(input).filter((k) => k !== 'position' || !role.is_default);
  logAudit(ctx.db, {
    serverId: server.id, actorId: ctx.user!.id, action: 'ROLE_UPDATE', targetType: 'role', targetId: role.id,
    changes: {
      fields: changedKeys,
      before: { name: role.name, color: role.color, position: role.position, permissions: role.permissions, hoist: !!role.hoist, mentionable: !!role.mentionable, icon: role.icon },
      after: { name: row.name, color: row.color, position: row.position, permissions: row.permissions, hoist: !!row.hoist, mentionable: !!row.mentionable, icon: row.icon },
    },
  });
  ctx.hub.invalidateServer(server.id);
  ctx.hub.broadcastServer(server.id, 'ROLE_UPDATE', { serverId: server.id, role: dto });
  return dto;
}

export function deleteRole(ctx: Ctx, roleId: string): void {
  const { role, server } = serverForRole(ctx, roleId);
  const actor = assertServerPermission(ctx, server.id, Perm.MANAGE_ROLES);
  assertCanManageRole(actor, role);
  if (role.is_default) {
    throw new ApiError(400, 'DEFAULT_ROLE_DELETE', 'You cannot delete @everyone. Everyone would be sad, and also permissionless.');
  }
  ctx.db.transaction(() => {
    ctx.db.run("DELETE FROM channel_overrides WHERE target_type = 'role' AND target_id = ?", role.id);
    ctx.db.run('DELETE FROM roles WHERE id = ?', role.id);
  });
  logAudit(ctx.db, {
    serverId: server.id, actorId: ctx.user!.id, action: 'ROLE_DELETE', targetType: 'role', targetId: role.id,
    changes: { name: role.name, position: role.position, permissions: role.permissions },
  });
  ctx.hub.invalidateServer(server.id);
  ctx.hub.broadcastServer(server.id, 'ROLE_DELETE', { serverId: server.id, roleId: role.id });
}

export interface RolePosition {
  id: string;
  position: number;
}

export function reorderRoles(ctx: Ctx, serverId: string, positions: RolePosition[]): Role[] {
  const server = getServerRow(ctx.db, serverId);
  if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  const actor = assertServerPermission(ctx, serverId, Perm.MANAGE_ROLES);
  if (!positions.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Give me at least one role to move.');
  const seenIds = new Set<string>();
  const seenPositions = new Set<number>();
  const resolved: { role: RoleRow; position: number }[] = [];
  for (const entry of positions) {
    if (seenIds.has(entry.id)) throw new ApiError(400, 'VALIDATION_ERROR', `Duplicate role id: ${entry.id}`);
    seenIds.add(entry.id);
    assertPositionValue(entry.position);
    if (seenPositions.has(entry.position)) throw new ApiError(400, 'VALIDATION_ERROR', `Duplicate role position: ${entry.position}`);
    seenPositions.add(entry.position);
    const role = roleRow(ctx.db, entry.id);
    if (!role || role.server_id !== serverId) throw new ApiError(404, 'ROLE_NOT_FOUND', 'One of those roles is not from this server.');
    if (role.is_default) throw new ApiError(400, 'DEFAULT_ROLE_POSITION', '@everyone always sits at the bottom. That is its whole personality.');
    assertCanManageRole(actor, role);
    assertPositionBelow(actor, entry.position);
    resolved.push({ role, position: entry.position });
  }
  ctx.db.transaction(() => {
    for (const entry of resolved) ctx.db.run('UPDATE roles SET position = ? WHERE id = ?', entry.position, entry.role.id);
  });
  const dtos = roleDtos(ctx.db, serverId);
  for (const entry of resolved) {
    const dto = dtos.find((r) => r.id === entry.role.id);
    if (dto) ctx.hub.broadcastServer(serverId, 'ROLE_UPDATE', { serverId, role: dto });
  }
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'ROLE_POSITIONS_UPDATE', targetType: 'role', targetId: null,
    changes: { positions: resolved.map((r) => ({ id: r.role.id, position: r.position })) },
  });
  ctx.hub.invalidateServer(serverId);
  return dtos;
}

export interface MemberRoleChange {
  before: string[];
  after: string[];
}

/**
 * Replaces a member's roles after validating the actor can grant each one.
 * Owner protection and target hierarchy are enforced by the caller.
 */
export function validateMemberRoles(ctx: Ctx, server: Pick<ServerRow, 'id' | 'owner_id'>, actor: ActorContext, targetUserId: string, roleIds: string[]): RoleRow[] {
  if (!getMember(ctx.db, server.id, targetUserId)) {
    throw new ApiError(404, 'MEMBER_NOT_FOUND', 'That member is not in this server. Check your glasses.');
  }
  if (targetUserId === ctx.user!.id && !actor.isOwner) {
    throw new ApiError(403, 'CANNOT_MODIFY_SELF_ROLES', 'You cannot edit your own roles. That is how coups start.');
  }
  const resolved: RoleRow[] = [];
  for (const roleId of [...new Set(roleIds)]) {
    const role = roleRow(ctx.db, roleId);
    if (!role || role.server_id !== server.id) throw new ApiError(400, 'INVALID_ROLE', 'One of those roles does not belong to this server.');
    if (role.is_default) throw new ApiError(400, 'INVALID_ROLE', '@everyone is automatic. You do not assign it.');
    assertCanManageRole(actor, role);
    assertCanGrantPermissions(actor, role.permissions);
    resolved.push(role);
  }
  return resolved;
}

export function setMemberRoles(ctx: Ctx, server: Pick<ServerRow, 'id' | 'owner_id'>, actor: ActorContext, targetUserId: string, roleIds: string[]): MemberRoleChange {
  const resolved = validateMemberRoles(ctx, server, actor, targetUserId, roleIds);
  const before = memberRoleIds(ctx.db, server.id, targetUserId);
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', server.id, targetUserId);
    for (const role of resolved) {
      ctx.db.run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', server.id, targetUserId, role.id);
    }
  });
  return { before, after: resolved.map((r) => r.id) };
}
