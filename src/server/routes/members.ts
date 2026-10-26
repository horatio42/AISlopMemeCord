import { ApiError, json, readJson, type Ctx, type Router, type UserRow } from '../http';
import { Perm } from '../../shared/permissions';
import { ValidationError, bool, color as vColor, idList, int, optText } from '../util/validate';
import { assertServerMember, assertServerPermission } from '../services/permissions';
import { getServerRow } from '../repos/servers';
import { getWarning, listAuditEntries, listBans, listWarnings, listMembers } from '../repos/members_repo';
import {
  assertCanActOnMember, banUser, broadcastMemberRemove, createWarning, deleteWarning,
  MAX_BAN_DELETE_SECONDS, MAX_TIMEOUT_MS, postSystemMessage, removeMembership, unbanUser,
} from '../services/members_moderation';
import { createRole, deleteRole, reorderRoles, updateRole, type RolePatchInput } from '../services/members_roles';
import { patchMember, type MemberPatchInput } from '../services/members_manage';
import { listServerReports, resolveReport, type ReportAction, type ReportStatus } from '../services/members_reports';
import { logAudit } from '../services/audit';
import { notify } from '../services/notifications';
import { toUser } from '../repos/users';
import type { ActorContext } from '../services/members_moderation';
import type { UserStatus } from '../../shared/types';

function requireServer(ctx: Ctx, serverId: string) {
  const server = getServerRow(ctx.db, serverId);
  if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  return server;
}

async function readOptionalJson(ctx: Ctx): Promise<Record<string, unknown>> {
  const type = ctx.req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return {};
  return readJson(ctx.req);
}

function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function nicknameText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ValidationError({ nickname: 'Nickname must be a string or null.' });
  const s = value.trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 32) throw new ValidationError({ nickname: 'Nickname must be 1-32 characters.' });
  if (/[<>\u0000-\u001f\u007f]/.test(s)) throw new ValidationError({ nickname: 'Nickname contains characters that belong in a dumpster fire.' });
  return s;
}

function roleNameText(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError({ name: 'Role name must be a string.' });
  const s = value.trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 32) throw new ValidationError({ name: 'Role name must be 1-32 characters.' });
  if (/[<>\u0000-\u001f\u007f]/.test(s)) throw new ValidationError({ name: 'Role name contains characters that belong in a dumpster fire.' });
  return s;
}

function iconValue(value: unknown): string | null {
  const icon = optText(value, 'icon', 64);
  if (icon && /[<>\u0000-\u001f\u007f]/.test(icon)) throw new ValidationError({ icon: 'Icon must not contain angle brackets or control characters.' });
  return icon;
}

function permMask(value: unknown): number {
  return int(value, 'permissions', 0, 0x7fffffff);
}

function statusFilter(value: string | null): ReportStatus | null {
  if (!value || value === 'all') return null;
  if (value === 'open' || value === 'resolved' || value === 'dismissed') return value;
  throw new ValidationError({ status: 'Status must be open, resolved, dismissed or all.' });
}

