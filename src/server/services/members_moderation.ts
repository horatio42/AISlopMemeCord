import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import { ApiError, type Ctx } from '../http';
import { Perm, has } from '../../shared/permissions';
import { computeBasePermissions, type RoleRow } from './permissions';
import type { ServerRow } from '../repos/servers';
import { getMember, toBanDto, type BanDto, type BanRow, type WarningDto } from '../repos/members_repo';
import { toMember } from '../repos/servers';
import { toUser } from '../repos/users';
import { createMessage } from './messages';
import { logAudit } from './audit';
import { notify } from './notifications';
import { newId } from '../util/ids';
import type { Message, ServerMember, UserStatus } from '../../shared/types';

export const MAX_TIMEOUT_MS = 28 * 86400_000;
export const MAX_BAN_DELETE_SECONDS = 7 * 86400;

/** The caller's resolved permission context for one server. */
export interface ActorContext {
  permissions: number;
  isOwner: boolean;
  topPosition: number;
  roles: RoleRow[];
}

function memberActionLabel(action: string): string {
  switch (action) {
    case 'kick': return 'kick';
    case 'ban': return 'ban';
    case 'timeout': return 'time out';
    case 'warn': return 'warn';
    case 'rename': return 'rename';
    case 'edit roles for': return 'edit the roles of';
    default: return action;
  }
}

/**
 * Discord-style hierarchy gate. Owners are above everyone; otherwise the actor's highest
 * role must be strictly above the target's, and the server owner is untouchable.
 */
export function assertCanActOnMember(
  ctx: Ctx,
  server: Pick<ServerRow, 'id' | 'owner_id'>,
  actor: ActorContext,
  targetUserId: string,
  action: string,
  opts: { allowSelf?: boolean } = {},
): void {
  if (!opts.allowSelf && targetUserId === ctx.user!.id) {
    throw new ApiError(403, 'CANNOT_ACT_ON_SELF', `You cannot ${memberActionLabel(action)} yourself. Therapy is cheaper.`);
  }
  if (targetUserId === server.owner_id && ctx.user!.id !== server.owner_id) {
    throw new ApiError(403, 'CANNOT_ACT_ON_OWNER', 'The server owner is load-bearing. You cannot touch them.');
  }
  const target = computeBasePermissions(ctx.db, server.id, targetUserId);
  if (!actor.isOwner && target.topPosition >= actor.topPosition) {
    throw new ApiError(403, 'ROLE_HIERARCHY', `You cannot ${memberActionLabel(action)} a member whose highest role is not below yours. The hierarchy is sacred slop.`);
  }
}

/** Removes membership rows (roles included) and keeps the cached member count honest. */
export function removeMembership(db: DatabaseWrapper, serverId: string, userId: string): boolean {
  if (!getMember(db, serverId, userId)) return false;
  db.transaction(() => {
    db.run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', serverId, userId);
    db.run('DELETE FROM members WHERE server_id = ? AND user_id = ?', serverId, userId);
  });
  db.run('UPDATE servers SET member_count = MAX(0, member_count - 1) WHERE id = ?', serverId);
  return true;
}

export function broadcastMemberRemove(hub: Hub, serverId: string, userId: string, reason: string | null): void {
  hub.invalidateServer(serverId);
  hub.broadcastServer(serverId, 'MEMBER_REMOVE', { serverId, userId, reason });
}

export function broadcastMemberUpdate(ctx: Ctx, serverId: string, userId: string): ServerMember | null {
  const row = getMember(ctx.db, serverId, userId);
  if (!row) return null;
  const member = toMember(ctx.db, row);
  member.user.status = ctx.hub.visibleStatus(userId) as UserStatus;
  ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'MEMBER_UPDATE', { serverId, member });
  return member;
}

/** Soft-deletes every message the user sent in the last `seconds` and tells open channels. */
export function purgeRecentMessages(ctx: Ctx, serverId: string, userId: string, seconds: number, actorId: string): string[] {
  if (seconds <= 0) return [];
  const cutoff = Date.now() - seconds * 1000;
  const rows = ctx.db.all<{ id: string; channel_id: string }>(
    'SELECT id, channel_id FROM messages WHERE server_id = ? AND author_id = ? AND created_at >= ? AND deleted_at IS NULL',
    serverId, userId, cutoff,
  );
  if (!rows.length) return [];
  const now = Date.now();
  ctx.db.transaction(() => {
    for (const row of rows) ctx.db.run('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', now, actorId, row.id);
  });
  const byChannel = new Map<string, string[]>();
  for (const row of rows) byChannel.set(row.channel_id, [...(byChannel.get(row.channel_id) ?? []), row.id]);
  for (const [channelId, ids] of byChannel) {
    ctx.hub.invalidateChannel(channelId);
    ctx.hub.broadcastChannel(channelId, 'MESSAGE_BULK_DELETE', { channelId, messageIds: ids, deletedBy: actorId });
  }
  return rows.map((r) => r.id);
}

