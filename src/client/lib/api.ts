let csrfToken = '';
let unauthorizedHandler: (() => void) | null = null;

export function setCsrfToken(token: string | null | undefined) { csrfToken = token ?? ''; }
export function getCsrfToken() { return csrfToken; }
export function onUnauthorized(fn: () => void) { unauthorizedHandler = fn; }

export class HttpError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface RequestOptions { signal?: AbortSignal; raw?: boolean; }

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (csrfToken && !['GET', 'HEAD'].includes(method)) headers['x-csrf-token'] = csrfToken;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
    unauthorizedHandler?.();
  }
  if (!res.ok) {
    let err: any = null;
    try { err = await res.json(); } catch { /* ignore */ }
    throw new HttpError(res.status, err?.error ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.fields);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  if (opts.raw) return res as unknown as T;
  if (type.includes('application/json')) return (await res.json()) as T;
  if (type.includes('text/')) return (await res.text()) as T;
  return (await res.blob()) as T;
}

export const api = {
  get: <T = any>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T = any>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T = any>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body, opts),
  patch: <T = any>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  del: <T = any>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('DELETE', path, body, opts),
};

export async function uploadFile(file: File, purpose: string): Promise<{ id: string; url: string; filename: string; contentType: string; size: number; width: number | null; height: number | null }> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  const res = await api.post<{ upload: { id: string; url: string; filename: string; contentType: string; size: number; width: number | null; height: number | null } }>('/api/uploads', form);
  return res.upload;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong. The slop goblin is on break.';
}

export function downloadUrl(path: string, filename?: string) {
  const a = document.createElement('a');
  a.href = path;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
