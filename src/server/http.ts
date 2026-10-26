import type { DatabaseWrapper } from './db';
import type { Config } from './config';
import type { Hub } from './realtime/hub';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
  ) { super(message); }
}

export interface UserRow {
  id: string; username: string; display_name: string; password_hash: string; avatar: string | null;
  banner_color: string | null; bio: string | null; pronouns: string | null; status: string;
  custom_status: string | null; is_admin: number; is_bot: number; disabled: number; banned_until: number | null;
  ban_reason: string | null; badges: string; karma: number; theme: string; totp_secret: string | null;
  public_key: string | null; flags: string; settings: string; created_at: number; last_seen_at: number;
}
export interface SessionRow {
  id: string; user_id: string; token_hash: string; user_agent: string | null; ip_hash: string | null;
  is_admin_session: number; created_at: number; last_used_at: number; expires_at: number;
}

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  db: DatabaseWrapper;
  config: Config;
  hub: Hub;
  ip: string;
  userAgent: string;
  user: UserRow | null;
  session: SessionRow | null;
  csrf: string;
}

export type Handler = (ctx: Ctx) => Response | Promise<Response>;

export interface RouteOptions {
  auth?: boolean;
  admin?: boolean;
  csrf?: boolean;
  rateLimit?: { windowMs: number; max: number; scope?: string };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface CompiledRoute {
  method: Method;
  parts: string[];
  handler: Handler;
  opts: RouteOptions;
  pattern: string;
}

export class Router {
  private routes: CompiledRoute[] = [];
  add(method: Method, pattern: string, handler: Handler, opts: RouteOptions = {}) {
    this.routes.push({ method, pattern, handler, opts, parts: pattern.split('/').filter(Boolean) });
    return this;
  }
  get(pattern: string, h: Handler, o?: RouteOptions) { return this.add('GET', pattern, h, o); }
  post(pattern: string, h: Handler, o?: RouteOptions) { return this.add('POST', pattern, h, o); }
  patch(pattern: string, h: Handler, o?: RouteOptions) { return this.add('PATCH', pattern, h, o); }
  put(pattern: string, h: Handler, o?: RouteOptions) { return this.add('PUT', pattern, h, o); }
  delete(pattern: string, h: Handler, o?: RouteOptions) { return this.add('DELETE', pattern, h, o); }

  match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | null {
    if (method === 'HEAD') method = 'GET';
    const parts = path.split('/').filter(Boolean);
    const candidates: { route: CompiledRoute; params: Record<string, string>; score: number }[] = [];
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.parts.length !== parts.length) continue;
      let ok = true, score = 0;
      const params: Record<string, string> = {};
      for (let i = 0; i < parts.length; i++) {
        const rp = route.parts[i]!, actual = parts[i]!;
        if (rp.startsWith(':')) { params[rp.slice(1)] = decodeURIComponent(actual); }
        else if (rp === '*') { score -= 1; }
        else if (rp === actual) { score += 2; }
        else { ok = false; break; }
      }
      if (ok) candidates.push({ route, params, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers: h });
}
export function noContent(): Response { return new Response(null, { status: 204 }); }

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json, you monster.');
  const text = await req.text();
  if (text.length > 2_000_000) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body too large.');
  if (!text) return {};
  try {
    const val = JSON.parse(text);
    if (!val || typeof val !== 'object' || Array.isArray(val)) throw new Error('not an object');
    return val as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Body is not valid JSON. Skill issue.');
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function clientIp(req: Request, config: Config, server?: { requestIP(req: Request): { address: string } | null }): string {
  if (config.trustProxy) {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0]!.trim();
  }
  try { return server?.requestIP(req)?.address ?? '0.0.0.0'; } catch { return '0.0.0.0'; }
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private enabled: boolean) {}
  check(key: string, windowMs: number, max: number): boolean {
    if (!this.enabled) return true;
    const now = Date.now();
    if (this.buckets.size > 20_000) this.sweep(now);
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) { this.buckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
    b.count++;
    return b.count <= max;
  }
  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};
