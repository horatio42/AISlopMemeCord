export class ValidationError extends Error {
  status = 400;
  code = 'VALIDATION_ERROR';
  fields: Record<string, string>;
  constructor(fields: Record<string, string> | string, message = 'That input is cooked.') {
    super(message);
    this.fields = typeof fields === 'string' ? { _: fields } : fields;
  }
}

const USERNAME_RE = /^[a-z0-9_.-]{2,32}$/i;
const RESERVED = new Set(['everyone', 'here', 'admin', 'administrator', 'system', 'slopbot', 'discord', 'slop', 'moderator', 'owner']);

export function username(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!USERNAME_RE.test(s)) throw new ValidationError({ username: '2-32 chars: letters, numbers, dot, dash, underscore.' });
  if (RESERVED.has(s.toLowerCase())) throw new ValidationError({ username: 'That username is reserved for the slop overloads.' });
  return s;
}
export function password(v: unknown): string {
  const s = String(v ?? '');
  if (s.length < 8 || s.length > 256) throw new ValidationError({ password: 'Password must be 8-256 characters. Even slop deserves a decent password.' });
  return s;
}
export function displayName(v: unknown, fallback?: string): string {
  const s = String(v ?? fallback ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 32) throw new ValidationError({ displayName: 'Display name must be 1-32 characters.' });
  return s;
}
export function text(v: unknown, field: string, min: number, max: number): string {
  const s = String(v ?? '');
  if (s.length < min) throw new ValidationError({ [field]: `Must be at least ${min} characters.` });
  if (s.length > max) throw new ValidationError({ [field]: `Must be at most ${max} characters.` });
  return s;
}
export function optText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (s.length > max) throw new ValidationError({ [field]: `Must be at most ${max} characters.` });
  return s;
}
export function bool(v: unknown): boolean { return v === true || v === 'true' || v === 1 || v === '1'; }
export function int(v: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw new ValidationError({ [field]: `Must be an integer between ${min} and ${max}.` });
  return n;
}
export function color(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(s) && s !== 'transparent') throw new ValidationError({ color: 'Expected a #rrggbb color.' });
  return s;
}
export function idList(v: unknown, max = 100): string[] {
  if (!Array.isArray(v)) throw new ValidationError({ _: 'Expected an array.' });
  if (v.length > max) throw new ValidationError({ _: `Too many items (max ${max}).` });
  return v.map(String);
}
