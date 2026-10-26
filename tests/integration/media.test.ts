import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, makeUsers, newClient, type TestServer, type Client } from '../helpers';
import { Perm } from '../../src/shared/permissions';

afterAll(() => stopAllServers());

const now = () => Date.now();

function seedGuild(server: TestServer, ownerId: string, memberIds: string[]): { serverId: string; channelId: string } {
  const db = server.runtime.db;
  const serverId = 'srv_test';
  const channelId = 'ch_general';
  db.run('INSERT INTO servers (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)', serverId, 'Slop HQ', ownerId, now());
  db.run(
    'INSERT INTO roles (id, server_id, name, position, permissions, is_default, created_at) VALUES (?, ?, ?, 0, ?, 1, ?)',
    'role_everyone', serverId, 'Everyone', Perm.VIEW_CHANNEL, now(),
  );
  for (const uid of new Set([ownerId, ...memberIds])) {
    db.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, uid, now());
  }
  db.run('INSERT INTO channels (id, server_id, type, name, created_at) VALUES (?, ?, ?, ?, ?)', channelId, serverId, 'text', 'general', now());
  return { serverId, channelId };
}

function seedMessage(server: TestServer, channelId: string, authorId: string, content = 'look at this slop'): string {
  const id = `msg_${Math.random().toString(36).slice(2, 12)}`;
  server.runtime.db.run(
    'INSERT INTO messages (id, channel_id, server_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, channelId, 'srv_test', authorId, content, now(),
  );
  return id;
}