/** Posts a system-styled message to the server's configured system channel, if any. */
export function postSystemMessage(ctx: Ctx, server: Pick<ServerRow, 'id' | 'system_channel_id'>, content: string): Message | null {
  const channelId = server.system_channel_id;
  if (!channelId) return null;
  const channel = ctx.db.get<{ id: string; server_id: string | null }>('SELECT id, server_id FROM channels WHERE id = ?', channelId);
  if (!channel || channel.server_id !== server.id) return null;
  return createMessage(ctx.db, ctx.hub, {
    channelId, authorId: ctx.user!.id,
    content: content.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 2000),
    type: 'system', skipChecks: true,
  }, ctx.config);
}

export interface BanOptions {
  reason?: string | null;
  deleteMessageSeconds?: number;
}

export interface BanOutcome {
  ban: BanDto;
  removedMember: boolean;
  deletedMessageIds: string[];
}

export function banUser(ctx: Ctx, server: ServerRow, actor: ActorContext, targetUserId: string, opts: BanOptions = {}): BanOutcome {
  const user = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', targetUserId);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'That user evaporated. Slop is temporary.');
  assertCanActOnMember(ctx, server, actor, targetUserId, 'ban');
  const reason = opts.reason?.slice(0, 500) ?? null;
  const now = Date.now();
  ctx.db.run(
    `INSERT INTO bans (server_id, user_id, banned_by, reason, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id, user_id) DO UPDATE SET banned_by = excluded.banned_by, reason = excluded.reason, created_at = excluded.created_at`,
    server.id, targetUserId, ctx.user!.id, reason, now,
  );
  const removedMember = removeMembership(ctx.db, server.id, targetUserId);
  const deletedMessageIds = purgeRecentMessages(ctx, server.id, targetUserId, opts.deleteMessageSeconds ?? 0, ctx.user!.id);
  if (removedMember) broadcastMemberRemove(ctx.hub, server.id, targetUserId, reason);
  logAudit(ctx.db, {
    serverId: server.id, actorId: ctx.user!.id, action: 'MEMBER_BAN', targetType: 'user', targetId: targetUserId,
    reason, changes: { deleteMessageSeconds: opts.deleteMessageSeconds ?? 0, deletedMessages: deletedMessageIds.length },
  });
  notify(ctx.db, ctx.hub, {
    userId: targetUserId, type: 'system', serverId: server.id, actorId: ctx.user!.id,
    title: `Banned from ${server.name}`,
    body: reason ? `Reason: ${reason}` : 'You have been banned. No reason given, which is somehow worse.',
  });
  const banRow = ctx.db.get<BanRow>('SELECT * FROM bans WHERE server_id = ? AND user_id = ?', server.id, targetUserId)!;
  return { ban: toBanDto(ctx.db, banRow), removedMember, deletedMessageIds };
}

export function unbanUser(ctx: Ctx, server: ServerRow, targetUserId: string): void {
  const existing = ctx.db.get<BanRow>('SELECT * FROM bans WHERE server_id = ? AND user_id = ?', server.id, targetUserId);
  if (!existing) throw new ApiError(404, 'BAN_NOT_FOUND', 'Nobody was banned. Your rage was misplaced.');
  ctx.db.run('DELETE FROM bans WHERE server_id = ? AND user_id = ?', server.id, targetUserId);
  logAudit(ctx.db, {
    serverId: server.id, actorId: ctx.user!.id, action: 'MEMBER_UNBAN', targetType: 'user', targetId: targetUserId,
    changes: { reason: existing.reason },
  });
}

export interface TimeoutChange {
  from: number | null;
  to: number | null;
}

export function validateMemberTimeout(ctx: Ctx, server: ServerRow, actor: ActorContext, targetUserId: string, timeoutUntil: number | null): void {
  if (timeoutUntil !== null && timeoutUntil > Date.now() + MAX_TIMEOUT_MS) {
    throw new ApiError(400, 'TIMEOUT_TOO_LONG', 'Time-outs max out at 28 days. Even the slop pit has limits.');
  }
  if (!getMember(ctx.db, server.id, targetUserId)) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'That member is not in this server. Check your glasses.');
  assertCanActOnMember(ctx, server, actor, targetUserId, 'timeout');
}

