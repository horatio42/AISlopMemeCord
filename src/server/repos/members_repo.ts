import type { DatabaseWrapper } from '../db';
import type { UserRow } from '../http';
import type { AuditEntry, MemberList, Report, ServerMember, User } from '../../shared/types';
import { toUser } from './users';
import { rolesForServer, type MemberRow } from './servers';
import type { RoleRow } from '../services/permissions';
import { getMessageRow, serializeMessages, type MessageRow } from './messages';

export interface MemberListQuery {
  query?: string | null;
  limit: number;
  after?: string | null;
}

export interface BanRow {
  server_id: string; user_id: string; banned_by: string; reason: string | null; created_at: number;
}
export interface BanDto {
  userId: string;
  user: User | null;
  moderator: User | null;
  reason: string | null;
  createdAt: number;
}
export interface WarningRow {
  id: string; server_id: string; user_id: string; moderator_id: string; reason: string; created_at: number;
}
export interface WarningDto {
  id: string;
  user: User | null;
  moderator: User | null;
  reason: string;
  createdAt: number;
}
export interface AuditRow {
  id: string; server_id: string | null; actor_id: string | null; action: string;
  target_type: string; target_id: string | null; reason: string | null; changes: string | null; created_at: number;
}
export interface ReportRow {
  id: string; server_id: string | null; reporter_id: string; target_user_id: string | null;
  message_id: string | null; reason: string; status: 'open' | 'resolved' | 'dismissed';
  resolution: string | null; resolved_by: string | null; created_at: number; resolved_at: number | null;
}

