import type { Config } from '../config';
import type { Ctx, SessionRow, UserRow } from '../http';
import { parseCookies, serializeCookie, ApiError } from '../http';
import { sha256 } from '../util/crypto';
import { newId, token as randomToken } from '../util/ids';

export const SESSION_COOKIE = 'slop_session';
export const CSRF_COOKIE = 'slop_csrf';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreatedSession { session: SessionRow; rawToken: string; csrf: string }

export function createSession(ctx: Pick<Ctx, 'db' | 'config' | 'ip' | 'userAgent'>, userId: string): CreatedSession {
  const id = newId('s');
  const rawToken = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  ctx.db.run(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_hash, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, userId, sha256(rawToken), ctx.userAgent.slice(0, 300), sha256(ctx.ip), now, now, now + SESSION_TTL_MS,
  );
  const session = ctx.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id)!;
  return { session, rawToken, csrf };
}

export function authCookie(config: Config, rawToken: string, maxAge = SESSION_TTL_MS / 1000): string {
  return serializeCookie(SESSION_COOKIE, rawToken, { maxAge, secure: config.secureCookies, httpOnly: true, sameSite: 'Lax' });
}
export function csrfCookie(config: Config, csrf: string): string {
  return serializeCookie(CSRF_COOKIE, csrf, { maxAge: SESSION_TTL_MS / 1000, secure: config.secureCookies, httpOnly: false, sameSite: 'Lax' });
}
export function clearAuthCookies(config: Config): string[] {
  return [
    serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }),
    serializeCookie(CSRF_COOKIE, '', { maxAge: 0, secure: config.secureCookies, httpOnly: false }),
  ];
}

export function resolveSession(ctx: Ctx): { user: UserRow; session: SessionRow } | null {
  const cookies = parseCookies(ctx.req.headers.get('cookie'));
  ctx.csrf = cookies[CSRF_COOKIE] ?? '';
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const hash = sha256(raw);
  const session = ctx.db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', hash);
  if (!session) return null;
  const now = Date.now();
  if (session.expires_at <= now) {
    ctx.db.run('DELETE FROM sessions WHERE id = ?', session.id);
    return null;
  }
  const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', session.user_id);
  if (!user || user.disabled) return null;
  if (user.banned_until && user.banned_until > now) return null;
  if (now - session.last_used_at > 5 * 60_000) {
    const newExpiry = now + SESSION_TTL_MS;
    ctx.db.run('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?', now, newExpiry, session.id);
    session.last_used_at = now;
  }
  ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, user.id);
  return { user, session };
}

export function assertCsrf(ctx: Ctx, opts: { required: boolean }) {
  if (!opts.required) return;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.req.method)) return;
  const header = ctx.req.headers.get('x-csrf-token') ?? '';
  const cookies = parseCookies(ctx.req.headers.get('cookie'));
  const cookie = cookies[CSRF_COOKIE] ?? '';
  if (!cookie || !header || cookie !== header) {
    throw new ApiError(403, 'CSRF_FAILED', 'CSRF token mismatch. Nice try, bot.');
  }
}

export function assertOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return;
  try {
    const o = new URL(origin);
    const host = req.headers.get('host');
    if (!host || o.host !== host) throw new ApiError(403, 'ORIGIN_MISMATCH', 'Cross-origin request blocked.');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(403, 'ORIGIN_MISMATCH', 'Invalid origin.');
  }
}

export function sessionResponseHeaders(config: Config, rawToken: string, csrf: string): Headers {
  const h = new Headers();
  h.append('set-cookie', authCookie(config, rawToken));
  h.append('set-cookie', csrfCookie(config, csrf));
  return h;
}
export function cookieHeaders(config: Config, cookies: string[]): Headers {
  const h = new Headers();
  for (const c of cookies) h.append('set-cookie', c);
  return h;
}
