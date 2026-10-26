import { describe, expect, test, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { startTestServer, stopAllServers, newClient, makeUsers, type TestServer, type Client } from '../helpers';

afterAll(() => stopAllServers());

let seq = 0;
function uid(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

function seedServer(server: TestServer, ownerId: string, members: string[] = [], name = 'Slop Lab') {
  const db = server.runtime.db;
  const serverId = uid('srv');
  const now = Date.now();
  db.run(
    `INSERT INTO servers (id, name, owner_id, member_count, is_public, nsfw, traits, created_at)
     VALUES (?, ?, ?, ?, 1, 0, '[]', ?)`,
    serverId, name, ownerId, members.length + 1, now,
  );
  const everyoneId = uid('role');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, is_default, created_at)
     VALUES (?, ?, '@everyone', '#99aab5', 0, 0, 1, ?)`,
    everyoneId, serverId, now,
  );
  for (const userId of [ownerId, ...members]) {
    db.run('INSERT OR IGNORE INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, userId, now);
    db.run('INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', serverId, userId, everyoneId);
  }
  const channelId = uid('chn');
  db.run(
    `INSERT INTO channels (id, server_id, type, name, position, created_at) VALUES (?, ?, 'text', 'general', 0, ?)`,
    channelId, serverId, now,
  );
  return { serverId, channelId, everyoneId };
}

function seedMessage(server: TestServer, channelId: string, serverId: string, authorId: string, content: string, encrypted = 0) {
  const db = server.runtime.db;
  const id = uid('msg');
  db.run(
    `INSERT INTO messages (id, channel_id, server_id, author_id, content, encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, channelId, serverId, authorId, content, encrypted, Date.now(),
  );
  return id;
}

function seedUpload(server: TestServer, ownerId: string, purpose = 'emoji', size = 64) {
  const db = server.runtime.db;
  const id = uid('up');
  const rel = `2026/10/${id}.png`;
  const absolute = join(server.runtime.config.uploadDir, rel);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, Buffer.alloc(size, 65));
  db.run(
    `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, created_at)
     VALUES (?, ?, ?, ?, 'image/png', ?, ?, 'deadbeef', ?)`,
    id, ownerId, purpose, `${id}.png`, size, rel, Date.now(),
  );
  return { id, rel, absolute };
}