function ghostUser(id: string): User {
  return {
    id, username: 'ghost', displayName: 'Deleted User', avatar: null, bannerColor: null, bio: null,
    pronouns: null, status: 'offline', customStatus: null, isAdmin: false, isBot: false, badges: [],
    karma: 0, createdAt: 0, publicKey: null, theme: 'slop',
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function usersById(db: DatabaseWrapper, ids: string[]): Map<string, UserRow> {
  const out = new Map<string, UserRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const ph = chunk.map(() => '?').join(',');
    for (const row of db.all<UserRow>(`SELECT * FROM users WHERE id IN (${ph})`, ...chunk)) out.set(row.id, row);
  }
  return out;
}

/** Batched member list, no per-member role/user queries. */
export function listMembers(db: DatabaseWrapper, serverId: string, opts: MemberListQuery): { members: ServerMember[]; total: number; groups: MemberList['groups'] } {
  const where: string[] = ['m.server_id = ?'];
  const params: unknown[] = [serverId];
  const q = opts.query?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(m.nickname LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  const baseWhere = where.join(' AND ');
  const total = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM members m JOIN users u ON u.id = m.user_id WHERE ${baseWhere}`, ...params,
  )?.n ?? 0;

  const pageWhere = [...where];
  const pageParams = [...params];
  if (opts.after) {
    const anchor = db.get<MemberRow>('SELECT * FROM members WHERE server_id = ? AND user_id = ?', serverId, opts.after);
    if (anchor) {
      pageWhere.push('(m.joined_at > ? OR (m.joined_at = ? AND m.user_id > ?))');
      pageParams.push(anchor.joined_at, anchor.joined_at, anchor.user_id);
    }
  }
  const rows = db.all<MemberRow>(
    `SELECT m.* FROM members m JOIN users u ON u.id = m.user_id
     WHERE ${pageWhere.join(' AND ')}
     ORDER BY m.joined_at ASC, m.user_id ASC LIMIT ?`,
    ...pageParams, opts.limit,
  );

  const users = usersById(db, rows.map((r) => r.user_id));
  const roleRows = rolesForServer(db, serverId);
  const roleById = new Map<string, RoleRow>(roleRows.map((r) => [r.id, r]));
  const assignments = rows.length
    ? db.all<{ user_id: string; role_id: string }>(
      `SELECT user_id, role_id FROM member_roles WHERE server_id = ? AND user_id IN (${rows.map(() => '?').join(',')})`,
      serverId, ...rows.map((r) => r.user_id),
    )
    : [];
  const rolesByUser = new Map<string, string[]>();
  for (const a of assignments) {
    const arr = rolesByUser.get(a.user_id) ?? [];
    arr.push(a.role_id);
    rolesByUser.set(a.user_id, arr);
  }

  const members: ServerMember[] = rows.map((row) => {
    const user = users.get(row.user_id);
    return {
      serverId: row.server_id,
      user: user ? toUser(user) : ghostUser(row.user_id),
      nickname: row.nickname,
      roles: rolesByUser.get(row.user_id) ?? [],
      joinedAt: row.joined_at,
      timeoutUntil: row.timeout_until,
    };
  });

  const hoisted = roleRows.filter((r) => r.hoist && !r.is_default).sort((a, b) => b.position - a.position);
  const groupMembers = new Map<string, ServerMember[]>();
  for (const member of members) {
    let chosen: RoleRow | null = null;
    for (const roleId of member.roles) {
      const role = roleById.get(roleId);
      if (role && role.hoist && !role.is_default && (!chosen || role.position > chosen.position)) chosen = role;
    }
    groupMembers.set(chosen?.id ?? '', [...(groupMembers.get(chosen?.id ?? '') ?? []), member]);
  }
  const groups: MemberList['groups'] = [];
  for (const role of hoisted) {
    const list = groupMembers.get(role.id);
    if (list?.length) groups.push({ roleId: role.id, roleName: role.name, color: role.color, members: list });
  }
  const ungrouped = groupMembers.get('');
  if (ungrouped?.length) groups.push({ roleId: null, roleName: 'No Role', color: '#99aab5', members: ungrouped });

  return { members, total, groups };
}

export function getMember(db: DatabaseWrapper, serverId: string, userId: string): MemberRow | null {
  return db.get<MemberRow>('SELECT * FROM members WHERE server_id = ? AND user_id = ?', serverId, userId);
}

export function getBan(db: DatabaseWrapper, serverId: string, userId: string): BanRow | null {
  return db.get<BanRow>('SELECT * FROM bans WHERE server_id = ? AND user_id = ?', serverId, userId);
}

export function listBans(db: DatabaseWrapper, serverId: string): BanDto[] {
  const rows = db.all<BanRow>('SELECT * FROM bans WHERE server_id = ? ORDER BY created_at DESC', serverId);
  const users = usersById(db, rows.flatMap((r) => [r.user_id, r.banned_by]));
  return rows.map((row) => ({
    userId: row.user_id,
    user: users.has(row.user_id) ? toUser(users.get(row.user_id)!) : null,
    moderator: users.has(row.banned_by) ? toUser(users.get(row.banned_by)!) : null,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export function toBanDto(db: DatabaseWrapper, row: BanRow): BanDto {
  const users = usersById(db, [row.user_id, row.banned_by]);
  return {
    userId: row.user_id,
    user: users.has(row.user_id) ? toUser(users.get(row.user_id)!) : null,
    moderator: users.has(row.banned_by) ? toUser(users.get(row.banned_by)!) : null,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function listWarnings(db: DatabaseWrapper, serverId: string, userId?: string | null): WarningDto[] {
  const rows = userId
    ? db.all<WarningRow>('SELECT * FROM warnings WHERE server_id = ? AND user_id = ? ORDER BY created_at DESC', serverId, userId)
    : db.all<WarningRow>('SELECT * FROM warnings WHERE server_id = ? ORDER BY created_at DESC', serverId);
  const users = usersById(db, rows.flatMap((r) => [r.user_id, r.moderator_id]));
  return rows.map((row) => ({
    id: row.id,
    user: users.has(row.user_id) ? toUser(users.get(row.user_id)!) : null,
    moderator: users.has(row.moderator_id) ? toUser(users.get(row.moderator_id)!) : null,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export function getWarning(db: DatabaseWrapper, serverId: string, warningId: string): WarningRow | null {
  return db.get<WarningRow>('SELECT * FROM warnings WHERE id = ? AND server_id = ?', warningId, serverId);
}

function parseChanges(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

export function listAuditEntries(db: DatabaseWrapper, serverId: string, opts: { action?: string | null; before?: string | null; limit: number }): AuditEntry[] {
  const where = ['server_id = ?'];
  const params: unknown[] = [serverId];
  if (opts.action) { where.push('action = ?'); params.push(opts.action); }
  if (opts.before) {
    const anchor = db.get<AuditRow>('SELECT * FROM audit_logs WHERE id = ?', opts.before);
    if (anchor) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(anchor.created_at, anchor.created_at, anchor.id);
    }
  }
  const rows = db.all<AuditRow>(
    `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ...params, opts.limit,
  );
  const users = usersById(db, rows.map((r) => r.actor_id).filter((id): id is string => !!id));
  return rows.map((row) => ({
    id: row.id,
    serverId: row.server_id,
    actor: row.actor_id && users.has(row.actor_id) ? toUser(users.get(row.actor_id)!) : null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    changes: parseChanges(row.changes),
    createdAt: row.created_at,
  }));
}

export function getReport(db: DatabaseWrapper, reportId: string): ReportRow | null {
  return db.get<ReportRow>('SELECT * FROM reports WHERE id = ?', reportId);
}

export function listReportRows(db: DatabaseWrapper, serverId: string, status: 'open' | 'resolved' | 'dismissed' | null): ReportRow[] {
  return status
    ? db.all<ReportRow>('SELECT * FROM reports WHERE server_id = ? AND status = ? ORDER BY created_at DESC', serverId, status)
    : db.all<ReportRow>('SELECT * FROM reports WHERE server_id = ? ORDER BY created_at DESC', serverId);
}

/**
 * Maps a report row to its DTO. `message` is only included when the viewer can see the
 * reported message's channel; mods without access keep the report but not the content.
 */
export function toReport(db: DatabaseWrapper, row: ReportRow, opts: { viewerId: string; canSeeMessage: (message: MessageRow) => boolean }): Report {
  const users = usersById(db, [row.reporter_id, row.target_user_id ?? '', row.resolved_by ?? '']);
  let message: Report['message'] = null;
  if (row.message_id) {
    const messageRow = getMessageRow(db, row.message_id);
    if (messageRow && opts.canSeeMessage(messageRow)) {
      message = serializeMessages(db, [messageRow], opts.viewerId)[0] ?? null;
    }
  }
  return {
    id: row.id,
    guildId: row.server_id,
    reporter: users.has(row.reporter_id) ? toUser(users.get(row.reporter_id)!) : ghostUser(row.reporter_id),
    targetUser: row.target_user_id && users.has(row.target_user_id) ? toUser(users.get(row.target_user_id)!) : null,
    message,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    resolvedBy: row.resolved_by && users.has(row.resolved_by) ? toUser(users.get(row.resolved_by)!) : null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}