function attach(server: TestServer, uploadId: string, messageId: string): void {
  const db = server.runtime.db;
  const u = db.get<{ filename: string; content_type: string; size: number; path: string; width: number | null; height: number | null; sha256: string }>(
    'SELECT filename, content_type, size, path, width, height, sha256 FROM uploads WHERE id = ?', uploadId,
  )!;
  db.run('UPDATE uploads SET message_id = ? WHERE id = ?', messageId, uploadId);
  db.run(
    `INSERT INTO attachments (id, message_id, filename, content_type, size, path, width, height, spoiler, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    uploadId, messageId, u.filename, u.content_type, u.size, u.path, u.width, u.height, u.sha256, now(),
  );
}

function upload(client: Client, purpose: string, bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const form = new FormData();
  form.set('file', new File([bytes as unknown as BlobPart], filename, { type }));
  form.set('purpose', purpose);
  return client.request('POST', '/api/uploads', undefined, { form });
}

function u32be(n: number): number[] { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; }
function u16be(n: number): number[] { return [(n >>> 8) & 0xff, n & 0xff]; }
function u16le(n: number): number[] { return [n & 0xff, (n >>> 8) & 0xff]; }
function u32le(n: number): number[] { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, ...u16be(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, ...u16be(1), ...u16be(1), 0, 0,
    0xff, 0xc0, ...u16be(11), 8, ...u16be(height), ...u16be(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
}

function gif(width: number, height: number): Uint8Array {
  const head = [...'GIF89a'].map((c) => c.charCodeAt(0));
  return Uint8Array.from([...head, ...u16le(width), ...u16le(height), 0, 0, 0, 0, 0x3b]);
}

function webp(width: number, height: number): Uint8Array {
  const head = [...'RIFF'].map((c) => c.charCodeAt(0));
  const webpTag = [...'WEBP'].map((c) => c.charCodeAt(0));
  const vp8x = [...'VP8X'].map((c) => c.charCodeAt(0));
  return Uint8Array.from([
    ...head, ...u32le(22), ...webpTag, ...vp8x, ...u32le(10),
    0, 0, 0, 0,
    width - 1, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff,
    height - 1, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff,
  ]);
}

function wav(payloadSize = 16): Uint8Array {
  return Uint8Array.from([
    ...'RIFF'.split('').map((c) => c.charCodeAt(0)), ...u32le(36 + payloadSize),
    ...'WAVEfmt '.split('').map((c) => c.charCodeAt(0)), ...u32le(16), 1, 0, 1, 0,
    0x40, 0x1f, 0, 0, 0x80, 0x3e, 0, 0, 2, 0, 16, 0,
    ...'data'.split('').map((c) => c.charCodeAt(0)), ...u32le(payloadSize), ...new Array(payloadSize).fill(0),
  ]);
}

const XSS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><image href="https://evil.example/x.png"/><foreignObject><div>hi</div></foreignObject></svg>';
const BENIGN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ff00aa"/></svg>';

describe('media', () => {
  test('avatar upload stores metadata, parses dimensions and serves to authenticated users', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const res = await upload(alice!, 'avatar', png(3, 7), 'me.png', 'image/png');
    expect(res.status).toBe(200);
    const up = res.body.upload;
    expect(up.id).toStartWith('upl_');
    expect(up.url).toBe(`/api/media/uploads/${up.id}`);
    expect(up.filename).toBe('me.png');
    expect(up.contentType).toBe('image/png');
    expect(up.size).toBe(png(3, 7).byteLength);
    expect(up.width).toBe(3);
    expect(up.height).toBe(7);
    expect(up.purpose).toBe('avatar');

    const row = server.runtime.db.get<{ path: string; owner_id: string; sha256: string }>('SELECT path, owner_id, sha256 FROM uploads WHERE id = ?', up.id)!;
    expect(row.owner_id).toBe(alice!.userId);
    expect(row.path).toMatch(/^\d{4}\/\d{2}\/upl_[a-z0-9]+\.png$/);

    const own = await alice!.get(up.url);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(own.headers.get('content-disposition')).toContain('inline');
    expect(own.headers.get('etag')).toBe(`"${row.sha256}"`);
    expect(own.headers.get('cache-control')).toContain('private');
    expect(own.body.byteLength).toBe(up.size);

    const other = await bob!.get(up.url);
    expect(other.status).toBe(200);
    expect(other.body.byteLength).toBe(up.size);

    const anon = newClient(server);
    const denied = await anon.get(up.url);
    expect(denied.status).toBe(401);
  });

  test('attachments require channel visibility; attachment endpoint follows the same rules', async () => {
    const server = startTestServer();
    const [alice, bob, carol] = await makeUsers(server, ['alice', 'bob', 'carol']);
    const { channelId } = seedGuild(server, alice!.userId, [bob!.userId]);
    const up = (await upload(alice!, 'attachment', wav(24), 'clip.wav', 'audio/wav')).body.upload;
    expect(up.contentType).toBe('audio/wav');

    const pending = await bob!.get(up.url);
    expect(pending.status).toBe(404);

    const msg = seedMessage(server, channelId, alice!.userId);
    attach(server, up.id, msg);

    const memberView = await bob!.get(up.url);
    expect(memberView.status).toBe(200);
    expect(memberView.headers.get('cache-control')).toBe('private, no-store');
    const memberAttachment = await bob!.get(`/api/attachments/${up.id}`);
    expect(memberAttachment.status).toBe(200);
    expect(memberAttachment.headers.get('content-type')).toBe('audio/wav');
    expect(memberAttachment.body.byteLength).toBe(up.size);

    const outsider = await carol!.get(up.url);
    expect(outsider.status).toBe(404);
    const outsiderAttachment = await carol!.get(`/api/attachments/${up.id}`);
    expect(outsiderAttachment.status).toBe(404);

    const ownerView = await alice!.get(up.url);
    expect(ownerView.status).toBe(200);

    server.runtime.db.run('UPDATE messages SET deleted_at = ? WHERE id = ?', now(), msg);
    const afterDelete = await bob!.get(up.url);
    expect(afterDelete.status).toBe(404);
    const afterDeleteAttachment = await bob!.get(`/api/attachments/${up.id}`);
    expect(afterDeleteAttachment.status).toBe(404);
  });

  test('rejects MIME spoofing and never trusts the declared content type', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']);
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const spoofed = await upload(alice!, 'avatar', html, 'avatar.png', 'image/png');
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.error).toBe('VALIDATION_ERROR');
    expect(spoofed.body.fields.file).toContain('Unrecognized file');

    const sneakyText = await upload(alice!, 'attachment', html, 'notes.txt', 'text/plain');
    expect(sneakyText.status).toBe(400);

    const actualPng = await upload(alice!, 'avatar', png(1, 1), 'liar.gif', 'image/gif');
    expect(actualPng.status).toBe(200);
    expect(actualPng.body.upload.contentType).toBe('image/png');

    const jsFile = await upload(alice!, 'attachment', new TextEncoder().encode('alert(1)'), 'evil.js', 'application/javascript');
    expect(jsFile.status).toBe(400);
  });

  test('rejects XSS SVGs and only allows SVG for emoji', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']);
    const xss = await upload(alice!, 'emoji', new TextEncoder().encode(XSS_SVG), 'evil.svg', 'image/svg+xml');
    expect(xss.status).toBe(400);
    expect(xss.body.error).toBe('VALIDATION_ERROR');

    const svgAvatar = await upload(alice!, 'avatar', new TextEncoder().encode(BENIGN_SVG), 'me.svg', 'image/svg+xml');
    expect(svgAvatar.status).toBe(400);

    const emoji = await upload(alice!, 'emoji', new TextEncoder().encode(BENIGN_SVG), 'blob.svg', 'image/svg+xml');
    expect(emoji.status).toBe(200);
    expect(emoji.body.upload.contentType).toBe('image/svg+xml');
    expect(emoji.body.upload.width).toBeNull();
    const served = await alice!.get(emoji.body.upload.url);
    expect(served.status).toBe(200);
    const body = new TextDecoder().decode(served.body);
    expect(body).toContain('<svg');
    expect(body).not.toContain('<script');

    const nonSvg = await upload(alice!, 'emoji', new TextEncoder().encode('<html>nope</html>'), 'fake.svg', 'image/svg+xml');
    expect(nonSvg.status).toBe(400);

    const passive = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="https://evil.example/tracker.png"/><rect width="16" height="16"/></svg>';
    const cleaned = await upload(alice!, 'emoji', new TextEncoder().encode(passive), 'clean.svg', 'image/svg+xml');
    expect(cleaned.status).toBe(200);
    const cleanedBody = new TextDecoder().decode((await alice!.get(cleaned.body.upload.url)).body);
    expect(cleanedBody).not.toContain('DOCTYPE');
    expect(cleanedBody).not.toContain('evil.example');
    expect(cleanedBody).toContain('<svg');
  });

  test('enforces per-purpose size limits', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']);
    const bigAvatar = new Uint8Array(2 * 1024 * 1024 + 1);
    bigAvatar.set(png(1, 1));
    const tooBig = await upload(alice!, 'avatar', bigAvatar, 'huge.png', 'image/png');
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBe('FILE_TOO_LARGE');

    const okPng = png(1, 1);
    expect(okPng.byteLength).toBeLessThan(2 * 1024 * 1024);

    const smallServer = startTestServer({ maxUploadBytes: 1024 });
    const [tiny] = await makeUsers(smallServer, ['tiny']);
    const big = new Uint8Array(2048);
    big.set(png(1, 1));
    const overInstance = await upload(tiny!, 'attachment', big, 'big.png', 'image/png');
    expect(overInstance.status).toBe(413);

    const soundPng = await upload(alice!, 'sound', png(1, 1), 'sound.png', 'image/png');
    expect(soundPng.status).toBe(400);
  });

  test('parses dimensions for PNG, JPEG, GIF and WebP', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']);
    const cases: [Uint8Array, string, string, number, number][] = [
      [png(11, 13), 'a.png', 'image/png', 11, 13],
      [jpeg(21, 17), 'b.jpg', 'image/jpeg', 21, 17],
      [gif(5, 9), 'c.gif', 'image/gif', 5, 9],
      [webp(300, 200), 'd.webp', 'image/webp', 300, 200],
    ];
    for (const [bytes, filename, contentType, width, height] of cases) {
      const res = await upload(alice!, 'avatar', bytes, filename, contentType);
      expect(res.status).toBe(200);
      expect(res.body.upload.contentType).toBe(contentType);
      expect(res.body.upload.width).toBe(width);
      expect(res.body.upload.height).toBe(height);
      const served = await alice!.get(res.body.upload.url);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe(contentType);
    }
  });

  test('refuses directory traversal from URL params, DB paths and attachment rows', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const { channelId } = seedGuild(server, alice!.userId, [bob!.userId]);
    const encoded = encodeURIComponent('../../../../etc/passwd');
    const urlTraversal = await alice!.get(`/api/media/uploads/${encoded}`);
    expect(urlTraversal.status).toBe(404);

    const db = server.runtime.db;
    for (const [id, path] of [['upl_trav', '../../../etc/shadow'], ['upl_abs', '/etc/passwd']] as const) {
      db.run(
        `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, width, height, created_at)
         VALUES (?, ?, 'avatar', 'evil.png', 'image/png', 10, ?, ?, 1, 1, ?)`,
        id, alice!.userId, path, 'a'.repeat(64), now(),
      );
      const res = await alice!.get(`/api/media/uploads/${id}`);
      expect(res.status).toBe(404);
    }

    const msg = seedMessage(server, channelId, alice!.userId);
    db.run(
      `INSERT INTO attachments (id, message_id, filename, content_type, size, path, width, height, spoiler, sha256, created_at)
       VALUES ('att_trav', ?, 'evil.png', 'image/png', 10, '../../../../etc/passwd', 1, 1, 0, ?, ?)`,
      msg, 'b'.repeat(64), now(),
    );
    const viaAttachment = await bob!.get('/api/attachments/att_trav');
    expect(viaAttachment.status).toBe(404);

    const deleteTraversal = await alice!.delete('/api/uploads/upl_trav');
    expect(deleteTraversal.status).toBe(204);
    expect(server.runtime.db.get('SELECT 1 FROM uploads WHERE id = ?', 'upl_trav')).toBeNull();
  });

  test('delete: owner-only, refuses attached uploads, removes row and file', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const { channelId } = seedGuild(server, alice!.userId, [bob!.userId]);
    const up = (await upload(alice!, 'attachment', png(2, 2), 'temp.png', 'image/png')).body.upload;
    const row = server.runtime.db.get<{ path: string }>('SELECT path FROM uploads WHERE id = ?', up.id)!;
    const abs = `${server.runtime.config.uploadDir}/${row.path}`;
    expect(await Bun.file(abs).exists()).toBe(true);

    const foreign = await bob!.delete(`/api/uploads/${up.id}`);
    expect(foreign.status).toBe(403);

    const msg = seedMessage(server, channelId, alice!.userId);
    attach(server, up.id, msg);
    const attached = await alice!.delete(`/api/uploads/${up.id}`);
    expect(attached.status).toBe(409);
    expect(await Bun.file(abs).exists()).toBe(true);

    const other = (await upload(alice!, 'attachment', png(2, 2), 'free.png', 'image/png')).body.upload;
    const otherRow = server.runtime.db.get<{ path: string }>('SELECT path FROM uploads WHERE id = ?', other.id)!;
    const otherAbs = `${server.runtime.config.uploadDir}/${otherRow.path}`;
    const removed = await alice!.delete(`/api/uploads/${other.id}`);
    expect(removed.status).toBe(204);
    expect(await Bun.file(otherAbs).exists()).toBe(false);
    expect(server.runtime.db.get('SELECT 1 FROM uploads WHERE id = ?', other.id)).toBeNull();
    expect((await alice!.get(other.url)).status).toBe(404);

    const missing = await alice!.delete('/api/uploads/upl_nope');
    expect(missing.status).toBe(404);
  });

  test('serves byte ranges and revalidates with ETag', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const { channelId } = seedGuild(server, alice!.userId, [bob!.userId]);
    const bytes = wav(100);
    const up = (await upload(alice!, 'attachment', bytes, 'clip.wav', 'audio/wav')).body.upload;
    attach(server, up.id, seedMessage(server, channelId, alice!.userId));

    const part = await bob!.request('GET', up.url, undefined, { headers: { range: 'bytes=0-9' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 0-9/${bytes.byteLength}`);
    expect(part.headers.get('accept-ranges')).toBe('bytes');
    expect(part.body.byteLength).toBe(10);

    const suffix = await bob!.request('GET', up.url, undefined, { headers: { range: 'bytes=-5' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe(`bytes ${bytes.byteLength - 5}-${bytes.byteLength - 1}/${bytes.byteLength}`);

    const bad = await bob!.request('GET', up.url, undefined, { headers: { range: 'bytes=999999-' } });
    expect(bad.status).toBe(416);

    const full = await bob!.get(up.url);
    const etag = full.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const cached = await bob!.request('GET', up.url, undefined, { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);
  });

  test('admin uploads are never served; purpose and role rules are enforced', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const asAdmin = await upload(alice!, 'admin', png(1, 1), 'secret.png', 'image/png');
    expect(asAdmin.status).toBe(200);
    expect((await alice!.get(asAdmin.body.upload.url)).status).toBe(404);
    expect((await bob!.get(asAdmin.body.upload.url)).status).toBe(404);

    const nonAdmin = await upload(bob!, 'admin', png(1, 1), 'secret.png', 'image/png');
    expect(nonAdmin.status).toBe(403);

    const unknown = await upload(alice!, 'definitely_not_a_purpose', png(1, 1), 'x.png', 'image/png');
    expect(unknown.status).toBe(400);

    const webhook = await upload(bob!, 'webhook_avatar', png(4, 4), 'hook.png', 'image/png');
    expect(webhook.status).toBe(200);
    expect((await alice!.get(webhook.body.upload.url)).status).toBe(200);
    expect(webhook.body.upload.purpose).toBe('webhook_avatar');
  });
});


