import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, newClient, makeUsers } from '../helpers';

afterAll(() => stopAllServers());

describe('auth', () => {
  test('first user becomes instance admin and registration is idempotent', async () => {
    const server = startTestServer();
    const alice = newClient(server);
    const res = await alice.register('alice', 'password123');
    expect(res.status).toBe(200);
    expect(res.body.user.isAdmin).toBe(true);
    expect(res.body.csrfToken).toBeString();
    const me = await alice.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('alice');
    const second = newClient(server);
    const res2 = await second.register('bob', 'password123');
    expect(res2.status).toBe(200);
    expect(res2.body.user.isAdmin).toBe(false);
  });

  test('login, wrong password, logout and csrf enforcement', async () => {
    const server = startTestServer();
    const users = await makeUsers(server, ['alice', 'bob']);
    expect(users.length).toBe(2);
    const fresh = newClient(server);
    const bad = await fresh.login('alice', 'wrong-password');
    expect(bad.status).toBe(401);
    const good = await fresh.login('alice', 'password123');
    expect(good.status).toBe(200);
    const me = await fresh.get('/api/auth/me');
    expect(me.body.user.username).toBe('alice');
    fresh.csrf = '';
    const noCsrf = await fresh.post('/api/auth/password', { currentPassword: 'password123', newPassword: 'password456' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error).toBe('CSRF_FAILED');
    fresh.csrf = good.body.csrfToken;
    const changed = await fresh.post('/api/auth/password', { currentPassword: 'password123', newPassword: 'password456' });
    expect(changed.status).toBe(200);
    const relogin = await newClient(server).login('alice', 'password456');
    expect(relogin.status).toBe(200);
    const logout = await fresh.post('/api/auth/logout');
    expect(logout.status).toBe(200);
  });

  test('unauthorized access and duplicate username', async () => {
    const server = startTestServer();
    await makeUsers(server, ['alice']);
    const anon = newClient(server);
    const res = await anon.get('/api/auth/sessions');
    expect(res.status).toBe(401);
    const dup = await newClient(server).register('ALICE', 'password123');
    expect(dup.status).toBe(409);
  });

  test('registration modes and account invites', async () => {
    const server = startTestServer();
    const admin = newClient(server);
    await admin.register('boss', 'password123');
    server.runtime.db.run("INSERT INTO settings (key, value) VALUES ('registration', '\"invite\"') ON CONFLICT(key) DO UPDATE SET value = '\"invite\"'");
    const blocked = await newClient(server).register('bob', 'password123');
    expect(blocked.status).toBe(403);
    const inviteCode = 'testinvite';
    server.runtime.db.run("INSERT INTO account_invites (code, created_by, max_uses, uses, created_at) VALUES (?, ?, 2, 0, ?)", inviteCode, admin.userId, Date.now());
    const withInvite = await newClient(server).register('bob', 'password123');
    expect(withInvite.status).toBe(403);
    const inviteClient = newClient(server);
    const ok = await inviteClient.post('/api/auth/register', { username: 'bob', password: 'password123', accountInvite: inviteCode });
    expect(ok.status).toBe(200);
    const reuse = await newClient(server).post('/api/auth/register', { username: 'carol', password: 'password123', accountInvite: inviteCode });
    expect(reuse.status).toBe(200);
    const third = await newClient(server).post('/api/auth/register', { username: 'dave', password: 'password123', accountInvite: inviteCode });
    expect(third.status).toBe(403);
  });
});
