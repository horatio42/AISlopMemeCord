import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createRuntime, type Runtime } from '../src/server/app';
import type { Config } from '../src/server/config';

export interface TestServer {
  runtime: Runtime;
  base: string;
  wsBase: string;
  stop(): void;
}

const servers: TestServer[] = [];

export function startTestServer(overrides: Partial<Config> = {}): TestServer {
  const dataDir = mkdtempSync(join(tmpdir(), 'slop-test-'));
  const runtime = createRuntime({
    dataDir,
    secret: 'test-secret-do-not-use',
    rateLimit: false,
    demoSeed: false,
    registration: 'open',
    staticDir: join(dataDir, 'static'),
    ...overrides,
  });
  const app = createApp(runtime);
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: app.fetch,
    websocket: app.websocket,
    maxRequestBodySize: 26 * 1024 * 1024,
  });
  const base = `http://127.0.0.1:${server.port}`;
  const testServer: TestServer = {
    runtime,
    base,
    wsBase: `ws://127.0.0.1:${server.port}`,
    stop() {
      try { server.stop(true); } catch { /* already stopped */ }
      try { runtime.db.close(); } catch { /* already closed */ }
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
  servers.push(testServer);
  return testServer;
}

export function stopAllServers() {
  for (const s of servers.splice(0)) s.stop();
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export class Client {
  cookies = new Map<string, string>();
  csrf = '';
  userId = '';
  userDisplay = '';
  constructor(public base: string) {}

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(headers: Headers) {
    const raw = typeof (headers as any).getSetCookie === 'function' ? (headers as any).getSetCookie() : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
    for (const line of raw as string[]) {
      const pair = line.split(';')[0]!;
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (!value || /Max-Age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, decodeURIComponent(value));
    }
  }

  async request<T = any>(method: string, path: string, body?: unknown, opts: { form?: FormData; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookies.size) headers['cookie'] = this.cookieHeader();
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(this.base + path, { method, headers, body: payload });
    this.storeCookies(res.headers);
    let parsed: any = null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) parsed = await res.json();
    else if (type.includes('text')) parsed = await res.text();
    else parsed = await res.arrayBuffer();
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get<T = any>(path: string) { return this.request<T>('GET', path); }
  post<T = any>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  patch<T = any>(path: string, body?: unknown) { return this.request<T>('PATCH', path, body); }
  delete<T = any>(path: string, body?: unknown) { return this.request<T>('DELETE', path, body); }
  put<T = any>(path: string, body?: unknown) { return this.request<T>('PUT', path, body); }

  async register(username = 'tester', password = 'password123'): Promise<ApiResponse> {
    const res = await this.post('/api/auth/register', { username, password, displayName: username });
    if (res.status === 200) { this.csrf = res.body.csrfToken; this.userId = res.body.user.id; this.userDisplay = res.body.user.username; }
    return res;
  }
  async login(username = 'tester', password = 'password123'): Promise<ApiResponse> {
    const res = await this.post('/api/auth/login', { username, password });
    if (res.status === 200) { this.csrf = res.body.csrfToken; this.userId = res.body.user.id; this.userDisplay = res.body.user.username; }
    return res;
  }
}

export function newClient(server: TestServer): Client { return new Client(server.base); }

export async function makeUsers(server: TestServer, names: string[]): Promise<Client[]> {
  const out: Client[] = [];
  for (const name of names) {
    const c = newClient(server);
    const res = await c.register(name, 'password123');
    if (res.status !== 200) throw new Error(`register ${name} failed: ${JSON.stringify(res.body)}`);
    out.push(c);
  }
  return out;
}

export async function createTestServerViaApi(client: Client, name = 'Test Slop'): Promise<any> {
  const res = await client.post('/api/servers', { name });
  if (res.status !== 200) throw new Error(`create server failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function waitFor<T = any>(ws: WebSocket, predicate: (data: any) => boolean, timeout = 3000): Promise<T> {
  const buffered = (ws as any).__slopEvents as any[] | undefined;
  if (buffered) {
    const found = buffered.find((data) => { try { return predicate(data); } catch { return false; } });
    if (found) return Promise.resolve(found as T);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('WS timeout')); }, timeout);
    const handler = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data));
        if (predicate(data)) { clearTimeout(timer); ws.removeEventListener('message', handler); resolve(data); }
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', handler);
  });
}

export async function connectWs(client: Client, server: TestServer): Promise<WebSocket> {
  const ws = new WebSocket(server.wsBase + '/api/gateway', { headers: { cookie: client.cookieHeader() } } as any);
  (ws as any).__slopEvents = [];
  ws.addEventListener('message', (ev) => {
    try { (ws as any).__slopEvents.push(JSON.parse(String(ev.data))); if ((ws as any).__slopEvents.length > 200) (ws as any).__slopEvents.shift(); } catch { /* ignore */ }
  });
  await new Promise<void>((resolve, reject) => { ws.addEventListener('open', () => resolve()); ws.addEventListener('error', () => reject(new Error('ws failed'))); });
  return ws;
}
