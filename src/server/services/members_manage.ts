import { ApiError, type Ctx } from '../http';
import { Perm } from '../../shared/permissions';
import { assertServerMember, assertServerPermission } from './permissions';
import { getServerRow } from '../repos/servers';
import { getMember } from '../repos/members_repo';
import { toMember } from '../repos/servers';
import { assertCanActOnMember, announceTimeout, broadcastMemberUpdate, updateMemberTimeout, validateMemberTimeout, type ActorContext } from './members_moderation';
import { setMemberRoles, validateMemberRoles } from './members_roles';
import { logAudit } from './audit';
import type { ServerMember, UserStatus } from '../../shared/types';

export interface MemberPatchInput {
  nickname?: string | null;
  roles?: string[];
  timeoutUntil?: number | null;
}

/**
 * Applies a partial member edit. Every field has its own permission gate; the caller must
 * already be a member. Global changes are validated before any write so failures are atomic
 * from the client's perspective.
 */
export function patchMember(ctx: Ctx, serverId: string, targetUserId: string, input: MemberPatchInput): ServerMember {
  const server = getServerRow(ctx.db, serverId);
  if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  const actor: ActorContext = assertServerMember(ctx, serverId);
  const member = getMember(ctx.db, serverId, targetUserId);
  if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'That member is not in this server. Check your glasses.');

  const hasNickname = Object.prototype.hasOwnProperty.call(input, 'nickname');
  const hasRoles = Object.prototype.hasOwnProperty.call(input, 'roles');
  const hasTimeout = Object.prototype.hasOwnProperty.call(input, 'timeoutUntil');

  if (hasNickname) {
    if (targetUserId === ctx.user!.id) {
      assertServerPermission(ctx, serverId, Perm.CHANGE_NICKNAME);
    } else {
      assertServerPermission(ctx, serverId, Perm.MANAGE_NICKNAMES);
      assertCanActOnMember(ctx, server, actor, targetUserId, 'rename');
    }
  }
  if (hasRoles) {
    assertServerPermission(ctx, serverId, Perm.MANAGE_ROLES);
    if (targetUserId === ctx.user!.id && !actor.isOwner) {
      throw new ApiError(403, 'CANNOT_MODIFY_SELF_ROLES', 'You cannot edit your own roles. That is how coups start.');
    }
    assertCanActOnMember(ctx, server, actor, targetUserId, 'edit roles for', { allowSelf: true });
    validateMemberRoles(ctx, server, actor, targetUserId, input.roles!);
  }
  if (hasTimeout) {
    assertServerPermission(ctx, serverId, Perm.MODERATE_MEMBERS);
    validateMemberTimeout(ctx, server, actor, targetUserId, input.timeoutUntil!);
  }

  const changes: Record<string, unknown> = {};
  if (hasNickname && input.nickname !== member.nickname) {
    ctx.db.run('UPDATE members SET nickname = ? WHERE server_id = ? AND user_id = ?', input.nickname, serverId, targetUserId);
    changes.nickname = { from: member.nickname, to: input.nickname };
  }
  if (hasRoles) {
    const roleChange = setMemberRoles(ctx, server, actor, targetUserId, input.roles!);
    const same = roleChange.before.length === roleChange.after.length && roleChange.before.every((id) => roleChange.after.includes(id));
    if (!same) changes.roles = roleChange;
  }
  let timeoutChange: { from: number | null; to: number | null } | null = null;
  if (hasTimeout) {
    timeoutChange = updateMemberTimeout(ctx, server, actor, targetUserId, input.timeoutUntil!);
    if (timeoutChange.from !== timeoutChange.to) changes.timeoutUntil = timeoutChange;
  }

  if (!Object.keys(changes).length) {
    const unchanged = toMember(ctx.db, getMember(ctx.db, serverId, targetUserId)!);
    unchanged.user.status = ctx.hub.visibleStatus(targetUserId) as UserStatus;
    return unchanged;
  }
  const updated = broadcastMemberUpdate(ctx, serverId, targetUserId)!;
  if (timeoutChange?.to && timeoutChange.from !== timeoutChange.to) announceTimeout(ctx, server, targetUserId, timeoutChange.to);
  const fields = Object.keys(changes);
  const action = fields.length === 1
    ? fields[0] === 'timeoutUntil' ? 'MEMBER_TIMEOUT' : fields[0] === 'roles' ? 'MEMBER_ROLES_UPDATE' : 'MEMBER_UPDATE'
    : 'MEMBER_UPDATE';
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action, targetType: 'member', targetId: targetUserId,
    changes: { ...changes, fields },
  });
  return updated;
}
