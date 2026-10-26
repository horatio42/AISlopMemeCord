import type { DatabaseWrapper } from '../db';
import { ValidationError } from './validate';

export const THEMES = ['slop', 'corporate', 'deepfried', 'terminal', 'light'] as const;
export type ValidTheme = (typeof THEMES)[number];

export const PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;
export type ValidPresence = (typeof PRESENCE_STATUSES)[number];

export function themeName(v: unknown): ValidTheme {
  const s = String(v ?? '').trim();
  if (!(THEMES as readonly string[]).includes(s)) {
    throw new ValidationError({ theme: `Theme must be one of: ${THEMES.join(', ')}.` });
  }
  return s as ValidTheme;
}

export function presenceStatus(v: unknown): ValidPresence {
  const s = String(v ?? '').trim();
  if (!(PRESENCE_STATUSES as readonly string[]).includes(s)) {
    throw new ValidationError({ status: `Status must be one of: ${PRESENCE_STATUSES.join(', ')}.` });
  }
  return s as ValidPresence;
}

const AVATAR_PREFIX = '/api/media/uploads/';
const UPLOAD_ID_RE = /^upl_[a-z0-9]+$/i;

/**
 * Avatar must be null or the canonical upload URL for an upload owned by the caller
 * with purpose 'avatar'. Never trust arbitrary paths or URLs.
 */
export function avatarUrl(db: DatabaseWrapper, userId: string, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new ValidationError({ avatar: 'Avatar must be an upload URL or null.' });
  const value = v.trim();
  if (value.length > 300) throw new ValidationError({ avatar: 'Avatar URL is too long.' });
  if (!value.startsWith(AVATAR_PREFIX)) {
    throw new ValidationError({ avatar: 'Avatar must be an uploaded image (use the upload endpoint first).' });
  }
  const id = value.slice(AVATAR_PREFIX.length);
  if (!UPLOAD_ID_RE.test(id)) throw new ValidationError({ avatar: 'That avatar is not a valid upload.' });
  const row = db.get<{ id: string }>(
    'SELECT id FROM uploads WHERE id = ? AND owner_id = ? AND purpose = ?',
    id, userId, 'avatar',
  );
  if (!row) throw new ValidationError({ avatar: 'That upload is not yours or was not uploaded as an avatar.' });
  return AVATAR_PREFIX + row.id;
}

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const PRIVATE_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

export interface JwkPublicKey { kty: 'EC'; crv: 'P-256'; x: string; y: string }

/**
 * Validates a public ECDH P-256 JWK. The private key NEVER leaves the client:
 * anything containing private material (d, p, q, ...) is rejected outright.
 */
export function publicJwk(v: unknown): JwkPublicKey | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new ValidationError({ publicKey: 'publicKey must be a JSON string or null.' });
  const text = v.trim();
  if (!text) return null;
  if (text.length > 2000) throw new ValidationError({ publicKey: 'Public key is too long (max 2000 chars).' });
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    throw new ValidationError({ publicKey: 'Public key must be valid JSON (a JWK).' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError({ publicKey: 'Public key must be a JWK object.' });
  }
  const obj = parsed as Record<string, unknown>;
  for (const field of PRIVATE_FIELDS) {
    if (field in obj) throw new ValidationError({ publicKey: 'Private key material is not allowed. The server must never see it.' });
  }
  if (obj.kty !== 'EC') throw new ValidationError({ publicKey: 'Only EC (P-256) public keys are supported.' });
  if (obj.crv !== 'P-256') throw new ValidationError({ publicKey: 'Only the P-256 curve is supported.' });
  for (const coord of ['x', 'y'] as const) {
    const value = obj[coord];
    if (typeof value !== 'string' || !B64URL_RE.test(value)) {
      throw new ValidationError({ publicKey: `JWK ${coord} coordinate must be base64url.` });
    }
    let bytes: number;
    try { bytes = Buffer.from(value, 'base64url').length; } catch { bytes = 0; }
    if (bytes !== 32) throw new ValidationError({ publicKey: `JWK ${coord} coordinate must be 32 bytes.` });
  }
  return { kty: 'EC', crv: 'P-256', x: obj.x as string, y: obj.y as string };
}
