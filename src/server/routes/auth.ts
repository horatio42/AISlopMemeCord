import { ApiError, json, readJson, type Handler, type Router, type Ctx } from '../http';
import { username as vUsername, password as vPassword, displayName as vDisplayName, optText, text } from '../util/validate';
import { hashPassword, verifyPassword, sha256 } from '../util/crypto';
import { validateRegistrationMode, getAccountInvite } from '../services/registration';
import {
  createSession, sessionResponseHeaders, clearAuthCookies, cookieHeaders, authCookie, csrfCookie, SESSION_COOKIE, SESSION_TTL_MS,
} from '../services/auth';
import { instanceInfo } from '../services/instance';
import { toUser } from '../repos/users';
import { parseCookies, serializeCookie } from '../http';
import { newId, token } from '../util/ids';
import { randomBytes } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { seedDemoForAdmin } from '../seed';
import { log } from '../util/log';
import { generateSecret, otpauthUri, verifyTotp } from '../services/totp';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

async function authenticate(ctx: Ctx, user: { id: string; username: string }): Promise<Response> {
  const { rawToken, csrf } = createSession(ctx, user.id);
  const row = ctx.db.get<never>('SELECT * FROM users WHERE id = ?', user.id) as never;
  const headers = sessionResponseHeaders(ctx.config, rawToken, csrf);
  return json({ user: toUser(row), csrfToken: csrf, instance: instanceInfo(ctx.db, ctx.hub, ctx.config.registration, ctx.config.version) }, 200, headers);
}