export function register(router: Router) {
  // ---- Members ----
  router.get('/api/servers/:id/members', (ctx) => {
    const serverId = ctx.params.id!;
    requireServer(ctx, serverId);
    assertServerMember(ctx, serverId);
    const limit = int(ctx.url.searchParams.get('limit') ?? 100, 'limit', 1, 1000);
    const query = optText(ctx.url.searchParams.get('query'), 'query', 64);
    const after = optText(ctx.url.searchParams.get('after'), 'after', 64);
    const grouped = bool(ctx.url.searchParams.get('group') ?? ctx.url.searchParams.get('grouped'));
    const result = listMembers(ctx.db, serverId, { query, limit, after });
    for (const member of result.members) member.user.status = ctx.hub.visibleStatus(member.user.id) as UserStatus;
    return json(grouped ? result : { members: result.members, total: result.total });
  });

  router.patch('/api/servers/:id/members/:userId', async (ctx) => {
    const serverId = ctx.params.id!;
    const targetUserId = ctx.params.userId!;
    const body = await readJson(ctx.req);
    const input: MemberPatchInput = {};
    if (hasKey(body, 'nickname')) input.nickname = nicknameText(body.nickname);
    if (hasKey(body, 'roles')) input.roles = idList(body.roles, 100);
    if (hasKey(body, 'timeoutUntil')) {
      input.timeoutUntil = body.timeoutUntil === null ? null : int(body.timeoutUntil, 'timeoutUntil', 0, Number.MAX_SAFE_INTEGER);
    }
    if (!hasKey(body, 'nickname') && !hasKey(body, 'roles') && !hasKey(body, 'timeoutUntil')) {
      throw new ValidationError({ _: 'Send nickname, roles or timeoutUntil. An empty edit is just vibes.' });
    }
    const member = patchMember(ctx, serverId, targetUserId, input);
    return json({ member });
  });

  router.delete('/api/servers/:id/members/:userId', async (ctx) => {
    const serverId = ctx.params.id!;
    const targetUserId = ctx.params.userId!;
    const server = requireServer(ctx, serverId);
    const body = await readOptionalJson(ctx);
    const reason = optText(body.reason, 'reason', 500);
    const actor: ActorContext = assertServerPermission(ctx, serverId, Perm.KICK_MEMBERS);
    assertCanActOnMember(ctx, server, actor, targetUserId, 'kick');
    if (!removeMembership(ctx.db, serverId, targetUserId)) {
      throw new ApiError(404, 'MEMBER_NOT_FOUND', 'That member already left, or never existed. Schrodinger slop.');
    }
    broadcastMemberRemove(ctx.hub, serverId, targetUserId, reason);
    const targetRow = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', targetUserId);
    const actorRow = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', ctx.user!.id)!;
    const targetUser = targetRow ? toUser(targetRow) : null;
    logAudit(ctx.db, {
      serverId, actorId: ctx.user!.id, action: 'MEMBER_KICK', targetType: 'member', targetId: targetUserId, reason,
      changes: { nickname: targetUser?.displayName ?? null },
    });
    postSystemMessage(ctx, server, `**${targetUser?.displayName ?? 'A mystery goblin'}** was kicked by **${toUser(actorRow).displayName}**.${reason ? ` Reason: ${reason}` : ' No reason given.'}`);
    notify(ctx.db, ctx.hub, {
      userId: targetUserId, type: 'system', serverId, actorId: ctx.user!.id,
      title: `Kicked from ${server.name}`,
      body: reason ? `Reason: ${reason}` : 'You were kicked. The door hit you on the way out.',
    });
    return json({ kicked: true, userId: targetUserId });
  });

  // ---- Bans ----
  router.get('/api/servers/:id/bans', (ctx) => {
    const serverId = ctx.params.id!;
    requireServer(ctx, serverId);
    assertServerPermission(ctx, serverId, Perm.BAN_MEMBERS);
    return json({ bans: listBans(ctx.db, serverId) });
  });

  router.post('/api/servers/:id/bans/:userId', async (ctx) => {
    const serverId = ctx.params.id!;
    const targetUserId = ctx.params.userId!;
    const server = requireServer(ctx, serverId);
    const body = await readOptionalJson(ctx);
    const actor: ActorContext = assertServerPermission(ctx, serverId, Perm.BAN_MEMBERS);
    const reason = optText(body.reason, 'reason', 500);
    const deleteMessageSeconds = int(body.deleteMessageSeconds ?? 0, 'deleteMessageSeconds', 0, MAX_BAN_DELETE_SECONDS);
    const outcome = banUser(ctx, server, actor, targetUserId, { reason, deleteMessageSeconds });
    return json({ ban: outcome.ban, removed: outcome.removedMember, deletedMessages: outcome.deletedMessageIds.length });
  });

  router.delete('/api/servers/:id/bans/:userId', (ctx) => {
    const serverId = ctx.params.id!;
    const targetUserId = ctx.params.userId!;
    const server = requireServer(ctx, serverId);
    assertServerPermission(ctx, serverId, Perm.BAN_MEMBERS);
    unbanUser(ctx, server, targetUserId);
    return json({ unbanned: true, userId: targetUserId });
  });

  // ---- Warnings ----
  router.get('/api/servers/:id/warnings', (ctx) => {
    const serverId = ctx.params.id!;
    requireServer(ctx, serverId);
    assertServerPermission(ctx, serverId, Perm.MODERATE_MEMBERS);
    const userId = optText(ctx.url.searchParams.get('userId'), 'userId', 64);
    return json({ warnings: listWarnings(ctx.db, serverId, userId) });
  });

  router.post('/api/servers/:id/warnings', async (ctx) => {
    const serverId = ctx.params.id!;
    const server = requireServer(ctx, serverId);
    const body = await readJson(ctx.req);
    const rawUserId = body.userId;
    if (typeof rawUserId !== 'string' || !rawUserId.trim() || rawUserId.length > 64) {
      throw new ValidationError({ userId: 'Pick a victim... er, member.' });
    }
    const userId = rawUserId.trim();
    const reason = optText(body.reason, 'reason', 500);
    if (!reason) throw new ValidationError({ reason: 'A warning needs a reason. Otherwise it is just bullying.' });
    const actor: ActorContext = assertServerPermission(ctx, serverId, Perm.MODERATE_MEMBERS);
    const warning = createWarning(ctx, server, actor, userId, reason);
    return json({ warning });
  });

  router.delete('/api/servers/:id/warnings/:warningId', (ctx) => {
    const serverId = ctx.params.id!;
    const server = requireServer(ctx, serverId);
    const actor: ActorContext = assertServerPermission(ctx, serverId, Perm.MODERATE_MEMBERS);
    const warning = getWarning(ctx.db, serverId, ctx.params.warningId!);
    if (!warning) throw new ApiError(404, 'WARNING_NOT_FOUND', 'That warning was already forgotten. Blessed ignorance.');
    assertCanActOnMember(ctx, server, actor, warning.user_id, 'warn');
    deleteWarning(ctx, serverId, warning.id, warning.user_id);
    return json({ deleted: true, id: warning.id });
  });

  // ---- Audit log ----
  router.get('/api/servers/:id/audit-log', (ctx) => {
    const serverId = ctx.params.id!;
    requireServer(ctx, serverId);
    assertServerPermission(ctx, serverId, Perm.VIEW_AUDIT_LOG);
    const action = optText(ctx.url.searchParams.get('action'), 'action', 64);
    const before = optText(ctx.url.searchParams.get('before'), 'before', 64);
    const limit = int(ctx.url.searchParams.get('limit') ?? 50, 'limit', 1, 200);
    const entries = listAuditEntries(ctx.db, serverId, { action, before, limit });
    return json({ entries });
  });

  // ---- Roles ----
  router.post('/api/servers/:id/roles', async (ctx) => {
    const serverId = ctx.params.id!;
    const body = await readJson(ctx.req);
    const role = createRole(ctx, serverId, {
      name: roleNameText(body.name),
      color: hasKey(body, 'color') ? vColor(body.color) : undefined,
      permissions: hasKey(body, 'permissions') ? permMask(body.permissions) : undefined,
      hoist: hasKey(body, 'hoist') ? bool(body.hoist) : undefined,
      mentionable: hasKey(body, 'mentionable') ? bool(body.mentionable) : undefined,
      icon: hasKey(body, 'icon') ? iconValue(body.icon) : undefined,
    });
    return json({ role });
  });

  router.patch('/api/roles/:id', async (ctx) => {
    const roleId = ctx.params.id!;
    const body = await readJson(ctx.req);
    const input: RolePatchInput = {};
    if (hasKey(body, 'name')) input.name = roleNameText(body.name);
    if (hasKey(body, 'color')) input.color = vColor(body.color);
    if (hasKey(body, 'permissions')) input.permissions = permMask(body.permissions);
    if (hasKey(body, 'hoist')) input.hoist = bool(body.hoist);
    if (hasKey(body, 'mentionable')) input.mentionable = bool(body.mentionable);
    if (hasKey(body, 'icon')) input.icon = iconValue(body.icon);
    if (hasKey(body, 'position')) input.position = int(body.position, 'position', 0, 1_000_000);
    if (!Object.keys(input).length) throw new ValidationError({ _: 'Nothing to update. Send at least one role field.' });
    return json({ role: updateRole(ctx, roleId, input) });
  });

  router.delete('/api/roles/:id', (ctx) => {
    deleteRole(ctx, ctx.params.id!);
    return json({ deleted: true, id: ctx.params.id });
  });

  router.patch('/api/servers/:id/roles/positions', async (ctx) => {
    const serverId = ctx.params.id!;
    const body = await readJson(ctx.req);
    if (!Array.isArray(body.positions)) throw new ValidationError({ positions: 'Expected an array of {id, position}.' });
    if (!body.positions.length || body.positions.length > 250) throw new ValidationError({ positions: 'Send between 1 and 250 positions.' });
    const positions = body.positions.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ValidationError({ positions: `Entry ${index} is not an object.` });
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      if (!id) throw new ValidationError({ positions: `Entry ${index} is missing a role id.` });
      return { id, position: int(record.position, 'position', 0, 1_000_000) };
    });
    return json({ roles: reorderRoles(ctx, serverId, positions) });
  });

  // ---- Reports ----
  router.get('/api/servers/:id/reports', (ctx) => {
    const serverId = ctx.params.id!;
    requireServer(ctx, serverId);
    assertServerPermission(ctx, serverId, Perm.MANAGE_MESSAGES);
    const status = statusFilter(ctx.url.searchParams.get('status'));
    return json({ reports: listServerReports(ctx, serverId, status) });
  });

  router.patch('/api/reports/:id', async (ctx) => {
    const reportId = ctx.params.id!;
    const body = await readJson(ctx.req);
    const status = body.status;
    if (status !== 'resolved' && status !== 'dismissed') {
      throw new ValidationError({ status: "Status must be 'resolved' or 'dismissed'." });
    }
    const resolution = optText(body.resolution, 'resolution', 1000);
    const action: ReportAction = body.action === undefined ? 'none' : body.action as ReportAction;
    if (!['delete_message', 'timeout', 'ban', 'none'].includes(action)) {
      throw new ValidationError({ action: 'Action must be delete_message, timeout, ban or none.' });
    }
    const durationMs = body.durationMs === undefined || body.durationMs === null
      ? null
      : int(body.durationMs, 'durationMs', 1000, MAX_TIMEOUT_MS);
    if (action === 'timeout' && !durationMs) throw new ValidationError({ durationMs: 'Timeouts need a duration.' });
    const report = resolveReport(ctx, reportId, { status, resolution, action, durationMs });
    return json({ report });
  });
}