/** Validates and writes a timeout without broadcasting or auditing (used by batch member edits). */
export function updateMemberTimeout(ctx: Ctx, server: ServerRow, actor: ActorContext, targetUserId: string, timeoutUntil: number | null): TimeoutChange {
  validateMemberTimeout(ctx, server, actor, targetUserId, timeoutUntil);
  const member = getMember(ctx.db, server.id, targetUserId)!;
  ctx.db.run('UPDATE members SET timeout_until = ? WHERE server_id = ? AND user_id = ?', timeoutUntil, server.id, targetUserId);
  return { from: member.timeout_until, to: timeoutUntil };
}

export function announceTimeout(ctx: Ctx, server: Pick<ServerRow, 'id' | 'name'>, targetUserId: string, timeoutUntil: number): void {
  const minutes = Math.max(1, Math.ceil((timeoutUntil - Date.now()) / 60_000));
  notify(ctx.db, ctx.hub, {
    userId: targetUserId, type: 'system', serverId: server.id, actorId: ctx.user!.id,
    title: `Timed out in ${server.name}`,
    body: `You cannot post for ${minutes} minute${minutes === 1 ? '' : 's'}. Use the time to reflect on your crimes.`,
  });
}

export function setMemberTimeout(ctx: Ctx, server: ServerRow, actor: ActorContext, targetUserId: string, timeoutUntil: number | null): ServerMember {
  const change = updateMemberTimeout(ctx, server, actor, targetUserId, timeoutUntil);
  const updated = broadcastMemberUpdate(ctx, server.id, targetUserId);
  logAudit(ctx.db, {
    serverId: server.id, actorId: ctx.user!.id, action: 'MEMBER_TIMEOUT', targetType: 'member', targetId: targetUserId,
    changes: { from: change.from, to: change.to },
  });
  if (timeoutUntil !== null) announceTimeout(ctx, server, targetUserId, timeoutUntil);
  return updated!;
}

export function createWarning(ctx: Ctx, server: ServerRow, actor: ActorContext, targetUserId: string, reason: string): WarningDto & { user: NonNullable<WarningDto['user']>; moderator: NonNullable<WarningDto['moderator']> } {
  const member = getMember(ctx.db, server.id, targetUserId);
  const userRow = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', targetUserId);
  if (!member || !userRow) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'That member is not in this server. Check your glasses.');
  assertCanActOnMember(ctx, server, actor, targetUserId, 'warn');
  const id = newId('w');
  const now = Date.now();
  ctx.db.run('INSERT INTO warnings (id, server_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, server.id, targetUserId, ctx.user!.id, reason, now);
  logAudit(ctx.db, {
    serverId: server.id, actorId: ctx.user!.id, action: 'MEMBER_WARN', targetType: 'user', targetId: targetUserId,
    reason, changes: { warningId: id },
  });
  notify(ctx.db, ctx.hub, {
    userId: targetUserId, type: 'system', serverId: server.id, actorId: ctx.user!.id,
    title: `Warning in ${server.name}`,
    body: reason,
  });
  const moderatorRow = ctx.db.get('SELECT * FROM users WHERE id = ?', ctx.user!.id) as never;
  const targetRow = ctx.db.get('SELECT * FROM users WHERE id = ?', targetUserId) as never;
  return { id, user: toUser(targetRow), moderator: toUser(moderatorRow), reason, createdAt: now };
}

export function deleteWarning(ctx: Ctx, serverId: string, warningId: string, targetUserId: string): void {
  ctx.db.run('DELETE FROM warnings WHERE id = ? AND server_id = ?', warningId, serverId);
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'MEMBER_WARNING_DELETE', targetType: 'warning', targetId: warningId,
    changes: { userId: targetUserId },
  });
}

/** Shared guard: permission bits must be a subset of the actor's unless owner/admin. */
export function assertCanGrantPermissions(actor: ActorContext, permissions: number): void {
  if (actor.isOwner || has(actor.permissions, Perm.ADMINISTRATOR)) return;
  const extra = permissions & ~actor.permissions;
  if (extra) {
    throw new ApiError(403, 'PRIVILEGE_ESCALATION', 'You cannot grant permissions you do not hold. The power fantasy stops here.');
  }
}