export function register(router: Router) {
  router.post('/api/auth/register', async (ctx) => {
    const body = await readJson(ctx.req);
    const uname = vUsername(body.username);
    const pass = vPassword(body.password);
    const dn = vDisplayName(body.displayName ?? body.username);
    const existing = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', uname);
    if (existing) throw new ApiError(409, 'USERNAME_TAKEN', 'That username has already been consumed by another slop goblin.');
    const inviteCode = typeof body.accountInvite === 'string' ? body.accountInvite : '';
    const gate = validateRegistrationMode(ctx.db, ctx.config.registration, inviteCode);
    if (!gate.ok) throw new ApiError(403, 'REGISTRATION_CLOSED', gate.message);
    const userCount = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
    if (userCount === 0 && gate.mode !== 'open') {
      // Fresh instance bootstrap always works for the first user.
    }
    const hash = await hashPassword(pass);
    const id = newId('u');
    const now = Date.now();
    try {
      ctx.db.transaction(() => {
        ctx.db.run(
          `INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id, uname, dn, hash, userCount === 0 ? 1 : 0, now, now,
        );
        if (userCount === 0) {
          ctx.db.run("INSERT INTO achievements (user_id, key, earned_at) VALUES (?, 'founder', ?)", id, now);
        }
        gate.inviteCode && ctx.db.run('UPDATE account_invites SET uses = uses + 1 WHERE code = ?', gate.inviteCode);
      });
    } catch (e) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'Username collision. The entropy goblin is drunk.');
    }
    if (userCount === 0 && ctx.config.demoSeed) {
      try { seedDemoForAdmin(ctx.db, id); } catch (e) { log.error('demo seed failed', { error: e instanceof Error ? e.message : String(e) }); }
    }
    const row = ctx.db.get('SELECT * FROM users WHERE id = ?', id) as never;
    return authenticate(ctx, row);
  }, { auth: false, csrf: false, rateLimit: { windowMs: 60_000, max: 5 } });

  router.post('/api/auth/login', async (ctx) => {
    const body = await readJson(ctx.req);
    const uname = String(body.username ?? '').trim().slice(0, 64);
    const pass = String(body.password ?? '');
    const ipHash = sha256(ctx.ip);
    const failures = ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND success = 0 AND created_at > ?`,
      ipHash, Date.now() - 15 * 60_000,
    )?.n ?? 0;
    if (failures >= 10) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed logins. Go touch grass for 15 minutes.');
    const row = ctx.db.get<import('../http').UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE', uname);
    const valid = row ? await verifyPassword(pass, row.password_hash) : false;
    ctx.db.run('INSERT INTO login_attempts (ip_hash, username, success, created_at) VALUES (?, ?, ?, ?)', ipHash, uname, valid ? 1 : 0, Date.now());
    if (!row || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong username or password. Nice try, fed.');
    if (row.disabled) throw new ApiError(403, 'ACCOUNT_DISABLED', 'This account has been yeeted by an administrator.');
    if (row.banned_until && row.banned_until > Date.now()) throw new ApiError(403, 'ACCOUNT_SUSPENDED', `Suspended until ${new Date(row.banned_until).toISOString()}.`);
    if (row.totp_secret) {
      const code = String(body.totp ?? '').trim();
      if (!verifyTotp(row.totp_secret, code)) throw new ApiError(401, 'TOTP_REQUIRED', 'Two-factor code required or incorrect.');
    }
    ctx.db.run('DELETE FROM login_attempts WHERE created_at < ?', Date.now() - 30 * 24 * 60 * 60_000);
    return authenticate(ctx, row);
  }, { auth: false, csrf: false, rateLimit: { windowMs: 60_000, max: 20 } });

  router.get('/api/auth/me', (ctx) => {
    if (!ctx.user) {
      return json({ user: null, csrfToken: null, instance: instanceInfo(ctx.db, ctx.hub, ctx.config.registration, ctx.config.version) });
    }
    let csrf = ctx.csrf;
    const headers = new Headers();
    if (!csrf) {
      csrf = token(24);
      headers.append('set-cookie', csrfCookie(ctx.config, csrf));
    }
    return json({
      user: toUser(ctx.user),
      csrfToken: csrf,
      instance: instanceInfo(ctx.db, ctx.hub, ctx.config.registration, ctx.config.version),
    }, 200, headers);
  }, { auth: false });

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.session) ctx.db.run('DELETE FROM sessions WHERE id = ?', ctx.session.id);
    return json({ ok: true }, 200, cookieHeaders(ctx.config, clearAuthCookies(ctx.config)));
  });

  router.post('/api/auth/password', async (ctx) => {
    const body = await readJson(ctx.req);
    const current = String(body.currentPassword ?? '');
    const next = vPassword(body.newPassword);
    if (!(await verifyPassword(current, ctx.user!.password_hash))) throw new ApiError(401, 'WRONG_PASSWORD', 'Current password is incorrect.');
    const hash = await hashPassword(next);
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, ctx.user!.id);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', ctx.user!.id, ctx.session!.id);
    return json({ ok: true });
  }, { rateLimit: { windowMs: 60_000, max: 5 } });

  router.get('/api/auth/sessions', (ctx) => {
    const rows = ctx.db.all<{ id: string; user_agent: string | null; created_at: number; last_used_at: number }>(
      'SELECT id, user_agent, created_at, last_used_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC',
      ctx.user!.id, Date.now(),
    );
    return json({ sessions: rows.map((r) => ({ id: r.id, current: r.id === ctx.session!.id, userAgent: r.user_agent, createdAt: r.created_at, lastUsedAt: r.last_used_at })) });
  });

  router.delete('/api/auth/sessions/:id', (ctx) => {
    ctx.db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', ctx.params.id, ctx.user!.id);
    return json({ ok: true });
  });

  router.post('/api/auth/sessions/revoke-all', (ctx) => {
    ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', ctx.user!.id, ctx.session!.id);
    return json({ ok: true });
  });

  router.post('/api/auth/export', async (ctx) => {
    const body: Record<string, unknown> = await readJson(ctx.req).catch(() => ({}));
    if (body.password !== undefined) {
      if (!(await verifyPassword(String(body.password), ctx.user!.password_hash))) throw new ApiError(401, 'WRONG_PASSWORD', 'Password required to export your data.');
    }
    const uid = ctx.user!.id;
    const profile = ctx.db.get('SELECT id, username, display_name, avatar, bio, pronouns, status, badges, karma, theme, created_at FROM users WHERE id = ?', uid);
    const sessions = ctx.db.all('SELECT id, user_agent, created_at, last_used_at FROM sessions WHERE user_id = ?', uid);
    const messages = ctx.db.all<{ id: string; channel_id: string; content: string; created_at: number; server_id: string | null }>(
      'SELECT id, channel_id, content, created_at, server_id FROM messages WHERE author_id = ? AND deleted_at IS NULL ORDER BY created_at', uid,
    );
    const servers = ctx.db.all('SELECT s.id, s.name, m.joined_at FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ?', uid);
    const friends = ctx.db.all(
      `SELECT f.status, f.created_at, u.username, u.display_name FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.requester_id = ? OR f.addressee_id = ?`, uid, uid, uid,
    );
    const dms = ctx.db.all(
      'SELECT c.id, c.name, c.type, dm.joined_at FROM dm_members dm JOIN channels c ON c.id = dm.channel_id WHERE dm.user_id = ?', uid,
    );
    const manifest = { exportedAt: Date.now(), format: 'aislopmemecord/v1', notice: 'This export contains your data. No telemetry, no cloud, no goblins.' };
    const files: Record<string, Uint8Array> = {
      'README.txt': strToU8('AISlopMemeCord personal data export.\nEverything is plain JSON for maximum portability and minimum corporate energy.\n'),
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      'profile.json': strToU8(JSON.stringify(profile, null, 2)),
      'sessions.json': strToU8(JSON.stringify(sessions, null, 2)),
      'messages.json': strToU8(JSON.stringify(messages, null, 2)),
      'servers.json': strToU8(JSON.stringify(servers, null, 2)),
      'friends.json': strToU8(JSON.stringify(friends, null, 2)),
      'dms.json': strToU8(JSON.stringify(dms, null, 2)),
    };
    const uploads = ctx.db.all<{ id: string; filename: string; path: string }>('SELECT id, filename, path FROM uploads WHERE owner_id = ?', uid);
    for (const u of uploads.slice(0, 200)) {
      const p = join(ctx.config.uploadDir, u.path);
      if (existsSync(p)) files[`uploads/${u.filename.replace(/[^\w.\-]/g, '_')}-${u.id}`] = new Uint8Array(readFileSync(p));
    }
    const zipped = zipSync(files, { level: 6 });
    return new Response(zipped, { status: 200, headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="aislopmemecord-export-${ctx.user!.username}.zip"`,
      'cache-control': 'no-store',
    } });
  }, { rateLimit: { windowMs: 60_000, max: 2 } });

  router.post('/api/auth/delete', async (ctx) => {
    const body = await readJson(ctx.req);
    if (!(await verifyPassword(String(body.password ?? ''), ctx.user!.password_hash))) throw new ApiError(401, 'WRONG_PASSWORD', 'Password required to delete account.');
    if (ctx.user!.is_admin) {
      const admins = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0')?.n ?? 0;
      if (admins <= 1) throw new ApiError(400, 'LAST_ADMIN', 'You are the last instance admin. Promote someone else first.');
    }
    ctx.db.transaction(() => {
      ctx.db.run('DELETE FROM sessions WHERE user_id = ?', ctx.user!.id);
      // Foreign keys cascade owned servers, memberships, messages, uploads, reactions etc.
      ctx.db.run('DELETE FROM users WHERE id = ?', ctx.user!.id);
    });
    return json({ ok: true, deleted: true }, 200, cookieHeaders(ctx.config, clearAuthCookies(ctx.config)));
  });

  router.post('/api/auth/2fa/setup', (ctx) => {
    if (ctx.user!.totp_secret) throw new ApiError(400, 'TOTP_ALREADY_ENABLED', 'Two-factor is already enabled.');
    const secret = generateSecret();
    ctx.db.run('UPDATE users SET flags = json_set(flags, \'$.pendingTotp\', ?) WHERE id = ?', secret, ctx.user!.id);
    return json({ secret, uri: otpauthUri(secret, ctx.user!.username) });
  });

  router.post('/api/auth/2fa/enable', async (ctx) => {
    const body = await readJson(ctx.req);
    const pending = JSON.parse(ctx.user!.flags || '{}').pendingTotp as string | undefined;
    if (!pending) throw new ApiError(400, 'NO_PENDING_TOTP', 'Start 2FA setup first.');
    if (!verifyTotp(pending, String(body.code ?? ''))) throw new ApiError(400, 'INVALID_CODE', 'That code is expired or incorrect.');
    ctx.db.run('UPDATE users SET totp_secret = ?, flags = json_set(flags, \'$.pendingTotp\', json(\'null\')) WHERE id = ?', pending, ctx.user!.id);
    return json({ ok: true });
  });

  router.post('/api/auth/2fa/disable', async (ctx) => {
    const body = await readJson(ctx.req);
    if (!(await verifyPassword(String(body.password ?? ''), ctx.user!.password_hash))) throw new ApiError(401, 'WRONG_PASSWORD', 'Password required.');
    ctx.db.run("UPDATE users SET totp_secret = NULL, flags = json_set(flags, '$.pendingTotp', json('null')) WHERE id = ?", ctx.user!.id);
    return json({ ok: true });
  });

  router.get('/api/instance', (ctx) => json(instanceInfo(ctx.db, ctx.hub, ctx.config.registration, ctx.config.version)), { auth: false });
}
