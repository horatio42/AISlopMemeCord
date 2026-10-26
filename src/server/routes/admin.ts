import { existsSync, readFileSync, statSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { ApiError, json, readJson, type Ctx, type Router, type UserRow } from '../http';
import { ValidationError, displayName as vDisplayName, int, optText, text } from '../util/validate';
import { hashPassword } from '../util/crypto';
import { newId, shortCode } from '../util/ids';
import { log } from '../util/log';
import { getSettings, setSetting } from '../services/instance';
import { logAudit } from '../services/audit';
import { notify } from '../services/notifications';
import { getEveryoneRole, type ChannelRow, type RoleRow } from '../services/permissions';
import { toServer, toRole, toChannel, getServerRow } from '../repos/servers';
import { parseJson } from '../repos/users';
import type { MessageRow } from '../repos/messages';
import { ACHIEVEMENTS } from '../../shared/memes';

const MAX_LIMIT = 100;
const DAY_MS = 86_400_000;

// ---------- helpers (owned by admin console; prefix admin_ keeps them greppable) ----------

function admin_paging(ctx: Ctx, defaultLimit = 25): { page: number; limit: number; offset: number } {
  const page = int(ctx.url.searchParams.get('page') ?? undefined, 'page', 1, 1_000_000, 1);
  const limit = int(ctx.url.searchParams.get('limit') ?? undefined, 'limit', 1, MAX_LIMIT, defaultLimit);
  return { page, limit, offset: (page - 1) * limit };
}

function admin_search(ctx: Ctx): string {
  return (ctx.url.searchParams.get('query') ?? '').trim().slice(0, 100);
}

function admin_num(db: Ctx['db'], sql: string, ...params: unknown[]): number {
  return db.get<{ n: number }>(sql, ...params)?.n ?? 0;
}

function admin_bool_field(body: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in body)) return undefined;
  if (typeof body[key] !== 'boolean') throw new ValidationError({ [key]: 'Expected true or false.' });
  return body[key] as boolean;
}

function admin_user_ref(row: UserRow | null | undefined) {
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name, avatar: row.avatar, isAdmin: !!row.is_admin };
}

/** Admin-visible user object. Never exposes password_hash, totp_secret or settings blobs. */
function admin_safe_user(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    bannerColor: row.banner_color,
    bio: row.bio,
    pronouns: row.pronouns,
    status: row.status,
    customStatus: row.custom_status,
    isAdmin: !!row.is_admin,
    isBot: !!row.is_bot,
    disabled: !!row.disabled,
    bannedUntil: row.banned_until,
    banReason: row.ban_reason,
    badges: parseJson<string[]>(row.badges, []),
    karma: row.karma,
    theme: row.theme,
    publicKey: row.public_key,
    hasTotp: !!row.totp_secret,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function admin_require_user(ctx: Ctx, id: string): UserRow {
  const row = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'USER_NOT_FOUND', 'That goblin does not exist in this dimension.');
  return row;
}

function admin_active_admins(db: Ctx['db'], excludeId?: string): number {
  const now = Date.now();
  return admin_num(
    db,
    `SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0
     AND (banned_until IS NULL OR banned_until <= ?) AND id != ?`,
    now, excludeId ?? '',
  );
}

function admin_banned(value: unknown, field = 'bannedUntil'): number | null {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  let ms: number;
  if (typeof value === 'number') ms = value;
  else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new ValidationError({ [field]: 'Expected epoch milliseconds or an ISO date.' });
    ms = parsed;
  } else throw new ValidationError({ [field]: 'Expected epoch milliseconds or an ISO date.' });
  if (!Number.isFinite(ms) || ms < 0 || ms > Date.now() + 100 * 365 * DAY_MS) {
    throw new ValidationError({ [field]: 'Ban expiry is out of range.' });
  }
  return ms <= Date.now() ? null : Math.floor(ms);
}

interface AuditJoined {
  id: string; server_id: string | null; server_name: string | null; actor_id: string | null;
  actor_username: string | null; actor_display_name: string | null; actor_avatar: string | null; actor_admin: number | null;
  action: string; target_type: string; target_id: string | null; reason: string | null; changes: string | null; created_at: number;
}

const AUDIT_SELECT = `SELECT a.id, a.server_id, s.name AS server_name, a.actor_id,
  u.username AS actor_username, u.display_name AS actor_display_name, u.avatar AS actor_avatar, u.is_admin AS actor_admin,
  a.action, a.target_type, a.target_id, a.reason, a.changes, a.created_at
  FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN servers s ON s.id = a.server_id`;

function admin_audit_dto(row: AuditJoined) {
  return {
    id: row.id,
    serverId: row.server_id,
    serverName: row.server_name,
    actor: row.actor_id
      ? { id: row.actor_id, username: row.actor_username ?? 'unknown', displayName: row.actor_display_name ?? 'Unknown', avatar: row.actor_avatar, isAdmin: !!row.actor_admin }
      : null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    changes: parseJson<Record<string, unknown> | null>(row.changes, null),
    createdAt: row.created_at,
  };
}