function seedReport(server: TestServer, input: { reporterId: string; targetUserId?: string; serverId?: string; messageId?: string; reason?: string }) {
  const db = server.runtime.db;
  const id = uid('rep');
  db.run(
    `INSERT INTO reports (id, server_id, reporter_id, target_user_id, message_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    id, input.serverId ?? null, input.reporterId, input.targetUserId ?? null, input.messageId ?? null, input.reason ?? 'Slop detected', Date.now(),
  );
  return id;
}

// makeUsers throws if any registration fails, so the tuple casts below are safe fixture guarantees.
describe('admin console', () => {
  test('non-admins get 403 and the overview exposes a safe dashboard shape', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']) as [Client, Client];
    const { serverId, channelId } = seedServer(server, alice.userId, [bob.userId]);
    const messageId = seedMessage(server, channelId, serverId, bob.userId, 'hello slop');
    const upload = seedUpload(server, bob.userId, 'attachment', 40);
    server.runtime.db.run(
      `INSERT INTO attachments (id, message_id, filename, content_type, size, path, sha256, created_at)
       VALUES (?, ?, 'a.txt', 'text/plain', 7, 'x', 'abc', ?)`,
      uid('att'), messageId, Date.now(),
    );
    seedReport(server, { reporterId: bob.userId, targetUserId: bob.userId, serverId, messageId });

    const denied = await bob.get('/api/admin/overview');
    expect(denied.status).toBe(403);
    const deniedWrite = await bob.post('/api/admin/maintenance', { action: 'vacuum' });
    expect(deniedWrite.status).toBe(403);

    const res = await alice.get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.counts.users).toBe(2);
    expect(res.body.counts.servers).toBe(1);
    expect(res.body.counts.messages).toBe(1);
    expect(res.body.counts.channels).toBe(1);
    expect(res.body.counts.uploads).toBe(1);
    expect(res.body.counts.openReports).toBe(1);
    expect(res.body.counts.sessions).toBeGreaterThanOrEqual(2);
    expect(res.body.onlineCount).toBe(0);
    expect(res.body.storageBytes).toBe(40 + 7);
    expect(res.body.signups).toHaveLength(14);
    expect(res.body.messages).toHaveLength(14);
    expect(res.body.topServers[0].id).toBe(serverId);
    expect(Array.isArray(res.body.recentAudit)).toBe(true);
    expect(typeof res.body.health.dbSize).toBe('number');
    expect(typeof res.body.health.walSize).toBe('number');
    expect(res.body.health.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.health.bun).toBe('string');
    expect(res.body.health.version).toBeString();
    expect(JSON.stringify(res.body)).not.toContain('password_hash');

    const session = await alice.get('/api/admin/session');
    expect(session.body.user.username).toBe('alice');
    const health = await alice.get('/api/admin/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const users = await alice.get('/api/admin/users?limit=1&page=1');
    expect(users.status).toBe(200);
    expect(users.body.total).toBe(2);
    expect(users.body.limit).toBe(1);
    expect(users.body.users).toHaveLength(1);
    expect(users.body.users[0].passwordHash).toBeUndefined();
    expect(users.body.users[0].password_hash).toBeUndefined();
    const admins = await alice.get('/api/admin/users?filter=admin');
    expect(admins.body.users.map((u: { username: string }) => u.username)).toEqual(['alice']);
    const badFilter = await alice.get('/api/admin/users?filter=ghost');
    expect(badFilter.status).toBe(400);
    const tooBig = await alice.get('/api/admin/users?limit=101');
    expect(tooBig.status).toBe(400);

    const detail = await alice.get(`/api/admin/users/${bob.userId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.user.id).toBe(bob.userId);
    expect(detail.body.user.passwordHash).toBeUndefined();
    expect(detail.body.user.totpSecret).toBeUndefined();
    expect(detail.body.messageCount).toBe(1);
    expect(detail.body.uploads).toBe(1);
    expect(detail.body.servers[0].id).toBe(serverId);
    expect(Array.isArray(detail.body.achievements)).toBe(true);
    expect(Array.isArray(detail.body.recentAudit)).toBe(true);

    const missing = await alice.get('/api/admin/users/u_does_not_exist');
    expect(missing.status).toBe(404);
    const audit = await alice.get('/api/admin/audit');
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body.entries)).toBe(true);
  });

  test('server and channel management: list, patch, delete and owner validation', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']) as [Client, Client];
    const fixture = seedServer(server, alice.userId, [bob.userId], 'Delete Me Slop');

    const list = await alice.get('/api/admin/servers?query=delete');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.servers[0].owner.username).toBe('alice');
    expect(list.body.servers[0].channelCount).toBe(1);
    expect(list.body.servers[0].memberCount).toBe(2);

    const detail = await alice.get(`/api/admin/servers/${fixture.serverId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.server.name).toBe('Delete Me Slop');
    expect(detail.body.channels).toHaveLength(1);
    expect(detail.body.roles).toHaveLength(1);
    expect(detail.body.owner.username).toBe('alice');
    expect(detail.body.counts.members).toBe(2);

    const renamed = await alice.patch(`/api/admin/servers/${fixture.serverId}`, { name: 'Renamed Slop', isPublic: false, description: 'new blurb' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.server.name).toBe('Renamed Slop');
    expect(renamed.body.server.isPublic).toBe(false);
    const badOwner = await alice.patch(`/api/admin/servers/${fixture.serverId}`, { ownerId: 'u_ghost' });
    expect(badOwner.status).toBe(400);

    const channelPatch = await alice.patch(`/api/admin/channels/${fixture.channelId}`, { name: 'general-chaos', topic: 'slop only', locked: true, slowmode: 30 });
    expect(channelPatch.status).toBe(200);
    expect(channelPatch.body.channel.name).toBe('general-chaos');
    expect(channelPatch.body.channel.locked).toBe(true);
    expect(channelPatch.body.channel.slowmode).toBe(30);
    const badSlowmode = await alice.patch(`/api/admin/channels/${fixture.channelId}`, { slowmode: 999_999 });
    expect(badSlowmode.status).toBe(400);

    const deletedChannel = await alice.delete(`/api/admin/channels/${fixture.channelId}`);
    expect(deletedChannel.status).toBe(200);
    expect(server.runtime.db.get('SELECT 1 FROM channels WHERE id = ?', fixture.channelId)).toBeNull();

    const fixture2 = seedServer(server, alice.userId, [], 'Owner Test');
    const transfer = await alice.patch(`/api/admin/servers/${fixture2.serverId}`, { ownerId: bob.userId });
    expect(transfer.status).toBe(200);
    expect(transfer.body.server.ownerId).toBe(bob.userId);
    expect(server.runtime.db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', fixture2.serverId, bob.userId)).toBeTruthy();

    const removed = await alice.delete(`/api/admin/servers/${fixture2.serverId}`);
    expect(removed.status).toBe(200);
    expect(server.runtime.db.get('SELECT 1 FROM servers WHERE id = ?', fixture2.serverId)).toBeNull();
    expect(server.runtime.db.get('SELECT 1 FROM channels WHERE server_id = ?', fixture2.serverId)).toBeNull();
    const audit = await alice.get('/api/admin/audit?query=admin.server');
    expect(audit.body.total).toBeGreaterThanOrEqual(2);
    const invites = await alice.get('/api/admin/invites');
    expect(invites.status).toBe(200);
    expect(Array.isArray(invites.body.invites)).toBe(true);
    const inviteCode = 'slopinvite1';
    server.runtime.db.run(
      `INSERT INTO invites (code, server_id, creator_id, max_uses, uses, created_at) VALUES (?, ?, ?, 5, 0, ?)`,
      inviteCode, fixture.serverId, alice.userId, Date.now(),
    );
    const inviteList = await alice.get('/api/admin/invites');
    expect(inviteList.body.total).toBe(1);
    expect(inviteList.body.invites[0].code).toBe(inviteCode);
    expect(inviteList.body.invites[0].serverName).toBe('Renamed Slop');
    const removedInvite = await alice.delete(`/api/admin/invites/${inviteCode}`);
    expect(removedInvite.status).toBe(200);
    expect(server.runtime.db.get('SELECT 1 FROM invites WHERE code = ?', inviteCode)).toBeNull();
  });

  test('reports resolve with delete_message, timeout and ban actions; ciphertext stays hidden', async () => {
    const server = startTestServer();
    const [alice, bob, carol] = await makeUsers(server, ['alice', 'bob', 'carol']) as [Client, Client, Client];
    const fixture = seedServer(server, alice.userId, [bob.userId, carol.userId]);
    const messageId = seedMessage(server, fixture.channelId, fixture.serverId, bob.userId, 'this slop must go');
    const reportId = seedReport(server, { reporterId: carol.userId, targetUserId: bob.userId, serverId: fixture.serverId, messageId });

    const resolved = await alice.post(`/api/admin/reports/${reportId}/resolve`, {
      status: 'resolved', resolution: 'Deleted the evidence.', action: 'delete_message',
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.actionApplied).toBe('delete_message');
    expect(resolved.body.report.status).toBe('resolved');
    expect(server.runtime.db.get<{ deleted_at: number | null }>('SELECT deleted_at FROM messages WHERE id = ?', messageId)?.deleted_at).toBeGreaterThan(0);
    const reporterNote = server.runtime.db.get<{ title: string }>('SELECT title FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', carol.userId);
    expect(reporterNote?.title).toContain('resolved');

    const again = await alice.post(`/api/admin/reports/${reportId}/resolve`, { status: 'resolved', action: 'ban' });
    expect(again.status).toBe(200);
    expect(again.body.alreadyResolved).toBe(true);
    expect(server.runtime.db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', fixture.serverId, bob.userId)).toBeTruthy();

    const msg2 = seedMessage(server, fixture.channelId, fixture.serverId, bob.userId, 'second offence');
    const timeoutReport = seedReport(server, { reporterId: carol.userId, targetUserId: bob.userId, serverId: fixture.serverId, messageId: msg2 });
    const timeout = await alice.post(`/api/admin/reports/${timeoutReport}/resolve`, { status: 'resolved', action: 'timeout', durationMs: 600_000, resolution: 'Touch grass.' });
    expect(timeout.status).toBe(200);
    expect(timeout.body.actionApplied).toBe('timeout');
    const timeoutUntil = server.runtime.db.get<{ timeout_until: number | null }>('SELECT timeout_until FROM members WHERE server_id = ? AND user_id = ?', fixture.serverId, bob.userId)?.timeout_until ?? 0;
    expect(timeoutUntil).toBeGreaterThan(Date.now() + 500_000);

    const banReport = seedReport(server, { reporterId: carol.userId, targetUserId: bob.userId, serverId: fixture.serverId, messageId: msg2 });
    const ban = await alice.post(`/api/admin/reports/${banReport}/resolve`, { status: 'resolved', action: 'ban', resolution: 'Perma-slop ban.' });
    expect(ban.status).toBe(200);
    expect(ban.body.actionApplied).toBe('ban');
    expect(server.runtime.db.get('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?', fixture.serverId, bob.userId)).toBeTruthy();
    expect(server.runtime.db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', fixture.serverId, bob.userId)).toBeNull();
    expect(server.runtime.db.get<{ member_count: number }>('SELECT member_count FROM servers WHERE id = ?', fixture.serverId)?.member_count).toBe(2);

    const encrypted = seedMessage(server, fixture.channelId, fixture.serverId, bob.userId, 'CIPHERTEXT-DO-NOT-DECRYPT', 1);
    const encryptedReportId = seedReport(server, { reporterId: carol.userId, serverId: fixture.serverId, messageId: encrypted });
    const encryptedReport = await alice.post(`/api/admin/reports/${encryptedReportId}/resolve`, { status: 'dismissed', resolution: 'Not decryptable, not our problem.' });
    expect(encryptedReport.status).toBe(200);

    const list = await alice.get('/api/admin/reports?status=all');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(4);
    const encryptedEntry = list.body.reports.find((r: { message: { id: string } | null }) => r.message?.id === encrypted);
    expect(encryptedEntry.message.encrypted).toBe(true);
    expect(encryptedEntry.message.content).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain('CIPHERTEXT-DO-NOT-DECRYPT');
    expect(list.body.reports[0].reporter.username).toBeString();
    const open = await alice.get('/api/admin/reports');
    expect(open.body.total).toBe(0);
    const badStatus = await alice.get('/api/admin/reports?status=weird');
    expect(badStatus.status).toBe(400);
  });

  test('settings validate, persist and drive registration mode', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']) as [Client];

    const invalidNumber = await alice.patch('/api/admin/settings', { max_upload_mb: 900 });
    expect(invalidNumber.status).toBe(400);
    expect(invalidNumber.body.fields.max_upload_mb).toBeString();
    const invalidMode = await alice.patch('/api/admin/settings', { registration: 'whenever' });
    expect(invalidMode.status).toBe(400);
    const invalidFlag = await alice.patch('/api/admin/settings', { e2ee_enabled: 'yes' });
    expect(invalidFlag.status).toBe(400);
    const invalidKey = await alice.patch('/api/admin/settings', { secret_key: 'nope' });
    expect(invalidKey.status).toBe(400);

    const closed = await alice.patch('/api/admin/settings', { registration: 'closed', max_upload_mb: 42, instance_name: 'Slop Bunker' });
    expect(closed.status).toBe(200);
    expect(closed.body.settings.registration).toBe('closed');
    expect(closed.body.settings.max_upload_mb).toBe(42);
    expect(closed.body.settings.instance_name).toBe('Slop Bunker');
    const blocked = await newClient(server).register('newbie', 'password123');
    expect(blocked.status).toBe(403);

    const reopened = await alice.patch('/api/admin/settings', { registration: 'open' });
    expect(reopened.status).toBe(200);
    const allowed = await newClient(server).register('newbie', 'password123');
    expect(allowed.status).toBe(200);

    const settings = await alice.get('/api/admin/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.settings.registration).toBe('open');
    expect(settings.body.settings.secret).toBeUndefined();
  });

  test('backup returns a zip with manifest, settings and db snapshot', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']) as [Client];
    seedServer(server, alice.userId, [], 'Backup Slop');
    const upload = seedUpload(server, alice.userId, 'attachment', 32);

    const res = await alice.get('/api/admin/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const bytes = new Uint8Array(res.body);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const files = unzipSync(bytes);
    expect(files['slop.db']).toBeTruthy();
    expect(files['manifest.json']).toBeTruthy();
    expect(files['settings.json']).toBeTruthy();
    expect(files['secret.key']).toBeUndefined();
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifest.version).toBeString();
    expect(manifest.counts.users).toBe(1);
    expect(manifest.counts.servers).toBe(1);
    expect(manifest.media).toBe(false);
    expect(strFromU8(files['settings.json']!)).not.toContain('secret');

    const withMedia = await alice.get('/api/admin/backup?media=1');
    expect(withMedia.status).toBe(200);
    const mediaFiles = unzipSync(new Uint8Array(withMedia.body));
    const mediaNames = Object.keys(mediaFiles).filter((n) => n.startsWith('uploads/'));
    expect(mediaNames.length).toBe(1);
    expect(mediaNames[0]).toContain(upload.id);
    expect(JSON.parse(strFromU8(mediaFiles['manifest.json']!)).media).toBe(true);
  });

  test('suspend, reset password, revoke sessions and self-protection rails', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']) as [Client, Client];

    const disabled = await alice.patch(`/api/admin/users/${bob.userId}`, { disabled: true });
    expect(disabled.status).toBe(200);
    expect(disabled.body.user.disabled).toBe(true);
    const blockedLogin = await newClient(server).login('bob', 'password123');
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.error).toBe('ACCOUNT_DISABLED');
    const staleSession = await bob.get('/api/auth/me');
    expect(staleSession.body.user).toBeNull();

    const enabled = await alice.patch(`/api/admin/users/${bob.userId}`, { disabled: false, bannedUntil: null });
    expect(enabled.status).toBe(200);
    expect(enabled.body.user.disabled).toBe(false);

    const reset = await alice.post(`/api/admin/users/${bob.userId}/reset-password`);
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toHaveLength(16);
    const oldLogin = await newClient(server).login('bob', 'password123');
    expect(oldLogin.status).toBe(401);
    const tempClient = newClient(server);
    const tempLogin = await tempClient.login('bob', reset.body.temporaryPassword);
    expect(tempLogin.status).toBe(200);
    const revoked = await alice.post(`/api/admin/users/${bob.userId}/revoke-sessions`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
    const afterRevoke = await tempClient.get('/api/auth/me');
    expect(afterRevoke.body.user).toBeNull();

    const selfReset = await alice.post(`/api/admin/users/${alice.userId}/reset-password`);
    expect(selfReset.status).toBe(400);
    expect(selfReset.body.error).toBe('SELF_RESET');
    const stillLoggedIn = await alice.get('/api/auth/me');
    expect(stillLoggedIn.body.user?.id).toBe(alice.userId);

    const selfDisable = await alice.patch(`/api/admin/users/${alice.userId}`, { disabled: true });
    expect(selfDisable.status).toBe(400);
    expect(selfDisable.body.error).toBe('SELF_DISABLE');
    const selfBan = await alice.patch(`/api/admin/users/${alice.userId}`, { bannedUntil: Date.now() + 60_000 });
    expect(selfBan.status).toBe(400);
    expect(selfBan.body.error).toBe('SELF_BAN');
    const selfDelete = await alice.delete(`/api/admin/users/${alice.userId}`);
    expect(selfDelete.status).toBe(400);

    const selfDemote = await alice.patch(`/api/admin/users/${alice.userId}`, { isAdmin: false });
    expect(selfDemote.status).toBe(400);
    expect(selfDemote.body.error).toBe('SELF_DEMOTE');
    const stillAdmin = server.runtime.db.get<{ is_admin: number }>('SELECT is_admin FROM users WHERE id = ?', alice.userId);
    expect(stillAdmin?.is_admin).toBe(1);

    const [carol] = await makeUsers(server, ['carol']) as [Client];
    const secondAdmin = await alice.patch(`/api/admin/users/${carol.userId}`, { isAdmin: true });
    expect(secondAdmin.status).toBe(200);
    expect(secondAdmin.body.user.isAdmin).toBe(true);
    const demoteOther = await alice.patch(`/api/admin/users/${carol.userId}`, { isAdmin: false });
    expect(demoteOther.status).toBe(200);

    const banOther = await alice.patch(`/api/admin/users/${bob.userId}`, { bannedUntil: Date.now() + 3_600_000, banReason: 'unfathomable slop' });
    expect(banOther.status).toBe(200);
    expect(banOther.body.user.banReason).toBe('unfathomable slop');
    const bannedLogin = await newClient(server).login('bob', reset.body.temporaryPassword);
    expect(bannedLogin.status).toBe(403);
    const bannedFilter = await alice.get('/api/admin/users?filter=banned');
    expect(bannedFilter.body.users.map((u: { id: string }) => u.id)).toContain(bob.userId);

    const victim = await makeUsers(server, ['dave']);
    const deleted = await alice.delete(`/api/admin/users/${victim[0]!.userId}`);
    expect(deleted.status).toBe(200);
    expect(server.runtime.db.get('SELECT 1 FROM users WHERE id = ?', victim[0]!.userId)).toBeNull();
    const audit = await alice.get('/api/admin/audit?query=admin.user');
    expect(audit.body.total).toBeGreaterThanOrEqual(3);
  });

  test('account invites gate registration and can be revoked', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']) as [Client];
    await alice.patch('/api/admin/settings', { registration: 'invite' });

    const created = await alice.post('/api/admin/account-invites', { maxUses: 2, expiresInHours: 24 });
    expect(created.status).toBe(200);
    const code = created.body.invite.code;
    expect(code).toBeString();
    expect(code.length).toBeGreaterThanOrEqual(8);
    expect(created.body.invite.maxUses).toBe(2);

    const list = await alice.get('/api/admin/account-invites');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.invites[0].code).toBe(code);
    expect(list.body.invites[0].uses).toBe(0);

    const noInvite = await newClient(server).register('nope', 'password123');
    expect(noInvite.status).toBe(403);
    const first = await newClient(server).post('/api/auth/register', { username: 'invited1', password: 'password123', displayName: 'invited1', accountInvite: code });
    expect(first.status).toBe(200);
    const second = await newClient(server).post('/api/auth/register', { username: 'invited2', password: 'password123', displayName: 'invited2', accountInvite: code });
    expect(second.status).toBe(200);
    const third = await newClient(server).post('/api/auth/register', { username: 'invited3', password: 'password123', displayName: 'invited3', accountInvite: code });
    expect(third.status).toBe(403);

    const updatedList = await alice.get('/api/admin/account-invites');
    expect(updatedList.body.invites[0].uses).toBe(2);
    expect(updatedList.body.invites[0].exhausted).toBe(true);

    const badMax = await alice.post('/api/admin/account-invites', { maxUses: 5_000 });
    expect(badMax.status).toBe(400);

    const removed = await alice.delete(`/api/admin/account-invites/${code}`);
    expect(removed.status).toBe(200);
    const gone = await newClient(server).post('/api/auth/register', { username: 'invited4', password: 'password123', displayName: 'invited4', accountInvite: code });
    expect(gone.status).toBe(403);
    const missing = await alice.delete('/api/admin/account-invites/nonexistent');
    expect(missing.status).toBe(404);
  });

  test('logs tail app.log safely and validate the line count', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']) as [Client];
    const empty = await alice.get('/api/admin/logs');
    expect(empty.status).toBe(200);
    expect(empty.body.lines).toEqual([]);
    writeFileSync(join(server.runtime.config.dataDir, 'logs', 'app.log'), 'first\nsecond\nthird\n');
    const tail = await alice.get('/api/admin/logs?lines=2');
    expect(tail.status).toBe(200);
    expect(tail.body.lines).toEqual(['second', 'third']);
    const everything = await alice.get('/api/admin/logs?lines=100');
    expect(everything.body.lines).toEqual(['first', 'second', 'third']);
    const bad = await alice.get('/api/admin/logs?lines=0');
    expect(bad.status).toBe(400);
  });

  test('emoji creation validates upload purpose and asset deletion works', async () => {
    const server = startTestServer();
    const [alice] = await makeUsers(server, ['alice']) as [Client];
    const fixture = seedServer(server, alice.userId, [], 'Emoji Slop');
    const emojiUpload = seedUpload(server, alice.userId, 'emoji', 20);
    const attachmentUpload = seedUpload(server, alice.userId, 'attachment', 20);

    const created = await alice.post('/api/admin/emojis', { name: 'slop_hueh', uploadId: emojiUpload.id, serverId: fixture.serverId });
    expect(created.status).toBe(200);
    expect(created.body.emoji.serverId).toBe(fixture.serverId);
    expect(created.body.emoji.url).toBe(`/api/media/uploads/${emojiUpload.id}`);
    const duplicate = await alice.post('/api/admin/emojis', { name: 'slop_hueh', uploadId: emojiUpload.id, serverId: fixture.serverId });
    expect(duplicate.status).toBe(409);
    const wrongPurpose = await alice.post('/api/admin/emojis', { name: 'bad_emoji', uploadId: attachmentUpload.id });
    expect(wrongPurpose.status).toBe(400);
    const badName = await alice.post('/api/admin/emojis', { name: 'no spaces!', uploadId: emojiUpload.id });
    expect(badName.status).toBe(400);
    const badServer = await alice.post('/api/admin/emojis', { name: 'other_emoji', uploadId: emojiUpload.id, serverId: 'srv_ghost' });
    expect(badServer.status).toBe(400);

    const emojis = await alice.get('/api/admin/emojis');
    expect(emojis.body.emojis).toHaveLength(1);
    expect(emojis.body.emojis[0].url).toBe(`/api/media/uploads/${emojiUpload.id}`);

    const stickerId = uid('stk');
    server.runtime.db.run(
      `INSERT INTO stickers (id, server_id, name, path, tags, uploader_id, created_at) VALUES (?, ?, 'slop_sticker', ?, '["slop"]', ?, ?)`,
      stickerId, fixture.serverId, emojiUpload.rel, alice.userId, Date.now(),
    );
    const soundId = uid('snd');
    server.runtime.db.run(
      `INSERT INTO sounds (id, server_id, name, path, emoji, uploader_id, created_at) VALUES (?, ?, 'airhorn', ?, '📢', ?, ?)`,
      soundId, fixture.serverId, emojiUpload.rel, alice.userId, Date.now(),
    );
    const assets = await alice.get('/api/admin/assets');
    expect(assets.status).toBe(200);
    expect(assets.body.emojis).toHaveLength(1);
    expect(assets.body.stickers).toHaveLength(1);
    expect(assets.body.stickers[0].tags).toEqual(['slop']);
    expect(assets.body.sounds).toHaveLength(1);
    expect(assets.body.sounds[0].emoji).toBe('📢');

    const deleteSticker = await alice.delete(`/api/admin/assets/stickers/${stickerId}`);
    expect(deleteSticker.status).toBe(200);
    const deleteSound = await alice.delete(`/api/admin/assets/sounds/${soundId}`);
    expect(deleteSound.status).toBe(200);
    const deleteEmoji = await alice.delete(`/api/admin/emojis/${created.body.emoji.id}`);
    expect(deleteEmoji.status).toBe(200);
    const missingAsset = await alice.delete(`/api/admin/assets/stickers/${stickerId}`);
    expect(missingAsset.status).toBe(404);
  });

  test('maintenance actions run safely and announcements notify active users', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']) as [Client, Client];
    const db = server.runtime.db;

    db.run('INSERT INTO login_attempts (ip_hash, username, success, created_at) VALUES (?, ?, 0, ?)', 'oldhash', 'ghost', Date.now() - 40 * 86_400_000);
    const pruned = await alice.post('/api/admin/maintenance', { action: 'prune_login_attempts' });
    expect(pruned.status).toBe(200);
    expect(pruned.body.removed).toBe(1);

    const orphan = seedUpload(server, alice.userId, 'attachment', 10);
    db.run('UPDATE uploads SET created_at = ? WHERE id = ?', Date.now() - 2 * 86_400_000, orphan.id);
    const cleaned = await alice.post('/api/admin/maintenance', { action: 'cleanup_orphan_uploads' });
    expect(cleaned.status).toBe(200);
    expect(cleaned.body.rowsRemoved).toBe(1);
    expect(db.get('SELECT 1 FROM uploads WHERE id = ?', orphan.id)).toBeNull();

    const vacuum = await alice.post('/api/admin/maintenance', { action: 'vacuum' });
    expect(vacuum.status).toBe(200);
    expect(typeof vacuum.body.sizeAfter).toBe('number');
    const checkpoint = await alice.post('/api/admin/maintenance', { action: 'checkpoint' });
    expect(checkpoint.status).toBe(200);
    const invalid = await alice.post('/api/admin/maintenance', { action: 'rm -rf /' });
    expect(invalid.status).toBe(400);

    const announced = await alice.post('/api/admin/announce', { title: 'Slop emergency', body: 'The goblin is loose.' });
    expect(announced.status).toBe(200);
    expect(announced.body.count).toBe(2);
    const note = db.get<{ title: string; body: string }>('SELECT title, body FROM notifications WHERE user_id = ?', bob.userId);
    expect(note?.title).toBe('Slop emergency');
    expect(note?.body).toBe('The goblin is loose.');
    const badAnnounce = await alice.post('/api/admin/announce', { title: '', body: 'x' });
    expect(badAnnounce.status).toBe(400);
    const announceAudit = await alice.get('/api/admin/audit?query=announce');
    expect(announceAudit.body.total).toBe(1);
  });
});

