import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { ApiError, type Ctx } from '../http';
import { ValidationError } from '../util/validate';
import { newId } from '../util/ids';
import { channelForUser } from './permissions';

export interface UploadRow {
  id: string;
  owner_id: string;
  purpose: string;
  filename: string;
  content_type: string;
  size: number;
  path: string;
  sha256: string;
  width: number | null;
  height: number | null;
  message_id: string | null;
  created_at: number;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  path: string;
  width: number | null;
  height: number | null;
  spoiler: number;
  alt: string | null;
  sha256: string;
  created_at: number;
}

export interface UploadDto {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  purpose: string;
}

const MB = 1024 * 1024;

export const PURPOSES = [
  'attachment', 'avatar', 'webhook_avatar', 'server_icon', 'server_banner',
  'banner', 'emoji', 'sticker', 'sound', 'event_cover', 'admin',
] as const;
export type Purpose = (typeof PURPOSES)[number];

const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'log', 'yml', 'yaml']);

const PURPOSE_RULES: Record<Purpose, { limit: number; kinds: Set<Detected['kind']>; svg: boolean }> = {
  attachment: { limit: Infinity, kinds: new Set(['image', 'audio', 'video', 'text', 'pdf', 'zip']), svg: false },
  admin: { limit: Infinity, kinds: new Set(['image', 'audio', 'video', 'text', 'pdf', 'zip']), svg: false },
  avatar: { limit: 2 * MB, kinds: new Set(['image']), svg: false },
  webhook_avatar: { limit: 2 * MB, kinds: new Set(['image']), svg: false },
  server_icon: { limit: 2 * MB, kinds: new Set(['image']), svg: false },
  emoji: { limit: 2 * MB, kinds: new Set(['image']), svg: true },
  sticker: { limit: 2 * MB, kinds: new Set(['image']), svg: false },
  banner: { limit: 5 * MB, kinds: new Set(['image']), svg: false },
  server_banner: { limit: 5 * MB, kinds: new Set(['image']), svg: false },
  event_cover: { limit: 5 * MB, kinds: new Set(['image']), svg: false },
  sound: { limit: 8 * MB, kinds: new Set(['audio']), svg: false },
};

/** Purposes that any authenticated user may view (never admin). */
const PUBLIC_PURPOSES: Record<string, true> = {
  avatar: true, webhook_avatar: true, banner: true, server_icon: true, server_banner: true,
  emoji: true, sticker: true, sound: true, event_cover: true,
};

export function isPurpose(v: unknown): v is Purpose {
  return typeof v === 'string' && (PURPOSES as readonly string[]).includes(v);
}

export interface Detected {
  kind: 'image' | 'audio' | 'video' | 'text' | 'pdf' | 'zip';
  ext: string;
  mime: string;
  width: number | null;
  height: number | null;
  data: Uint8Array;
}

function fail(message: string, field = 'file', status = 400, code = 'INVALID_FILE'): never {
  if (status === 413) throw new ApiError(413, code, message);
  throw new ValidationError({ [field]: message });
}

function u16be(b: Uint8Array, o: number): number { return (b[o]! << 8) | b[o + 1]!; }
function u32be(b: Uint8Array, o: number): number { return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0; }
function u16le(b: Uint8Array, o: number): number { return b[o]! | (b[o + 1]! << 8); }
function u32le(b: Uint8Array, o: number): number { return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0; }
function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]!);
  return s;
}
function startsWith(b: Uint8Array, sig: number[]): boolean {
  if (b.length < sig.length) return false;
  return sig.every((v, i) => b[i] === v);
}

function jpegSize(b: Uint8Array): { width: number | null; height: number | null } {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const marker = b[o + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
    const len = u16be(b, o + 2);
    if (len < 2) return { width: null, height: null };
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: u16be(b, o + 7), height: u16be(b, o + 5) };
    }
    o += 2 + len;
  }
  return { width: null, height: null };
}

