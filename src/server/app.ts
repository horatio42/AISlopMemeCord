import { join, resolve, extname, normalize } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import type { ServerWebSocket } from 'bun';
import { loadConfig, type Config } from './config';
import { configureLogFile } from './util/log';
import { openDatabase, type DatabaseWrapper } from './db';
import { Router, SECURITY_HEADERS, ApiError, json, clientIp, RateLimiter, type Ctx } from './http';
import { resolveSession, assertCsrf, assertOrigin } from './services/auth';
import { ValidationError } from './util/validate';
import { Hub } from './realtime/hub';
import { register as registerAuth } from './routes/auth';
import { register as registerUsers } from './routes/users';
import { register as registerServers } from './routes/servers';
import { register as registerMembers } from './routes/members';
import { register as registerVoice } from './routes/voice';
import { register as registerMessages } from './routes/messages';
import { register as registerDms } from './routes/dms';
import { register as registerMedia } from './routes/media';
import { register as registerAdmin } from './routes/admin';
import { register as registerMisc } from './routes/misc';
import { handleUpgrade, websocketHandlers } from './routes/gateway';
import { log } from './util/log';

export interface Runtime {
  db: DatabaseWrapper;
  config: Config;
  hub: Hub;
  limiter: RateLimiter;
  router: Router;
  startedAt: number;
}

export function createRuntime(overrides: Partial<Config> = {}): Runtime {
  const config = loadConfig(overrides);
  configureLogFile(join(config.dataDir, 'logs', 'app.log'));
  const db = openDatabase(config);
  const hub = new Hub(db, config);
  const limiter = new RateLimiter(config.rateLimit);
  const router = new Router();
  registerAuth(router);
  registerUsers(router);
  registerServers(router);
  registerMembers(router);
  registerVoice(router);
  registerMessages(router);
  registerDms(router);
  registerMedia(router);
  registerAdmin(router);
  registerMisc(router);
  return { db, config, hub, limiter, router, startedAt: Date.now() };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.zip': 'application/zip', '.pdf': 'application/pdf',
};

function withSecurity(res: Response | undefined): Response {
  if (!res) return new Response(null, { status: 101 });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
}

function serveFile(path: string, cache = false): Response | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    const file = Bun.file(path);
    const etag = `"${file.size}-${file.lastModified}"`;
    return new Response(file, {
      headers: {
        'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
        etag,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch { return null; }
}

function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: e.code, message: e.message, fields: e.fields }, e.status);
  if (e instanceof ValidationError) return json({ error: e.code, message: e.message, fields: e.fields }, e.status);
  log.error('unhandled request error', { error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e) });
  return json({ error: 'INTERNAL_ERROR', message: 'The slop goblin tripped over a cable. Check the server logs.' }, 500);
}

