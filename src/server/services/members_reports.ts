import { ApiError, type Ctx } from '../http';
import { Perm } from '../../shared/permissions';
import { assertServerPermission, canViewChannel, type ChannelRow } from './permissions';
import { getServerRow } from '../repos/servers';
import { getMessageRow } from '../repos/messages';
import { getReport, listReportRows, toReport, type ReportRow } from '../repos/members_repo';
import { logAudit } from './audit';
import { notify } from './notifications';
import { assertCanActOnMember, banUser, setMemberTimeout, MAX_TIMEOUT_MS, type ActorContext } from './members_moderation';
import type { Report } from '../../shared/types';

export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type ReportAction = 'delete_message' | 'timeout' | 'ban' | 'none';

export interface ResolveReportInput {
  status: 'resolved' | 'dismissed';
  resolution: string | null;
  action: ReportAction;
  durationMs: number | null;
}

function messageVisible(ctx: Ctx, serverId: string | null, messageRow: { channel_id: string }): boolean {
  const channel = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', messageRow.channel_id);
  if (!channel || !channel.server_id) return false;
  if (serverId && channel.server_id !== serverId) return false;
  return canViewChannel(ctx.db, ctx.user!.id, channel);
}

export function reportDto(ctx: Ctx, row: ReportRow): Report {
  return toReport(ctx.db, row, {
    viewerId: ctx.user!.id,
    canSeeMessage: (message) => messageVisible(ctx, row.server_id, message),
  });
}

export function listServerReports(ctx: Ctx, serverId: string, status: ReportStatus | null): Report[] {
  return listReportRows(ctx.db, serverId, status).map((row) => reportDto(ctx, row));
}

/**
 * Resolves a report and optionally performs a moderation action.
 * Access requires MANAGE_MESSAGES in the report's server (instance admin for global reports);
 * timeout/ban actions additionally respect member hierarchy and owner/self protection.
 */
export function resolveReport(ctx: Ctx, reportId: string, input: ResolveReportInput): Report {
  const row = getReport(ctx.db, reportId);
  if (!row) throw new ApiError(404, 'REPORT_NOT_FOUND', 'That report was already fed to the slop void.');
  const server = row.server_id ? getServerRow(ctx.db, row.server_id) : null;
  if (row.server_id && !server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'Server not found. Maybe it never existed.');
  let actor: ActorContext | null = null;
  if (server) {
    actor = assertServerPermission(ctx, server.id, Perm.MANAGE_MESSAGES);
  } else if (!ctx.user!.is_admin) {
    throw new ApiError(403, 'MISSING_PERMISSIONS', 'Global reports are for instance admins only.');
  }

  const messageRow = row.message_id ? getMessageRow(ctx.db, row.message_id) : null;
  const targetUserId = row.target_user_id ?? messageRow?.author_id ?? null;
  const performed: string[] = [];

  if (input.action === 'delete_message') {
    if (!messageRow) throw new ApiError(400, 'NO_REPORTED_MESSAGE', 'This report has no message to delete. Someone reported the void.');
    if (!messageRow.deleted_at) {
      ctx.db.run('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', Date.now(), ctx.user!.id, messageRow.id);
      ctx.hub.invalidateChannel(messageRow.channel_id);
      ctx.hub.broadcastChannel(messageRow.channel_id, 'MESSAGE_DELETE', { messageId: messageRow.id, channelId: messageRow.channel_id, deletedBy: ctx.user!.id });
      logAudit(ctx.db, {
        serverId: row.server_id, actorId: ctx.user!.id, action: 'MESSAGE_DELETE', targetType: 'message', targetId: messageRow.id,
        reason: input.resolution, changes: { reportId: row.id, channelId: messageRow.channel_id },
      });
      performed.push('delete_message');
    }
  } else if (input.action === 'timeout') {
    if (!server || !actor) throw new ApiError(400, 'SERVER_ONLY_ACTION', 'You cannot time out the void.');
    if (!targetUserId) throw new ApiError(400, 'NO_TARGET', 'This report has no target to time out.');
    if (!input.durationMs || input.durationMs < 1000 || input.durationMs > MAX_TIMEOUT_MS) {
      throw new ApiError(400, 'INVALID_DURATION', 'Timeout duration must be between 1 second and 28 days.');
    }
    setMemberTimeout(ctx, server, actor, targetUserId, Date.now() + input.durationMs);
    performed.push('timeout');
  } else if (input.action === 'ban') {
    if (!server || !actor) throw new ApiError(400, 'SERVER_ONLY_ACTION', 'You cannot ban the void.');
    if (!targetUserId) throw new ApiError(400, 'NO_TARGET', 'This report has no target to ban.');
    banUser(ctx, server, actor, targetUserId, { reason: input.resolution ?? row.reason });
    performed.push('ban');
  }

  const now = Date.now();
  ctx.db.run(
    'UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?',
    input.status, input.resolution, ctx.user!.id, now, row.id,
  );
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'REPORT_RESOLVE', targetType: 'report', targetId: row.id,
    reason: input.resolution, changes: { status: input.status, action: input.action, performed, targetUserId },
  });
  notify(ctx.db, ctx.hub, {
    userId: row.reporter_id, type: 'report', serverId: row.server_id, actorId: ctx.user!.id,
    title: input.status === 'resolved' ? 'Your report was resolved' : 'Your report was dismissed',
    body: input.resolution ?? (input.status === 'resolved' ? 'A moderator has handled it. Slop justice is served.' : 'A moderator looked at it and shrugged.'),
  });
  const updated = getReport(ctx.db, row.id)!;
  return reportDto(ctx, updated);
}
