import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
let counter = 0;
let lastMs = 0;

function b36(n: number, len?: number): string {
  let s = '';
  let v = Math.max(0, Math.floor(n));
  do { s = ALPHABET[v % 36] + s; v = Math.floor(v / 36); } while (v > 0);
  return len ? s.padStart(len, '0') : s;
}

/** Lexicographically sortable IDs. Prefix helps humans debug; timestamp keeps ordering. */
export function newId(prefix: string): string {
  const now = Date.now();
  if (now === lastMs) counter = (counter + 1) % 1296;
  else { lastMs = now; counter = 0; }
  const rand = randomBytes(4).toString('hex').slice(0, 6);
  return `${prefix}_${b36(now, 9)}${b36(counter, 2)}${rand}`;
}

export function token(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function shortCode(len = 8): string {
  let out = '';
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % 36];
  return out;
}

export function snowflakeTime(id: string): number {
  const part = id.split('_')[1]?.slice(0, 9) ?? '';
  return parseInt(part, 36) || 0;
}