export function createApp(runtime: Runtime) {
  const fetch = async (req: Request, server?: Parameters<typeof handleUpgrade>[1]): Promise<Response | undefined> => {
    const started = performance.now();
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === '/api/gateway') {
        if (!server) return withSecurity(json({ error: 'WEBSOCKET_UNAVAILABLE' }, 500));
        const ip = clientIp(req, runtime.config, server as never);
        const ctx: Ctx = {
          req, url, params: {}, db: runtime.db, config: runtime.config, hub: runtime.hub, ip,
          userAgent: req.headers.get('user-agent') ?? '', user: null, session: null, csrf: '',
        };
        const auth = resolveSession(ctx);
        if (auth) { ctx.user = auth.user; ctx.session = auth.session; }
        const res = await handleUpgrade(ctx, server);
        return res ? withSecurity(res) : undefined;
      }

      if (path === '/' || path === '/index.html' || (!path.startsWith('/api') && !path.startsWith('/static') && !path.startsWith('/admin'))) {
        const index = serveFile(join(runtime.config.staticDir, 'index.html'));
        if (index) return withSecurity(index);
      }
      if (path === '/admin' || path === '/admin/' || (path.startsWith('/admin/') && !path.startsWith('/admin/api'))) {
        const admin = serveFile(join(runtime.config.staticDir, 'admin.html')) ?? serveFile(join(runtime.config.staticDir, 'admin', 'index.html'));
        if (admin) return withSecurity(admin);
      }
      if (path.startsWith('/static/')) {
        const rel = normalize(path.slice('/static/'.length)).replace(/^(\.\.[/\\])+/, '');
        const file = serveFile(join(runtime.config.staticDir, rel), true);
        if (file) return withSecurity(file);
        return withSecurity(new Response('Not found', { status: 404 }));
      }
      // Public fallback so dev screenshots don't explode before a build exists.
      if (!path.startsWith('/api')) {
        const devHtml = '<!doctype html><meta charset="utf-8"><title>AISlopMemeCord</title><body style="font-family:system-ui;background:#14121a;color:#eee;padding:3rem"><h1>No build found</h1><p>Run <code>bun run build</code> or <code>bun run dev</code>. The slop is still compiling.</p></body>';
        return withSecurity(new Response(devHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
      }

      const match = runtime.router.match(req.method, path);
      const ip = clientIp(req, runtime.config, server as never);
      const csrfHeader = req.headers.get('x-csrf-token') ?? '';
      const ctx: Ctx = {
        req, url, params: match?.params ?? {}, db: runtime.db, config: runtime.config, hub: runtime.hub, ip,
        userAgent: req.headers.get('user-agent') ?? '', user: null, session: null, csrf: csrfHeader,
      };
      const auth = resolveSession(ctx);
      if (auth) { ctx.user = auth.user; ctx.session = auth.session; }
      if (!match) return withSecurity(json({ error: 'NOT_FOUND', message: 'No such endpoint. Touch grass?' }, 404));
      const route = match.route;
      const now = Date.now();
      if (!runtime.limiter.check(`global:${ip}`, 60_000, 900)) {
        return withSecurity(json({ error: 'RATE_LIMITED', message: 'Slow down, shitposter.' }, 429, { 'retry-after': '60' }));
      }
      const rl = route.opts.rateLimit;
      if (rl && !runtime.limiter.check(`route:${route.pattern}:${ctx.user?.id ?? ip}`, rl.windowMs, rl.max)) {
        return withSecurity(json({ error: 'RATE_LIMITED', message: 'Slow down, shitposter.' }, 429, { 'retry-after': String(Math.ceil(rl.windowMs / 1000)) }));
      }
      if (route.opts.auth !== false && !ctx.user) return withSecurity(json({ error: 'UNAUTHORIZED', message: 'Log in first, goblin.' }, 401));
      if (route.opts.admin && !ctx.user?.is_admin) return withSecurity(json({ error: 'FORBIDDEN', message: 'Instance admin only. Begone.' }, 403));
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        assertOrigin(req);
        if (ctx.user) assertCsrf(ctx, { required: route.opts.csrf !== false });
      }
      const result = await route.handler(ctx);
      const ms = performance.now() - started;
      if (ms > 500) log.warn('slow request', { method: req.method, path, ms: Math.round(ms) });
      return withSecurity(result);
    } catch (e) {
      log.error('request failed', { path, method: req.method, error: e instanceof Error ? e.message : String(e) });
      return withSecurity(errorResponse(e));
    }
  };
  return { fetch, websocket: websocketHandlers(runtime) };
}

export function startServer(runtime = createRuntime()) {
  const app = createApp(runtime);
  const server = Bun.serve({
    port: runtime.config.port,
    hostname: runtime.config.host,
    fetch: app.fetch,
    websocket: app.websocket,
    maxRequestBodySize: runtime.config.maxUploadBytes + 2 * 1024 * 1024,
    idleTimeout: 60,
  });
  const sweep = setInterval(() => runtime.hub.sweep(), 45_000);
  sweep.unref?.();
  log.info(`AISlopMemeCord listening on http://${runtime.config.host}:${server.port}`);
  return { server, runtime, stop: () => { clearInterval(sweep); server.stop(true); runtime.db.close(); } };
}