function admin_audit_rows(db: Ctx['db'], where: string, params: unknown[], limit: number, offset = 0): AuditJoined[] {
  return db.all<AuditJoined>(`${AUDIT_SELECT} WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
}

function admin_audit(ctx: Ctx, action: string, targetType: string, targetId: string | null, reason?: string | null, changes?: Record<string, unknown> | null) {
  logAudit(ctx.db, { serverId: null, actorId: ctx.user!.id, action, targetType, targetId, reason: reason ?? null, changes: changes ?? null });
}

function admin_message_context(ctx: Ctx, messageId: string | null) {
  if (!messageId) return null;
  const row = ctx.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId);
  if (!row) return null;
  const author = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.author_id);
  const channel = ctx.db.get<{ id: string; name: string; server_id: string | null; type: string }>(
    'SELECT id, name, server_id, type FROM channels WHERE id = ?', row.channel_id,
  );
  const server = channel?.server_id ? getServerRow(ctx.db, channel.server_id) : null;
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: channel?.type === 'dm' || channel?.type === 'group_dm' ? 'Direct Message' : channel?.name ?? null,
    serverId: row.server_id,
    serverName: server?.name ?? null,
    author: admin_user_ref(author),
    // E2EE ciphertext is never decrypted, and not echoed back to the console either.
    encrypted: !!row.encrypted,
    content: row.encrypted ? null : row.content,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

interface ReportRowApi {
  id: string; server_id: string | null; reporter_id: string; target_user_id: string | null; message_id: string | null;
  reason: string; status: string; resolution: string | null; resolved_by: string | null; created_at: number; resolved_at: number | null;
}

function admin_report_dto(ctx: Ctx, row: ReportRowApi) {
  const message = admin_message_context(ctx, row.message_id);
  const reporter = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.reporter_id);
  const target = row.target_user_id ? ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.target_user_id) : null;
  const resolvedBy = row.resolved_by ? ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.resolved_by) : null;
  const serverName = message?.serverName ?? (row.server_id ? getServerRow(ctx.db, row.server_id)?.name ?? null : null);
  return {
    id: row.id,
    serverId: row.server_id,
    serverName,
    channelId: message?.channelId ?? null,
    channelName: message?.channelName ?? null,
    reporter: admin_user_ref(reporter),
    targetUser: admin_user_ref(target),
    message,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    resolvedBy: admin_user_ref(resolvedBy),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function admin_emojis(ctx: Ctx) {
  return ctx.db.all<{ id: string; server_id: string | null; server_name: string | null; name: string; animated: number; uploader_id: string | null; created_at: number; upload_id: string | null }>(
    `SELECT e.id, e.server_id, s.name AS server_name, e.name, e.animated, e.uploader_id, e.created_at,
      (SELECT up.id FROM uploads up WHERE up.path = e.path LIMIT 1) AS upload_id
     FROM emojis e LEFT JOIN servers s ON s.id = e.server_id ORDER BY e.name COLLATE NOCASE`,
  ).map((e) => ({
    id: e.id, serverId: e.server_id, serverName: e.server_name, name: e.name, url: admin_upload_url(e.upload_id),
    animated: !!e.animated, uploaderId: e.uploader_id, createdAt: e.created_at,
  }));
}

type AssetType = 'emojis' | 'stickers' | 'sounds';

function admin_delete_asset(ctx: Ctx, type: AssetType, id: string): Response {
  const row = ctx.db.get<{ id: string; server_id: string | null; name: string }>(`SELECT id, server_id, name FROM ${type} WHERE id = ?`, id);
  if (!row) throw new ApiError(404, 'ASSET_NOT_FOUND', 'That asset has already been fed to the goblin.');
  ctx.db.run(`DELETE FROM ${type} WHERE id = ?`, id);
  const targetType = ({ emojis: 'emoji', stickers: 'sticker', sounds: 'sound' } as Record<AssetType, string>)[type];
  admin_audit(ctx, 'admin.asset.delete', targetType, id, null, { name: row.name, serverId: row.server_id });
  return json({ ok: true, deleted: true });
}

function admin_file_size(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function admin_health(ctx: Ctx) {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    dbSize: admin_file_size(ctx.config.dbPath),
    walSize: admin_file_size(ctx.config.dbPath + '-wal'),
    uptime: Math.floor(process.uptime()),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
    version: ctx.config.version,
    bun: Bun.version,
    node: process.version,
  };
}

function admin_daily_series(db: Ctx['db'], table: string, column: string, days = 14, extraWhere = ''): { date: string; count: number }[] {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = todayUtc - (days - 1) * DAY_MS;
  const rows = db.all<{ day: string; n: number }>(
    `SELECT strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch') AS day, COUNT(*) AS n
     FROM ${table} WHERE ${column} >= ? ${extraWhere} GROUP BY day`,
    since,
  );
  const counts = new Map(rows.map((r) => [r.day, r.n]));
  const out: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(todayUtc - i * DAY_MS).toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

function admin_upload_url(uploadId: string | null | undefined): string | null {
  return uploadId ? `/api/media/uploads/${uploadId}` : null;
}

/** Settings view with any secret-ish keys stripped, even if someone injected one into the DB. */
function admin_settings_view(db: Ctx['db']): Record<string, unknown> {
  const settings = { ...getSettings(db) } as Record<string, unknown>;
  for (const key of ['secret', 'secret_key', 'admin_token']) delete settings[key];
  return settings;
}

// ---------- dashboard ----------

export function register(router: Router) {
  router.get('/api/admin/overview', (ctx) => {
    const db = ctx.db;
    const counts = {
      users: admin_num(db, 'SELECT COUNT(*) AS n FROM users'),
      servers: admin_num(db, 'SELECT COUNT(*) AS n FROM servers'),
      messages: admin_num(db, 'SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL'),
      channels: admin_num(db, 'SELECT COUNT(*) AS n FROM channels'),
      uploads: admin_num(db, 'SELECT COUNT(*) AS n FROM uploads'),
      openReports: admin_num(db, "SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      sessions: admin_num(db, 'SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', Date.now()),
    };
    const uploadBytes = admin_num(db, 'SELECT COALESCE(SUM(size), 0) AS n FROM uploads');
    const attachmentBytes = admin_num(db, 'SELECT COALESCE(SUM(size), 0) AS n FROM attachments');
    const topServers = db.all<{ id: string; name: string; icon: string | null; member_count: number; created_at: number }>(
      'SELECT id, name, icon, member_count, created_at FROM servers ORDER BY member_count DESC, created_at ASC LIMIT 5',
    ).map((s) => ({ id: s.id, name: s.name, icon: s.icon, memberCount: s.member_count }));
    return json({
      counts,
      onlineCount: ctx.hub.onlineCount(),
      storageBytes: uploadBytes + attachmentBytes,
      signups: admin_daily_series(db, 'users', 'created_at'),
      messages: admin_daily_series(db, 'messages', 'created_at', 14, 'AND deleted_at IS NULL'),
      topServers,
      recentAudit: admin_audit_rows(db, '1 = 1', [], 10).map(admin_audit_dto),
      health: admin_health(ctx),
    });
  }, { admin: true });

  router.get('/api/admin/session', (ctx) => json({ user: admin_safe_user(ctx.user!) }), { admin: true });

  router.get('/api/admin/health', (ctx) => json(admin_health(ctx)), { admin: true });

  router.get('/api/admin/logs', (ctx) => {
    const lines = int(ctx.url.searchParams.get('lines') ?? undefined, 'lines', 1, 1_000, 100);
    const path = join(ctx.config.dataDir, 'logs', 'app.log');
    if (!existsSync(path)) return json({ lines: [], file: 'logs/app.log' });
    let content = '';
    try {
      const size = statSync(path).size;
      const readBytes = Math.min(size, 1_000_000);
      const fd = readFileSync(path);
      content = fd.subarray(Math.max(0, fd.length - readBytes)).toString('utf8');
    } catch {
      return json({ lines: [], file: 'logs/app.log' });
    }
    const tail = content.split(/\r?\n/).filter((l) => l.length > 0).slice(-lines);
    return json({ lines: tail, file: 'logs/app.log' });
  }, { admin: true });

  // ---------- users ----------
  router.get('/api/admin/users', (ctx) => {
    const { page, limit, offset } = admin_paging(ctx);
    const query = admin_search(ctx);
    const filter = ctx.url.searchParams.get('filter') ?? 'all';
    if (!['all', 'admin', 'banned', 'disabled'].includes(filter)) {
      throw new ValidationError({ filter: 'Expected all, admin, banned or disabled.' });
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query) {
      conditions.push('(instr(lower(u.username), lower(?)) > 0 OR instr(lower(u.display_name), lower(?)) > 0)');
      params.push(query, query);
    }
    if (filter === 'admin') conditions.push('u.is_admin = 1');
    if (filter === 'banned') { conditions.push('u.banned_until IS NOT NULL AND u.banned_until > ?'); params.push(Date.now()); }
    if (filter === 'disabled') conditions.push('u.disabled = 1');
    const where = conditions.length ? conditions.join(' AND ') : '1 = 1';
    const rows = ctx.db.all<{
      id: string; username: string; display_name: string; avatar: string | null; is_admin: number; disabled: number;
      banned_until: number | null; created_at: number; last_seen_at: number; karma: number; server_count: number; message_count: number;
    }>(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.is_admin, u.disabled, u.banned_until, u.created_at, u.last_seen_at, u.karma,
        (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS server_count,
        (SELECT COUNT(*) FROM messages msg WHERE msg.author_id = u.id AND msg.deleted_at IS NULL) AS message_count
       FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = admin_num(ctx.db, `SELECT COUNT(*) AS n FROM users u WHERE ${where}`, ...params);
    return json({
      users: rows.map((u) => ({
        id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar, isAdmin: !!u.is_admin,
        disabled: !!u.disabled, bannedUntil: u.banned_until, createdAt: u.created_at, lastSeenAt: u.last_seen_at,
        karma: u.karma, serverCount: u.server_count, messageCount: u.message_count,
      })),
      total, page, limit,
    });
  }, { admin: true });

  router.get('/api/admin/users/:id', (ctx) => {
    const row = admin_require_user(ctx, ctx.params.id!);
    const servers = ctx.db.all<{ id: string; name: string; icon: string | null; owner_id: string; member_count: number; joined_at: number; nickname: string | null }>(
      `SELECT s.id, s.name, s.icon, s.owner_id, s.member_count, m.joined_at, m.nickname
       FROM members m JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? ORDER BY s.name COLLATE NOCASE`,
      row.id,
    ).map((s) => ({
      id: s.id, name: s.name, icon: s.icon, memberCount: s.member_count, isOwner: s.owner_id === row.id,
      joinedAt: s.joined_at, nickname: s.nickname,
    }));
    const achievements = ctx.db.all<{ key: string; earned_at: number }>(
      'SELECT key, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at DESC', row.id,
    ).map((a) => {
      const def = ACHIEVEMENTS.find((d) => d.key === a.key);
      return { key: a.key, name: def?.name ?? a.key, description: def?.description ?? '', emoji: def?.emoji ?? '\u{1f3c6}', earnedAt: a.earned_at };
    });
    return json({
      user: admin_safe_user(row),
      servers,
      achievements,
      recentAudit: admin_audit_rows(ctx.db, '(a.actor_id = ? OR (a.target_type = ? AND a.target_id = ?))', [row.id, 'user', row.id], 10).map(admin_audit_dto),
      messageCount: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM messages WHERE author_id = ? AND deleted_at IS NULL', row.id),
      uploads: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM uploads WHERE owner_id = ?', row.id),
      sessions: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', row.id, Date.now()),
    });
  }, { admin: true });

  router.patch('/api/admin/users/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    const row = admin_require_user(ctx, ctx.params.id!);
    const isAdmin = admin_bool_field(body, 'isAdmin');
    const disabled = admin_bool_field(body, 'disabled');
    const bannedUntil = 'bannedUntil' in body ? admin_banned(body.bannedUntil) : undefined;
    const banReason = 'banReason' in body ? optText(body.banReason, 'banReason', 500) : undefined;
    const displayName = 'displayName' in body ? vDisplayName(body.displayName) : undefined;
    const bio = 'bio' in body ? optText(body.bio, 'bio', 500) : undefined;
    if (isAdmin === undefined && disabled === undefined && bannedUntil === undefined && banReason === undefined && displayName === undefined && bio === undefined) {
      throw new ValidationError({ _: 'Nothing to change. Send at least one field, sloplord.' });
    }
    if (row.id === ctx.user!.id) {
      if (disabled) throw new ApiError(400, 'SELF_DISABLE', 'You cannot disable your own admin account. The slop needs a pilot.');
      if (isAdmin === false) throw new ApiError(400, 'SELF_DEMOTE', 'You cannot demote yourself. Find another admin to do your dirty work.');
      if (bannedUntil && bannedUntil > Date.now()) throw new ApiError(400, 'SELF_BAN', 'Banning yourself is a bold strategy. Denied.');
    }
    const now = Date.now();
    const wasActiveAdmin = !!row.is_admin && !row.disabled && !(row.banned_until && row.banned_until > now);
    const nextAdmin = isAdmin ?? !!row.is_admin;
    const nextDisabled = disabled ?? !!row.disabled;
    const nextBan = bannedUntil === undefined ? row.banned_until : bannedUntil;
    const willBeActiveAdmin = nextAdmin && !nextDisabled && !(nextBan && nextBan > now);
    if (wasActiveAdmin && !willBeActiveAdmin && admin_active_admins(ctx.db, row.id) === 0) {
      throw new ApiError(409, 'LAST_ADMIN', 'That would leave the instance with zero active admins. The slop cannot rule itself.');
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const changes: Record<string, unknown> = {};
    if (isAdmin !== undefined && isAdmin !== !!row.is_admin) { sets.push('is_admin = ?'); values.push(isAdmin ? 1 : 0); changes.isAdmin = isAdmin; }
    if (disabled !== undefined && disabled !== !!row.disabled) { sets.push('disabled = ?'); values.push(disabled ? 1 : 0); changes.disabled = disabled; }
    if (bannedUntil !== undefined && bannedUntil !== row.banned_until) { sets.push('banned_until = ?'); values.push(bannedUntil); changes.bannedUntil = bannedUntil; }
    if (banReason !== undefined && banReason !== row.ban_reason) { sets.push('ban_reason = ?'); values.push(banReason); changes.banReason = banReason; }
    if (displayName !== undefined && displayName !== row.display_name) { sets.push('display_name = ?'); values.push(displayName); changes.displayName = displayName; }
    if (bio !== undefined && bio !== row.bio) { sets.push('bio = ?'); values.push(bio); changes.bio = bio; }
    const lockout = (disabled === true) || (bannedUntil !== undefined && bannedUntil !== null && bannedUntil > now);
    if (sets.length) ctx.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...values, row.id);
    if (lockout) ctx.db.run('DELETE FROM sessions WHERE user_id = ?', row.id);
    const updated = admin_require_user(ctx, row.id);
    const safe = admin_safe_user(updated);
    ctx.hub.send(row.id, 'USER_UPDATE', safe);
    for (const m of ctx.db.all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ?', row.id)) {
      ctx.hub.broadcastServer(m.server_id, 'USER_UPDATE', safe, row.id);
    }
    admin_audit(ctx, 'admin.user.update', 'user', row.id, banReason ?? undefined, { ...changes, revokedSessions: lockout });
    return json({ user: safe, revokedSessions: lockout });
  }, { admin: true });

  router.post('/api/admin/users/:id/reset-password', async (ctx) => {
    const row = admin_require_user(ctx, ctx.params.id!);
    if (row.id === ctx.user!.id) {
      throw new ApiError(400, 'SELF_RESET', 'Use Settings → Password to change your own password. Resetting yourself here would revoke the session showing you the temporary password.');
    }
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let temporaryPassword = '';
    for (const b of bytes) temporaryPassword += alphabet[b % alphabet.length]!;
    const hash = await hashPassword(temporaryPassword);
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, row.id);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', row.id);
    admin_audit(ctx, 'admin.user.reset_password', 'user', row.id, 'Password reset by instance admin');
    ctx.hub.send(row.id, 'USER_UPDATE', admin_safe_user(admin_require_user(ctx, row.id)));
    return json({ temporaryPassword, user: admin_safe_user(row) });
  }, { admin: true, rateLimit: { windowMs: 60_000, max: 20 } });

  router.post('/api/admin/users/:id/revoke-sessions', (ctx) => {
    const row = admin_require_user(ctx, ctx.params.id!);
    const revoked = admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', row.id);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', row.id);
    admin_audit(ctx, 'admin.user.revoke_sessions', 'user', row.id, null, { revoked });
    return json({ ok: true, revoked });
  }, { admin: true });

  router.delete('/api/admin/users/:id', (ctx) => {
    const row = admin_require_user(ctx, ctx.params.id!);
    if (row.id === ctx.user!.id) throw new ApiError(400, 'SELF_DELETE', 'Deleting yourself mid-slop is not allowed. Hand the crown over first.');
    const owned = ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM servers WHERE owner_id = ?', row.id);
    const memberships = ctx.db.all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ?', row.id);
    for (const s of owned) ctx.hub.broadcastServer(s.id, 'SERVER_LEAVE', { serverId: s.id, deleted: true, name: s.name });
    for (const m of memberships) ctx.hub.broadcastServer(m.server_id, 'MEMBER_REMOVE', { serverId: m.server_id, userId: row.id });
    admin_audit(ctx, 'admin.user.delete', 'user', row.id, null, { username: row.username, deletedServers: owned.length });
    ctx.db.run('DELETE FROM users WHERE id = ?', row.id);
    return json({ ok: true, deletedServers: owned.length, deletedMemberships: memberships.length });
  }, { admin: true });
  // ---------- servers & channels ----------
  router.get('/api/admin/servers', (ctx) => {
    const { page, limit, offset } = admin_paging(ctx);
    const query = admin_search(ctx);
    const where = query ? 'instr(lower(s.name), lower(?)) > 0' : '1 = 1';
    const params: unknown[] = query ? [query] : [];
    const rows = ctx.db.all<{
      id: string; name: string; icon: string | null; description: string | null; owner_id: string; member_count: number;
      is_public: number; nsfw: number; created_at: number; channel_count: number; message_count: number;
      owner_username: string | null; owner_display_name: string | null; owner_avatar: string | null; owner_admin: number | null;
    }>(
      `SELECT s.id, s.name, s.icon, s.description, s.owner_id, s.member_count, s.is_public, s.nsfw, s.created_at,
        (SELECT COUNT(*) FROM channels c WHERE c.server_id = s.id) AS channel_count,
        (SELECT COUNT(*) FROM messages m WHERE m.server_id = s.id AND m.deleted_at IS NULL) AS message_count,
        u.username AS owner_username, u.display_name AS owner_display_name, u.avatar AS owner_avatar, u.is_admin AS owner_admin
       FROM servers s LEFT JOIN users u ON u.id = s.owner_id
       WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    const total = admin_num(ctx.db, `SELECT COUNT(*) AS n FROM servers s WHERE ${where}`, ...params);
    return json({
      servers: rows.map((s) => ({
        id: s.id, name: s.name, icon: s.icon, description: s.description, isPublic: !!s.is_public, nsfw: !!s.nsfw,
        memberCount: s.member_count, channelCount: s.channel_count, messageCount: s.message_count, createdAt: s.created_at,
        owner: s.owner_id ? { id: s.owner_id, username: s.owner_username ?? 'unknown', displayName: s.owner_display_name ?? 'Unknown', avatar: s.owner_avatar, isAdmin: !!s.owner_admin } : null,
      })),
      total, page, limit,
    });
  }, { admin: true });

  router.get('/api/admin/servers/:id', (ctx) => {
    const server = getServerRow(ctx.db, ctx.params.id!);
    if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'That server fell into the slop void.');
    const owner = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', server.owner_id);
    const invites = ctx.db.all<{
      code: string; server_id: string; channel_id: string | null; creator_id: string; max_uses: number; uses: number;
      expires_at: number | null; created_at: number; creator_username: string | null; creator_display_name: string | null;
      creator_avatar: string | null; creator_admin: number | null;
    }>(
      `SELECT i.code, i.server_id, i.channel_id, i.creator_id, i.max_uses, i.uses, i.expires_at, i.created_at,
        u.username AS creator_username, u.display_name AS creator_display_name, u.avatar AS creator_avatar, u.is_admin AS creator_admin
       FROM invites i LEFT JOIN users u ON u.id = i.creator_id WHERE i.server_id = ? ORDER BY i.created_at DESC`,
      server.id,
    ).map((i) => ({
      code: i.code, serverId: i.server_id, channelId: i.channel_id,
      creator: { id: i.creator_id, username: i.creator_username ?? 'unknown', displayName: i.creator_display_name ?? 'Unknown', avatar: i.creator_avatar, isAdmin: !!i.creator_admin },
      uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at, createdAt: i.created_at,
    }));
    const channels = ctx.db.all<ChannelRow>('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC', server.id);
    const roles = ctx.db.all<RoleRow>('SELECT * FROM roles WHERE server_id = ? ORDER BY position DESC, created_at ASC', server.id);
    return json({
      server: toServer(server),
      owner: admin_user_ref(owner),
      channels: channels.map((c) => toChannel(c)),
      roles: roles.map((r) => toRole(r)),
      invites,
      counts: {
        members: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM members WHERE server_id = ?', server.id),
        channels: channels.length,
        roles: roles.length,
        messages: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM messages WHERE server_id = ? AND deleted_at IS NULL', server.id),
        recentMessages: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM messages WHERE server_id = ? AND deleted_at IS NULL AND created_at >= ?', server.id, Date.now() - DAY_MS),
        bans: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM bans WHERE server_id = ?', server.id),
      },
    });
  }, { admin: true });

  router.patch('/api/admin/servers/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    const server = getServerRow(ctx.db, ctx.params.id!);
    if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'That server fell into the slop void.');
    const sets: string[] = [];
    const values: unknown[] = [];
    const changes: Record<string, unknown> = {};
    if ('name' in body) {
      const name = text(String(body.name ?? '').trim(), 'name', 1, 100);
      if (name !== server.name) { sets.push('name = ?'); values.push(name); changes.name = name; }
    }
    if ('description' in body) {
      const description = optText(body.description, 'description', 500);
      if (description !== server.description) { sets.push('description = ?'); values.push(description); changes.description = description; }
    }
    const isPublic = admin_bool_field(body, 'isPublic');
    if (isPublic !== undefined && isPublic !== !!server.is_public) { sets.push('is_public = ?'); values.push(isPublic ? 1 : 0); changes.isPublic = isPublic; }
    const nsfw = admin_bool_field(body, 'nsfw');
    if (nsfw !== undefined && nsfw !== !!server.nsfw) { sets.push('nsfw = ?'); values.push(nsfw ? 1 : 0); changes.nsfw = nsfw; }
    if ('ownerId' in body) {
      const ownerId = String(body.ownerId ?? '');
      const owner = ownerId ? ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', ownerId) : null;
      if (!owner) throw new ValidationError({ ownerId: 'That user does not exist.' });
      if (owner.disabled) throw new ValidationError({ ownerId: 'Disabled users cannot own a server.' });
      if (!ctx.db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', server.id, owner.id)) {
        const now = Date.now();
        ctx.db.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', server.id, owner.id, now);
        const everyone = getEveryoneRole(ctx.db, server.id);
        if (everyone) ctx.db.run('INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', server.id, owner.id, everyone.id);
        ctx.db.run('UPDATE servers SET member_count = member_count + 1 WHERE id = ?', server.id);
        ctx.hub.broadcastServer(server.id, 'MEMBER_ADD', { serverId: server.id, userId: owner.id });
      }
      if (owner.id !== server.owner_id) { sets.push('owner_id = ?'); values.push(owner.id); changes.ownerId = owner.id; }
    }
    if (!sets.length) return json({ server: toServer(server), changed: false });
    ctx.db.run(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`, ...values, server.id);
    const updated = getServerRow(ctx.db, server.id)!;
    ctx.hub.invalidateServer(server.id);
    ctx.hub.broadcastServer(server.id, 'SERVER_UPDATE', toServer(updated));
    admin_audit(ctx, 'admin.server.update', 'server', server.id, null, changes);
    return json({ server: toServer(updated), changed: true });
  }, { admin: true });

  router.delete('/api/admin/servers/:id', (ctx) => {
    const server = getServerRow(ctx.db, ctx.params.id!);
    if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'That server fell into the slop void.');
    const memberCount = admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM members WHERE server_id = ?', server.id);
    ctx.hub.broadcastServer(server.id, 'SERVER_LEAVE', { serverId: server.id, deleted: true, name: server.name });
    admin_audit(ctx, 'admin.server.delete', 'server', server.id, null, { name: server.name, memberCount });
    ctx.db.run('DELETE FROM servers WHERE id = ?', server.id);
    ctx.hub.invalidateServer(server.id);
    return json({ ok: true, deleted: true, memberCount });
  }, { admin: true });

  router.patch('/api/admin/channels/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    const channel = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', ctx.params.id!);
    if (!channel) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel is gone. Poof.');
    if (!channel.server_id) throw new ApiError(400, 'DM_CHANNEL', 'Admin channel management only covers server channels. DMs are private-ish.');
    const sets: string[] = [];
    const values: unknown[] = [];
    const changes: Record<string, unknown> = {};
    if ('name' in body) {
      const name = text(String(body.name ?? '').trim(), 'name', 1, 100);
      if (name !== channel.name) { sets.push('name = ?'); values.push(name); changes.name = name; }
    }
    if ('topic' in body) {
      const topic = optText(body.topic, 'topic', 1024);
      if (topic !== channel.topic) { sets.push('topic = ?'); values.push(topic); changes.topic = topic; }
    }
    const nsfw = admin_bool_field(body, 'nsfw');
    if (nsfw !== undefined && nsfw !== !!channel.nsfw) { sets.push('nsfw = ?'); values.push(nsfw ? 1 : 0); changes.nsfw = nsfw; }
    const locked = admin_bool_field(body, 'locked');
    if (locked !== undefined && locked !== !!channel.locked) { sets.push('locked = ?'); values.push(locked ? 1 : 0); changes.locked = locked; }
    if ('slowmode' in body) {
      const slowmode = int(body.slowmode, 'slowmode', 0, 21_600);
      if (slowmode !== channel.slowmode) { sets.push('slowmode = ?'); values.push(slowmode); changes.slowmode = slowmode; }
    }
    if (!sets.length) return json({ channel: toChannel(channel), changed: false });
    ctx.db.run(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`, ...values, channel.id);
    const updated = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channel.id)!;
    ctx.hub.invalidateChannel(channel.id);
    ctx.hub.broadcastServer(channel.server_id, 'CHANNEL_UPDATE', toChannel(updated));
    admin_audit(ctx, 'admin.channel.update', 'channel', channel.id, null, { serverId: channel.server_id, ...changes });
    return json({ channel: toChannel(updated), changed: true });
  }, { admin: true });

  router.delete('/api/admin/channels/:id', (ctx) => {
    const channel = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', ctx.params.id!);
    if (!channel) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'That channel is gone. Poof.');
    if (!channel.server_id) throw new ApiError(400, 'DM_CHANNEL', 'Admin channel management only covers server channels. DMs are private-ish.');
    const messageCount = admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM messages WHERE channel_id = ?', channel.id);
    admin_audit(ctx, 'admin.channel.delete', 'channel', channel.id, null, { serverId: channel.server_id, name: channel.name, messageCount });
    ctx.db.run('DELETE FROM channels WHERE id = ?', channel.id);
    ctx.hub.invalidateChannel(channel.id);
    ctx.hub.broadcastServer(channel.server_id, 'CHANNEL_DELETE', { channelId: channel.id, serverId: channel.server_id });
    return json({ ok: true, deleted: true, messageCount });
  }, { admin: true });
  // ---------- reports ----------
  router.get('/api/admin/reports', (ctx) => {
    const status = ctx.url.searchParams.get('status') ?? 'open';
    if (!['open', 'resolved', 'dismissed', 'all'].includes(status)) {
      throw new ValidationError({ status: 'Expected open, resolved, dismissed or all.' });
    }
    const { page, limit, offset } = admin_paging(ctx, 50);
    const where = status === 'all' ? '1 = 1' : 'status = ?';
    const params: unknown[] = status === 'all' ? [] : [status];
    const rows = ctx.db.all<ReportRowApi>(`SELECT * FROM reports WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    const total = admin_num(ctx.db, `SELECT COUNT(*) AS n FROM reports WHERE ${where}`, ...params);
    return json({ reports: rows.map((r) => admin_report_dto(ctx, r)), total, page, limit });
  }, { admin: true });

  router.post('/api/admin/reports/:id/resolve', async (ctx) => {
    const body = await readJson(ctx.req);
    const report = ctx.db.get<ReportRowApi>('SELECT * FROM reports WHERE id = ?', ctx.params.id!);
    if (!report) throw new ApiError(404, 'REPORT_NOT_FOUND', 'That report evaporated into the slop mist.');
    const status = String(body.status ?? '');
    if (status !== 'resolved' && status !== 'dismissed') throw new ValidationError({ status: 'Expected resolved or dismissed.' });
    const resolution = 'resolution' in body ? optText(body.resolution, 'resolution', 500) : null;
    const action = String(body.action ?? 'none');
    if (!['none', 'delete_message', 'timeout', 'ban'].includes(action)) {
      throw new ValidationError({ action: 'Expected none, delete_message, timeout or ban.' });
    }
    const durationMs = action === 'timeout' ? int(body.durationMs, 'durationMs', 60_000, 28 * DAY_MS, 3_600_000) : 0;
    if (report.status !== 'open') {
      return json({ report: admin_report_dto(ctx, report), alreadyResolved: true });
    }
    if (action === 'delete_message' && !report.message_id) {
      throw new ValidationError({ action: 'This report has no message to delete.' });
    }
    if ((action === 'timeout' || action === 'ban') && (!report.server_id || !report.target_user_id)) {
      throw new ValidationError({ action: 'Timeouts and bans need a reported server member.' });
    }
    const now = Date.now();
    let actionApplied = 'none';
    if (action === 'delete_message' && report.message_id) {
      const message = ctx.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', report.message_id);
      if (message && !message.deleted_at) {
        ctx.db.run('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?', now, ctx.user!.id, message.id);
        ctx.hub.broadcastChannel(message.channel_id, 'MESSAGE_DELETE', { id: message.id, channelId: message.channel_id });
      }
      actionApplied = 'delete_message';
    }
    if (action === 'timeout' && report.server_id && report.target_user_id) {
      const timeoutUntil = now + durationMs;
      const changed = ctx.db.run(
        'UPDATE members SET timeout_until = ? WHERE server_id = ? AND user_id = ?',
        timeoutUntil, report.server_id, report.target_user_id,
      ).changes;
      if (!changed) throw new ValidationError({ action: 'Target is no longer a member of that server.' });
      ctx.hub.broadcastServer(report.server_id, 'MEMBER_UPDATE', { serverId: report.server_id, userId: report.target_user_id, timeoutUntil });
      actionApplied = 'timeout';
    }
    if (action === 'ban' && report.server_id && report.target_user_id) {
      ctx.db.transaction(() => {
        ctx.db.run(
          `INSERT INTO bans (server_id, user_id, banned_by, reason, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(server_id, user_id) DO UPDATE SET banned_by = excluded.banned_by, reason = excluded.reason, created_at = excluded.created_at`,
          report.server_id, report.target_user_id, ctx.user!.id, resolution ?? report.reason, now,
        );
        const removed = ctx.db.run('DELETE FROM members WHERE server_id = ? AND user_id = ?', report.server_id, report.target_user_id).changes;
        ctx.db.run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', report.server_id, report.target_user_id);
        if (removed) ctx.db.run('UPDATE servers SET member_count = MAX(0, member_count - 1) WHERE id = ?', report.server_id);
      });
      ctx.hub.broadcastServer(report.server_id, 'MEMBER_REMOVE', { serverId: report.server_id, userId: report.target_user_id, banned: true });
      actionApplied = 'ban';
    }
    ctx.db.run(
      'UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?',
      status, resolution, ctx.user!.id, now, report.id,
    );
    const updated = ctx.db.get<ReportRowApi>('SELECT * FROM reports WHERE id = ?', report.id)!;
    notify(ctx.db, ctx.hub, {
      userId: report.reporter_id,
      type: 'report',
      title: `Your report was ${status}`,
      body: resolution ?? (actionApplied === 'none' ? 'The janitor looked at it and shrugged.' : `Action taken: ${actionApplied.replace('_', ' ')}.`),
      serverId: report.server_id,
      channelId: report.message_id
        ? ctx.db.get<{ channel_id: string }>('SELECT channel_id FROM messages WHERE id = ?', report.message_id)?.channel_id ?? null
        : null,
      messageId: report.message_id,
      actorId: ctx.user!.id,
    });
    admin_audit(ctx, 'admin.report.resolve', 'report', report.id, resolution, { status, action: actionApplied, durationMs: durationMs || null });
    return json({ report: admin_report_dto(ctx, updated), actionApplied });
  }, { admin: true });

  // ---------- audit log ----------
  router.get('/api/admin/audit', (ctx) => {
    const { page, limit, offset } = admin_paging(ctx, 50);
    const query = admin_search(ctx);
    const serverId = (ctx.url.searchParams.get('serverId') ?? '').trim();
    const actorId = (ctx.url.searchParams.get('actorId') ?? '').trim();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query) {
      conditions.push('(instr(lower(a.action), lower(?)) > 0 OR instr(lower(COALESCE(a.reason, \'\')), lower(?)) > 0 OR instr(lower(COALESCE(a.target_id, \'\')), lower(?)) > 0 OR instr(lower(COALESCE(u.username, \'\')), lower(?)) > 0)');
      params.push(query, query, query, query);
    }
    if (serverId) { conditions.push('a.server_id = ?'); params.push(serverId); }
    if (actorId) { conditions.push('a.actor_id = ?'); params.push(actorId); }
    const where = conditions.length ? conditions.join(' AND ') : '1 = 1';
    const total = admin_num(
      ctx.db,
      `SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where}`,
      ...params,
    );
    const entries = admin_audit_rows(ctx.db, where, params, limit, offset).map(admin_audit_dto);
    return json({ entries, total, page, limit });
  }, { admin: true });
  // ---------- invites ----------
  router.get('/api/admin/invites', (ctx) => {
    const rows = ctx.db.all<{
      code: string; server_id: string; channel_id: string | null; creator_id: string; max_uses: number; uses: number;
      expires_at: number | null; created_at: number; server_name: string; creator_username: string | null;
      creator_display_name: string | null; creator_avatar: string | null; creator_admin: number | null;
    }>(
      `SELECT i.code, i.server_id, i.channel_id, i.creator_id, i.max_uses, i.uses, i.expires_at, i.created_at,
        s.name AS server_name, u.username AS creator_username, u.display_name AS creator_display_name,
        u.avatar AS creator_avatar, u.is_admin AS creator_admin
       FROM invites i JOIN servers s ON s.id = i.server_id LEFT JOIN users u ON u.id = i.creator_id
       ORDER BY i.created_at DESC`,
    );
    return json({
      invites: rows.map((i) => ({
        code: i.code, serverId: i.server_id, serverName: i.server_name, channelId: i.channel_id,
        creator: { id: i.creator_id, username: i.creator_username ?? 'unknown', displayName: i.creator_display_name ?? 'Unknown', avatar: i.creator_avatar, isAdmin: !!i.creator_admin },
        uses: i.uses, maxUses: i.max_uses, expiresAt: i.expires_at, createdAt: i.created_at,
      })),
      total: rows.length,
    });
  }, { admin: true });

  router.delete('/api/admin/invites/:code', (ctx) => {
    const invite = ctx.db.get<{ code: string; server_id: string }>('SELECT code, server_id FROM invites WHERE code = ?', ctx.params.code!);
    if (!invite) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite already expired into oblivion.');
    ctx.db.run('DELETE FROM invites WHERE code = ?', invite.code);
    admin_audit(ctx, 'admin.invite.delete', 'invite', invite.code, null, { serverId: invite.server_id });
    return json({ ok: true, deleted: true });
  }, { admin: true });

  router.get('/api/admin/account-invites', (ctx) => {
    const rows = ctx.db.all<{
      code: string; created_by: string; max_uses: number; uses: number; expires_at: number | null; created_at: number;
      creator_username: string | null; creator_display_name: string | null; creator_avatar: string | null; creator_admin: number | null;
    }>(
      `SELECT ai.code, ai.created_by, ai.max_uses, ai.uses, ai.expires_at, ai.created_at,
        u.username AS creator_username, u.display_name AS creator_display_name, u.avatar AS creator_avatar, u.is_admin AS creator_admin
       FROM account_invites ai LEFT JOIN users u ON u.id = ai.created_by ORDER BY ai.created_at DESC`,
    );
    const now = Date.now();
    return json({
      invites: rows.map((i) => ({
        code: i.code,
        createdBy: { id: i.created_by, username: i.creator_username ?? 'unknown', displayName: i.creator_display_name ?? 'Unknown', avatar: i.creator_avatar, isAdmin: !!i.creator_admin },
        maxUses: i.max_uses, uses: i.uses, expiresAt: i.expires_at, createdAt: i.created_at,
        expired: !!i.expires_at && i.expires_at <= now,
        exhausted: i.max_uses > 0 && i.uses >= i.max_uses,
      })),
      total: rows.length,
    });
  }, { admin: true });

  router.post('/api/admin/account-invites', async (ctx) => {
    const body = await readJson(ctx.req);
    const maxUses = int(body.maxUses, 'maxUses', 0, 1_000, 1);
    const expiresInHours = int(body.expiresInHours, 'expiresInHours', 0, 8_760, 0);
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const candidate = shortCode(10);
      if (!ctx.db.get('SELECT 1 FROM account_invites WHERE code = ?', candidate)) code = candidate;
    }
    if (!code) throw new ApiError(500, 'INVITE_CODE_FAILED', 'The entropy goblin failed to invent a code. Try again.');
    const now = Date.now();
    const expiresAt = expiresInHours > 0 ? now + expiresInHours * 3_600_000 : null;
    ctx.db.run(
      'INSERT INTO account_invites (code, created_by, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)',
      code, ctx.user!.id, maxUses, expiresAt, now,
    );
    admin_audit(ctx, 'admin.account_invite.create', 'account_invite', code, null, { maxUses, expiresAt });
    return json({ invite: { code, createdBy: admin_user_ref(ctx.user!), maxUses, uses: 0, expiresAt, createdAt: now } });
  }, { admin: true });

  router.delete('/api/admin/account-invites/:code', (ctx) => {
    const invite = ctx.db.get<{ code: string }>('SELECT code FROM account_invites WHERE code = ?', ctx.params.code!);
    if (!invite) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That code was never a code, or it has been recycled.');
    ctx.db.run('DELETE FROM account_invites WHERE code = ?', invite.code);
    admin_audit(ctx, 'admin.account_invite.delete', 'account_invite', invite.code);
    return json({ ok: true, deleted: true });
  }, { admin: true });

  // ---------- settings ----------
  router.get('/api/admin/settings', (ctx) => json({ settings: admin_settings_view(ctx.db) }), { admin: true });

  router.patch('/api/admin/settings', async (ctx) => {
    const body = await readJson(ctx.req);
    const current = getSettings(ctx.db);
    const updates: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};
    const fields: Record<string, string> = {};
    const allowed: Record<string, true> = {
      instance_name: true, instance_description: true, motd: true, registration: true, max_upload_mb: true,
      e2ee_enabled: true, soundboard_enabled: true, voice_enabled: true, forum_enabled: true, webhooks_enabled: true,
      public_discovery: true, meme_mode: true, slop_of_the_day: true,
    };
    for (const key of Object.keys(body)) {
      if (!allowed[key]) { fields[key] = 'Unknown setting.'; continue; }
      try {
        const value = body[key];
        if (key === 'instance_name') updates[key] = text(String(value ?? '').trim(), key, 1, 64);
        else if (key === 'instance_description') updates[key] = text(String(value ?? ''), key, 0, 500);
        else if (key === 'motd') updates[key] = text(String(value ?? ''), key, 0, 500);
        else if (key === 'registration') {
          if (value !== 'open' && value !== 'invite' && value !== 'closed') throw new ValidationError({ registration: 'Expected open, invite or closed.' });
          updates[key] = value;
        } else if (key === 'max_upload_mb') updates[key] = int(value, key, 1, 500);
        else if (key === 'meme_mode') updates[key] = text(String(value ?? '').trim(), key, 1, 32);
        else if (key === 'slop_of_the_day') updates[key] = text(String(value ?? ''), key, 0, 500);
        else {
          const flag = admin_bool_field(body, key);
          updates[key] = !!flag;
        }
      } catch (e) {
        if (e instanceof ValidationError) { Object.assign(fields, e.fields); continue; }
        throw e;
      }
    }
    if (Object.keys(fields).length) throw new ValidationError(fields);
    for (const [key, value] of Object.entries(updates)) {
      if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
      setSetting(ctx.db, key, value);
      changes[key] = value;
    }
    if (Object.keys(changes).length) admin_audit(ctx, 'admin.settings.update', 'settings', null, null, changes);
    return json({ settings: admin_settings_view(ctx.db), changed: Object.keys(changes) });
  }, { admin: true });
  // ---------- emojis, stickers, sounds ----------
  router.get('/api/admin/emojis', (ctx) => json({ emojis: admin_emojis(ctx) }), { admin: true });

  router.post('/api/admin/emojis', async (ctx) => {
    const body = await readJson(ctx.req);
    const name = String(body.name ?? '').trim();
    if (!/^[a-z0-9_]{2,32}$/i.test(name)) throw new ValidationError({ name: 'Emoji names are 2-32 letters, digits or underscores.' });
    const uploadId = String(body.uploadId ?? '');
    const upload = uploadId ? ctx.db.get<{ id: string; purpose: string; path: string; content_type: string; owner_id: string }>(
      'SELECT id, purpose, path, content_type, owner_id FROM uploads WHERE id = ?', uploadId,
    ) : null;
    if (!upload) throw new ValidationError({ uploadId: 'That upload does not exist.' });
    if (upload.purpose !== 'emoji') throw new ValidationError({ uploadId: 'That upload was not uploaded for emoji duty.' });
    let serverId: string | null = null;
    if (body.serverId !== undefined && body.serverId !== null && body.serverId !== '') {
      serverId = String(body.serverId);
      if (!getServerRow(ctx.db, serverId)) throw new ValidationError({ serverId: 'That server does not exist.' });
    }
    const existing = ctx.db.get('SELECT 1 FROM emojis WHERE COALESCE(server_id, \'*\') = ? AND name = ?', serverId ?? '*', name);
    if (existing) throw new ApiError(409, 'EMOJI_EXISTS', 'That emoji name is already hogging the slot.');
    const id = newId('em');
    const now = Date.now();
    const animated = upload.content_type === 'image/gif' ? 1 : 0;
    ctx.db.run(
      'INSERT INTO emojis (id, server_id, name, path, animated, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, serverId, name, upload.path, animated, upload.owner_id, now,
    );
    admin_audit(ctx, 'admin.emoji.create', 'emoji', id, null, { name, serverId, uploadId });
    return json({
      emoji: { id, serverId, serverName: serverId ? getServerRow(ctx.db, serverId)?.name ?? null : null, name, url: admin_upload_url(upload.id), animated: !!animated, uploaderId: upload.owner_id, createdAt: now },
    });
  }, { admin: true });

  router.delete('/api/admin/emojis/:id', (ctx) => admin_delete_asset(ctx, 'emojis', ctx.params.id!), { admin: true });

  router.get('/api/admin/assets', (ctx) => json({
    emojis: admin_emojis(ctx),
    stickers: ctx.db.all<{ id: string; server_id: string | null; server_name: string | null; name: string; description: string | null; tags: string; uploader_id: string | null; created_at: number; upload_id: string | null }>(
      `SELECT st.id, st.server_id, s.name AS server_name, st.name, st.description, st.tags, st.uploader_id, st.created_at,
        (SELECT up.id FROM uploads up WHERE up.path = st.path LIMIT 1) AS upload_id
       FROM stickers st LEFT JOIN servers s ON s.id = st.server_id ORDER BY st.name COLLATE NOCASE`,
    ).map((st) => ({
      id: st.id, serverId: st.server_id, serverName: st.server_name, name: st.name,
      url: admin_upload_url(st.upload_id), description: st.description,
      tags: parseJson<string[]>(st.tags, []), uploaderId: st.uploader_id, createdAt: st.created_at,
    })),
    sounds: ctx.db.all<{ id: string; server_id: string | null; server_name: string | null; name: string; emoji: string; uploader_id: string | null; created_at: number; upload_id: string | null }>(
      `SELECT sn.id, sn.server_id, s.name AS server_name, sn.name, sn.emoji, sn.uploader_id, sn.created_at,
        (SELECT up.id FROM uploads up WHERE up.path = sn.path LIMIT 1) AS upload_id
       FROM sounds sn LEFT JOIN servers s ON s.id = sn.server_id ORDER BY sn.name COLLATE NOCASE`,
    ).map((sn) => ({
      id: sn.id, serverId: sn.server_id, serverName: sn.server_name, name: sn.name, emoji: sn.emoji,
      url: admin_upload_url(sn.upload_id), uploaderId: sn.uploader_id, createdAt: sn.created_at,
    })),
  }), { admin: true });

  router.delete('/api/admin/assets/:type/:id', (ctx) => {
    const type = ({ emojis: 'emojis', stickers: 'stickers', sounds: 'sounds' } as Record<string, AssetType>)[ctx.params.type!];
    if (!type) throw new ValidationError({ type: 'Expected emojis, stickers or sounds.' });
    return admin_delete_asset(ctx, type, ctx.params.id!);
  }, { admin: true });
  // ---------- backup ----------
  router.get('/api/admin/backup', (ctx) => {
    const includeMedia = ['1', 'true', 'yes'].includes((ctx.url.searchParams.get('media') ?? '').toLowerCase());
    const workDir = mkdtempSync(join(tmpdir(), 'slop-backup-'));
    const snapshot = join(workDir, 'slop.db');
    try {
      ctx.db.run('VACUUM INTO ?', snapshot);
      const entries: Record<string, Uint8Array> = {};
      entries['slop.db'] = new Uint8Array(readFileSync(snapshot));
      const counts = {
        users: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM users'),
        servers: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM servers'),
        members: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM members'),
        channels: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM channels'),
        messages: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM messages'),
        uploads: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM uploads'),
        reports: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM reports'),
        emojis: admin_num(ctx.db, 'SELECT COUNT(*) AS n FROM emojis'),
      };
      const createdAt = Date.now();
      entries['manifest.json'] = strToU8(JSON.stringify({
        application: 'AISlopMemeCord',
        version: ctx.config.version,
        createdAt: new Date(createdAt).toISOString(),
        counts,
        media: includeMedia,
      }, null, 2));
      entries['settings.json'] = strToU8(JSON.stringify(admin_settings_view(ctx.db), null, 2));
      if (includeMedia) {
        for (const upload of ctx.db.all<{ id: string; path: string; filename: string }>('SELECT id, path, filename FROM uploads')) {
          if (!upload.path || upload.path.includes('..')) continue;
          const absolute = resolve(ctx.config.uploadDir, upload.path);
          if (!absolute.startsWith(ctx.config.uploadDir + sep) || !existsSync(absolute)) continue;
          const safeName = basename(upload.filename).replace(/[^\w.\-]/g, '_') || 'file';
          entries[`uploads/${upload.id}-${safeName}`] = new Uint8Array(readFileSync(absolute));
        }
      }
      const archive = zipSync(entries, { level: 6 });
      admin_audit(ctx, 'admin.backup.download', 'backup', null, null, { media: includeMedia, bytes: archive.byteLength, counts });
      const stamp = new Date(createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
      return new Response(archive, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="slop-backup-${stamp}.zip"`,
          'cache-control': 'no-store',
        },
      });
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }, { admin: true, rateLimit: { windowMs: 60_000, max: 3 } });

  // ---------- maintenance ----------
  router.post('/api/admin/maintenance', async (ctx) => {
    const body = await readJson(ctx.req);
    const action = String(body.action ?? '');
    let result: Record<string, unknown>;
    if (action === 'vacuum') {
      const sizeBefore = admin_file_size(ctx.config.dbPath);
      ctx.db.exec('PRAGMA optimize');
      ctx.db.exec('VACUUM');
      result = { sizeBefore, sizeAfter: admin_file_size(ctx.config.dbPath) };
    } else if (action === 'checkpoint') {
      const walBefore = admin_file_size(ctx.config.dbPath + '-wal');
      ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      result = { walBefore, walAfter: admin_file_size(ctx.config.dbPath + '-wal') };
    } else if (action === 'prune_login_attempts') {
      const cutoff = Date.now() - 30 * DAY_MS;
      const removed = ctx.db.run('DELETE FROM login_attempts WHERE created_at < ?', cutoff).changes;
      result = { removed, cutoff };
    } else if (action === 'cleanup_orphan_uploads') {
      const cutoff = Date.now() - DAY_MS;
      const orphans = ctx.db.all<{ id: string; path: string }>(
        `SELECT id, path FROM uploads
         WHERE (message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.id = uploads.message_id))
            OR (purpose = 'attachment' AND message_id IS NULL AND created_at < ?)`,
        cutoff,
      );
      let filesRemoved = 0;
      for (const orphan of orphans) {
        if (orphan.path && !orphan.path.includes('..')) {
          const absolute = resolve(ctx.config.uploadDir, orphan.path);
          if (absolute.startsWith(ctx.config.uploadDir + sep) && existsSync(absolute)) {
            try { unlinkSync(absolute); filesRemoved++; } catch { /* file may be locked; the DB row still goes */ }
          }
        }
        ctx.db.run('DELETE FROM uploads WHERE id = ?', orphan.id);
      }
      result = { rowsRemoved: orphans.length, filesRemoved };
    } else {
      throw new ValidationError({ action: 'Expected vacuum, checkpoint, prune_login_attempts or cleanup_orphan_uploads.' });
    }
    admin_audit(ctx, `admin.maintenance.${action}`, 'maintenance', null, null, result);
    return json({ ok: true, action, ...result });
  }, { admin: true });

  router.post('/api/admin/announce', async (ctx) => {
    const body = await readJson(ctx.req);
    const title = text(String(body.title ?? '').trim(), 'title', 1, 100);
    const message = text(String(body.body ?? ''), 'body', 1, 1_000);
    const recipients = ctx.db.all<{ id: string }>('SELECT id FROM users WHERE disabled = 0');
    for (const user of recipients) {
      notify(ctx.db, ctx.hub, { userId: user.id, type: 'system', title, body: message, actorId: ctx.user!.id });
    }
    admin_audit(ctx, 'admin.announce', 'instance', null, null, { title, recipients: recipients.length });
    log.info('admin announcement sent', { recipients: recipients.length });
    return json({ ok: true, count: recipients.length });
  }, { admin: true });

}
