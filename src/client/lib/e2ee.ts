import { api } from './api';

/** Client-side E2EE for 1:1 DMs. Private keys never leave localStorage. */
export interface PublicJwk { kty: 'EC'; crv: 'P-256'; x: string; y: string }

const keyName = (userId: string) => `slop-e2ee-private-${userId}`;

export async function ensureE2EEKeys(userId: string, existingPublicKey?: string | null): Promise<PublicJwk | null> {
  try {
    let priv = localStorage.getItem(keyName(userId));
    let publicJwk: PublicJwk;
    if (priv) {
      const jwk = JSON.parse(priv);
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
      const exported = await crypto.subtle.exportKey('jwk', key);
      publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x!, y: exported.y! };
    } else {
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
      const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
      const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
      localStorage.setItem(keyName(userId), JSON.stringify(privJwk));
      publicJwk = { kty: 'EC', crv: 'P-256', x: pubJwk.x!, y: pubJwk.y! };
    }
    const serialized = JSON.stringify(publicJwk);
    if (existingPublicKey !== serialized) {
      await api.post('/api/users/@me/keys', { publicKey: serialized });
    }
    return publicJwk;
  } catch (e) {
    console.warn('E2EE key setup failed', e);
    return null;
  }
}

export function hasLocalPrivateKey(userId: string): boolean { return !!localStorage.getItem(keyName(userId)); }

export function exportPrivateKey(userId: string): string | null { return localStorage.getItem(keyName(userId)); }

export function importPrivateKey(userId: string, jwk: string): void {
  const parsed = JSON.parse(jwk);
  if (parsed.kty !== 'EC' || parsed.crv !== 'P-256' || !parsed.d) throw new Error('That is not a P-256 private JWK.');
  localStorage.setItem(keyName(userId), JSON.stringify(parsed));
}

async function deriveKey(userId: string, peerPublicKey: string): Promise<CryptoKey> {
  const privRaw = localStorage.getItem(keyName(userId));
  if (!privRaw) throw new Error('No local private key on this device.');
  const privJwk = JSON.parse(privRaw);
  const pubJwk = JSON.parse(peerPublicKey);
  if (!pubJwk.x || !pubJwk.y || pubJwk.d) throw new Error('Invalid peer public key.');
  const privateKey = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const publicKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: publicKey }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function toB64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptMessage(userId: string, plaintext: string, peerPublicKey: string): Promise<{ content: string; cryptoMeta: string }> {
  const key = await deriveKey(userId, peerPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return {
    content: toB64(ct),
    cryptoMeta: JSON.stringify({ v: 1, alg: 'A256GCM', iv: toB64(iv.buffer) }),
  };
}

export async function decryptMessage(userId: string, content: string, cryptoMeta: string | null, peerPublicKey: string): Promise<string> {
  if (!cryptoMeta) throw new Error('Message has no crypto metadata.');
  const meta = JSON.parse(cryptoMeta);
  if (meta.v !== 1 || !meta.iv) throw new Error('Unknown ciphertext format.');
  const key = await deriveKey(userId, peerPublicKey);
  const ivBytes = fromB64(meta.iv);
  const ctBytes = fromB64(content);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes as unknown as BufferSource }, key, ctBytes as unknown as BufferSource);
  return new TextDecoder().decode(plain);
}