function webpSize(b: Uint8Array): { width: number | null; height: number | null } {
  if (b.length < 30) return { width: null, height: null };
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  if (chunk === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return { width: null, height: null };
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const b0 = b[21]!, b1 = b[22]!, b2 = b[23]!, b3 = b[24]!;
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  return { width: null, height: null };
}

function imageInfo(b: Uint8Array): (Detected & { kind: 'image' }) | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (b.length < 24) return null;
    return { kind: 'image', ext: 'png', mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20), data: b };
  }
  if (startsWith(b, [0xff, 0xd8, 0xff])) {
    const { width, height } = jpegSize(b);
    return { kind: 'image', ext: 'jpg', mime: 'image/jpeg', width, height, data: b };
  }
  const head = ascii(b, 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') {
    if (b.length < 10) return null;
    return { kind: 'image', ext: 'gif', mime: 'image/gif', width: u16le(b, 6), height: u16le(b, 8), data: b };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const { width, height } = webpSize(b);
    return { kind: 'image', ext: 'webp', mime: 'image/webp', width, height, data: b };
  }
  return null;
}

const ACTIVE_SVG = /<script\b|<foreignObject\b|\son[a-z]+\s*=|<set\b|javascript:|<!ENTITY|<\?xml-stylesheet/i;

/**
 * Emoji SVGs are the only place SVG is accepted. Active content (scripts, event handlers,
 * foreignObject, timeline manipulation, javascript: URLs, entities, external stylesheets)
 * makes the whole file unsafe -> reject. Passive hazards (doctype, external href/src/style
 * urls, embedded iframes/objects) are stripped; if the result is no longer an SVG -> reject.
 */
export function sanitizeSvg(input: string): string {
  if (ACTIVE_SVG.test(input)) fail('That SVG contains active content. Emoji should sparkle, not execute code.');
  let s = input
    .replace(/^\uFEFF/, '')
    .replace(/<!DOCTYPE[^>[]*(?:\[[\s\S]*?\]\s*)?>/gi, '')
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  s = s
    .replace(/<(script|foreignObject|iframe|object|embed|link|meta|base|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|link|meta|base|style)\b[^>]*\/?>/gi, '');
  s = s.replace(/\s(?:xlink:href|href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m0, raw) => {
    const value = String(raw).replace(/^["']|["']$/g, '').trim();
    const unsafe = /^(?:https?:|\/\/|javascript:|data:text\/html|data:image\/svg)/i.test(value) || value.includes('&') || /[\u0000-\u001f]/.test(value);
    return unsafe ? '' : m0;
  });
  s = s.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m0, raw) => {
    const value = String(raw).replace(/^["']|["']$/g, '');
    return /url\s*\(|expression\s*\(|@import/i.test(value) ? '' : m0;
  });
  s = s.replace(/\s(?:on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/url\(\s*['"]?(?:https?:|\/\/)[^)]*\)/gi, 'none');
  if (!/<svg[\s>]/i.test(s) || !/<\/svg\s*>/i.test(s)) fail('That SVG is not a real SVG. Impersonating an emoji is a crime.');
  return s;
}

function sniffText(b: Uint8Array, extHint: string): Detected | null {
  if (!TEXT_EXT.has(extHint) && extHint !== '') return null;
  for (const byte of b) {
    if (byte === 0) return null;
  }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
  if (/<script\b|<html\b|<!doctype\s+html|<\?php/i.test(text)) {
    fail('Text uploads that are secretly HTML/JS are not welcome here.');
  }
  if (extHint === 'json') {
    try { JSON.parse(text); } catch { fail('That .json attachment is not valid JSON.'); }
  }
  const mime = extHint === 'md' ? 'text/markdown; charset=utf-8'
    : extHint === 'csv' ? 'text/csv; charset=utf-8'
    : extHint === 'json' ? 'application/json'
    : 'text/plain; charset=utf-8';
  return { kind: 'text', ext: extHint || 'txt', mime, width: null, height: null, data: b };
}

/** Detect a file from bytes only; the client content-type is never consulted. */
export function sniffFile(bytes: Uint8Array, filenameHint: string, purpose: Purpose): Detected {
  const extHint = extname(filenameHint).slice(1).toLowerCase();
  const img = imageInfo(bytes);
  if (img) {
    if (extHint === 'svg') fail('A .svg file that is actually a raster image is confused. Pick one identity.');
    return img;
  }
  if (extHint === 'svg' || /<svg[\s>]/i.test(ascii(bytes, 0, Math.min(bytes.length, 512)))) {
    if (!PURPOSE_RULES[purpose].svg) fail('SVG is only allowed for custom emoji. Everything else stays raster.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('SVG must be valid UTF-8.'); }
    if (!/<svg[\s>]/i.test(text)) fail('That file claims to be SVG but has no <svg> root.');
    const clean = sanitizeSvg(text);
    return { kind: 'image', ext: 'svg', mime: 'image/svg+xml', width: null, height: null, data: new TextEncoder().encode(clean) };
  }
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0)) {
    return { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg', width: null, height: null, data: bytes };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    return { kind: 'audio', ext: 'wav', mime: 'audio/wav', width: null, height: null, data: bytes };
  }
  if (ascii(bytes, 0, 4) === 'OggS') {
    return { kind: 'audio', ext: 'ogg', mime: 'audio/ogg', width: null, height: null, data: bytes };
  }
  if (bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) {
    return { kind: 'audio', ext: 'aac', mime: 'audio/aac', width: null, height: null, data: bytes };
  }
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const major = ascii(bytes, 8, 4).toLowerCase();
    const boxSize = Math.min(u32be(bytes, 0) || bytes.length, bytes.length, 512);
    let audio = major === 'm4a ' || major === 'm4b ';
    for (let o = 16; !audio && o + 4 <= boxSize; o += 4) {
      const compatible = ascii(bytes, o, 4).toLowerCase();
      if (compatible === 'm4a ' || compatible === 'm4b ' || compatible === 'mp4a') audio = true;
    }
    if (audio) return { kind: 'audio', ext: 'm4a', mime: 'audio/mp4', width: null, height: null, data: bytes };
    return { kind: 'video', ext: 'mp4', mime: 'video/mp4', width: null, height: null, data: bytes };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'video', ext: 'webm', mime: 'video/webm', width: null, height: null, data: bytes };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') {
    return { kind: 'pdf', ext: 'pdf', mime: 'application/pdf', width: null, height: null, data: bytes };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) {
    return { kind: 'zip', ext: 'zip', mime: 'application/zip', width: null, height: null, data: bytes };
  }
  const text = sniffText(bytes, extHint);
  if (text) return text;
  fail('Unrecognized file. Magic bytes said "no thanks".');
}

function cleanFilename(raw: string, fallbackExt: string): string {
  let name = basename(String(raw ?? '').trim()).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  if (!name || name === '.' || name === '..') name = `upload.${fallbackExt}`;
  if (name.length > 120) {
    const ext = extname(name).slice(0, 12);
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name;
}

export function uploadDto(row: UploadRow): UploadDto {
  return {
    id: row.id,
    url: `/api/media/uploads/${row.id}`,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    width: row.width,
    height: row.height,
    purpose: row.purpose,
  };
}

/** Validate + persist an uploaded File. The only writer of uploadDir. */
export async function saveUpload(ctx: Ctx, file: File, rawPurpose: unknown): Promise<UploadDto> {
  if (!isPurpose(rawPurpose)) throw new ValidationError({ purpose: 'Pick a real purpose: ' + PURPOSES.join(', ') });
  const purpose = rawPurpose;
  if (purpose === 'admin' && !ctx.user!.is_admin) throw new ApiError(403, 'FORBIDDEN', 'Admin uploads are for instance admins only. Hierarchy is real.');
  const rule = PURPOSE_RULES[purpose];
  const limit = purpose === 'attachment' || purpose === 'admin' ? ctx.config.maxUploadBytes : rule.limit;
  if (file.size <= 0) throw new ValidationError({ file: 'Upload a file with actual bytes, not vibes.' });
  if (file.size > limit) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `That file is ${Math.ceil(file.size / 1024)}KB; the limit for ${purpose} is ${Math.ceil(limit / 1024)}KB. Compression is self-care.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > limit) throw new ApiError(413, 'FILE_TOO_LARGE', 'The file grew after we measured it. Nice try, chonker.');
  const filename = cleanFilename(file.name, 'bin');
  const detected = sniffFile(bytes, filename, purpose);
  if (!rule.kinds.has(detected.kind)) {
    throw new ValidationError({ file: `${purpose} does not accept ${detected.kind} files. The bouncer said no.` });
  }
  const sha256 = createHash('sha256').update(detected.data).digest('hex');
  const id = newId('upl');
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const relPath = `${now.getUTCFullYear()}/${month}/${id}.${detected.ext}`;
  const abs = safeMediaPath(ctx.config, relPath);
  mkdirSync(join(abs, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(abs, detected.data, { mode: 0o600 });
  try {
    ctx.db.run(
      `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ctx.user!.id, purpose, filename, detected.mime, detected.data.byteLength, relPath, sha256,
      detected.width, detected.height, Date.now(),
    );
  } catch (e) {
    try { unlinkSync(abs); } catch { /* best effort */ }
    throw e;
  }
  const row = ctx.db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', id)!;
  return uploadDto(row);
}

/** Resolve a stored relative path under uploadDir; absolute paths and traversal are refused. */
export function safeMediaPath(config: Ctx['config'], storedPath: string): string {
  if (!storedPath || storedPath.includes('\0')) throw new ApiError(404, 'NOT_FOUND', 'That file is not here.');
  const root = resolve(config.uploadDir);
  const abs = resolve(root, storedPath);
  const rel = relative(root, abs);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(abs) !== abs) {
    throw new ApiError(404, 'NOT_FOUND', 'Nice path traversal attempt. The goblin guards stay up.');
  }
  return abs;
}

export function isPublicPurpose(purpose: string): boolean {
  return PUBLIC_PURPOSES[purpose] === true;
}

export function assertMessageVisible(ctx: Ctx, messageId: string): void {
  const message = ctx.db.get<{ id: string; channel_id: string; deleted_at: number | null }>(
    'SELECT id, channel_id, deleted_at FROM messages WHERE id = ?', messageId,
  );
  if (!message || message.deleted_at) throw new ApiError(404, 'NOT_FOUND', 'That message is gone. Attachment went with it.');
  channelForUser(ctx, message.channel_id);
}

/** Access rules for GET /api/media/uploads/:id. */
export function assertUploadVisible(ctx: Ctx, row: UploadRow): void {
  if (row.purpose === 'admin') throw new ApiError(404, 'NOT_FOUND', 'Admin files are not served here.');
  if (row.purpose === 'attachment') {
    if (row.message_id) assertMessageVisible(ctx, row.message_id);
    else if (row.owner_id !== ctx.user!.id) throw new ApiError(404, 'NOT_FOUND', 'That pending upload belongs to somebody else.');
    return;
  }
  if (row.owner_id === ctx.user!.id) return;
  if (PUBLIC_PURPOSES[row.purpose]) return;
  throw new ApiError(404, 'NOT_FOUND', 'That upload is not yours and not public.');
}

interface ServeOptions {
  storedPath: string;
  contentType: string;
  sha256: string;
  filename: string;
  cache: 'no-store' | 'immutable';
}

function contentDisposition(filename: string, contentType: string): string {
  const inline = /^(?:image|audio|video)\//i.test(contentType);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Serve a stored file with ETag, cache rules, disposition and single-range support. */
export function serveStoredFile(ctx: Ctx, opts: ServeOptions): Response {
  const abs = safeMediaPath(ctx.config, opts.storedPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new ApiError(404, 'NOT_FOUND', 'File disappeared into the void.');
  const total = statSync(abs).size;
  const etag = `"${opts.sha256}"`;
  const headers = new Headers({
    'content-type': opts.contentType,
    'etag': etag,
    'cache-control': opts.cache === 'no-store' ? 'private, no-store' : 'private, max-age=86400, immutable',
    'content-disposition': contentDisposition(opts.filename, opts.contentType),
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  });
  if (opts.contentType === 'image/svg+xml') headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  const inm = ctx.req.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//i, '') === etag)) {
    return new Response(null, { status: 304, headers });
  }
  const range = ctx.req.headers.get('range');
  if (range && total > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) {
      headers.set('content-range', `bytes */${total}`);
      return new Response(null, { status: 416, headers });
    }
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : NaN;
    if (Number.isNaN(start) && Number.isNaN(end)) {
      headers.set('content-range', `bytes */${total}`);
      return new Response(null, { status: 416, headers });
    }
    if (Number.isNaN(start)) { start = Math.max(0, total - end); end = total - 1; }
    else if (Number.isNaN(end)) end = total - 1;
    if (start < 0 || start >= total || end < start) {
      headers.set('content-range', `bytes */${total}`);
      return new Response(null, { status: 416, headers });
    }
    end = Math.min(end, total - 1);
    headers.set('content-range', `bytes ${start}-${end}/${total}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(Bun.file(abs).slice(start, end + 1), { status: 206, headers });
  }
  headers.set('content-length', String(total));
  return new Response(Bun.file(abs), { status: 200, headers });
}


