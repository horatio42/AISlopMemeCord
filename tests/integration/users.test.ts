import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, newClient, makeUsers, connectWs, waitFor, type TestServer } from '../helpers';

afterAll(() => stopAllServers());

let seq = 0;
const uid = (prefix: string) => `${prefix}_t${Date.now().toString(36)}${(seq += 1).toString(36)}`;

function makeServer(t: TestServer, name: string, ownerId: string, isPublic = false): string {
  const id = uid('srv');
  t.runtime.db.run(
    'INSERT INTO servers (id, name, owner_id, member_count, is_public, created_at) VALUES (?, ?, ?, 1, ?, ?)',
    id, name, ownerId, isPublic ? 1 : 0, Date.now(),
  );
  t.runtime.db.run(
    'INSERT INTO roles (id, server_id, name, color, position, permissions, is_default, created_at) VALUES (?, ?, ?, ?, 0, ?, 1, ?)',
    uid('role'), id, '@everyone', '#99aab5', (1 << 14) | (1 << 15), Date.now(),
  );
  return id;
}

function addMember(t: TestServer, serverId: string, userId: string) {
  t.runtime.db.run('INSERT OR IGNORE INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, userId, Date.now());
}

function addChannel(t: TestServer, serverId: string | null, name: string, type = 'text'): string {
  const id = uid('ch');
  t.runtime.db.run(
    'INSERT INTO channels (id, server_id, type, name, created_at) VALUES (?, ?, ?, ?, ?)',
    id, serverId, type, name, Date.now(),
  );
  return id;
}

function addMessage(t: TestServer, input: {
  channelId: string; serverId: string | null; authorId: string; content: string;
  score?: number; encrypted?: boolean; createdAt?: number;
}): string {
  const id = uid('m');
  t.runtime.db.run(
    `INSERT INTO messages (id, channel_id, server_id, author_id, content, type, score, encrypted, created_at)
     VALUES (?, ?, ?, ?, ?, 'default', ?, ?, ?)`,
    id, input.channelId, input.serverId, input.authorId, input.content,
    input.score ?? 0, input.encrypted ? 1 : 0, input.createdAt ?? Date.now(),
  );
  return id;
}

function addUpload(t: TestServer, ownerId: string, purpose: string): string {
  const id = uid('upl');
  t.runtime.db.run(
    `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, created_at)
     VALUES (?, ?, ?, 'avatar.png', 'image/png', 128, 'uploads/avatar.png', 'deadbeef', ?)`,
    id, ownerId, purpose, Date.now(),
  );
  return id;
}

async function publicJwkJson(): Promise<{ jwk: string; jwkObject: Record<string, string> }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey as CryptoKey);
  const jwkObject = exported as Record<string, string>;
  return { jwk: JSON.stringify(exported), jwkObject };
}

describe('users: health and search', () => {
  test('health is public and leaks nothing sensitive', async () => {
    const server = startTestServer();
    const anon = newClient(server);
    const res = await anon.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe(server.runtime.config.version);
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.dbPath).toBeUndefined();
    expect(res.body.users).toBeUndefined();
    const search = await anon.get('/api/users/search?q=alice');
    expect(search.status).toBe(401);
  });

  test('search requires 2 chars, filters disabled users, overlays presence', async () => {
    const server = startTestServer();
    const [alice, bob, bobby] = await makeUsers(server, ['alice', 'bob', 'bobby']);
    const short = await alice!.get('/api/users/search?q=a');
    expect(short.status).toBe(400);
    expect(short.body.fields.q).toBeString();
    const found = await alice!.get('/api/users/search?q=bo');
    expect(found.status).toBe(200);
    expect(found.body.users.map((u: { username: string }) => u.username)).toEqual(['bob', 'bobby']);
    expect(found.body.users[0].passwordHash).toBeUndefined();
    const limited = await alice!.get('/api/users/search?q=bo&limit=1');
    expect(limited.body.users.length).toBe(1);
    const badLimit = await alice!.get('/api/users/search?q=bo&limit=0');
    expect(badLimit.status).toBe(400);
    const pct = await alice!.get('/api/users/search?q=%25%25');
    expect(pct.status).toBe(200);
    expect(pct.body.users.length).toBe(0);
    server.runtime.db.run('UPDATE users SET disabled = 1 WHERE id = ?', bob!.userId);
    const afterDisable = await alice!.get('/api/users/search?q=bo');
    expect(afterDisable.body.users.map((u: { username: string }) => u.username)).toEqual(['bobby']);
    server.runtime.db.run('UPDATE users SET status = ? WHERE id = ?', 'invisible', bobby!.userId);
    const overlay = await alice!.get('/api/users/search?q=bobby');
    expect(overlay.body.users[0].status).toBe('offline');
    const self = await bobby!.get('/api/users/search?q=bobby');
    expect(self.body.users[0].status).toBe('invisible');
  });
});

describe('users: public profile privacy', () => {
  test('only shows messages the viewer may read, never encrypted or private-server slop', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const t = server.runtime;
    const privateServer = makeServer(server, 'Private Slop', bob!.userId, false);
    const publicServer = makeServer(server, 'Public Slop', bob!.userId, true);
    addMember(server, privateServer, bob!.userId);
    addMember(server, publicServer, bob!.userId);
    const privateChannel = addChannel(server, privateServer, 'secret-cave');
    const publicChannel = addChannel(server, publicServer, 'general');
    const privMsg = addMessage(server, { channelId: privateChannel, serverId: privateServer, authorId: bob!.userId, content: 'private slop', score: 100 });
    const pubMsg = addMessage(server, { channelId: publicChannel, serverId: publicServer, authorId: bob!.userId, content: 'public slop', score: 50 });
    addMessage(server, { channelId: publicChannel, serverId: publicServer, authorId: bob!.userId, content: 'encrypted secret', score: 90, encrypted: true });
    t.db.run('INSERT INTO achievements (user_id, key, earned_at) VALUES (?, ?, ?)', bob!.userId, 'first_message', Date.now());
    t.db.run('INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      uid('f'), alice!.userId, bob!.userId, 'pending', Date.now(), Date.now());

    let res = await alice!.get(`/api/users/${bob!.userId}`);
    expect(res.status).toBe(200);
    const profile = res.body.profile;
    expect(profile.id).toBe(bob!.userId);
    expect(profile.password_hash).toBeUndefined();
    expect(profile.sessions).toBeUndefined();
    expect(profile.friendStatus).toBe('pending_out');
    expect(profile.serverIds).toEqual([]);
    expect(profile.topMessages.map((m: { id: string }) => m.id)).toEqual([pubMsg]);
    expect(profile.topMessages[0].content).toBe('public slop');
    expect(profile.achievements[0]).toMatchObject({ key: 'first_message', name: 'Hello, Slop', earnedAt: expect.any(Number) });

    t.db.run("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?", alice!.userId, bob!.userId);
    res = await alice!.get(`/api/users/${bob!.userId}`);
    expect(res.body.profile.friendStatus).toBe('friends');

    t.db.run('INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', alice!.userId, bob!.userId, Date.now());
    res = await alice!.get(`/api/users/${bob!.userId}`);
    expect(res.body.profile.friendStatus).toBe('blocked');
    t.db.run('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', alice!.userId, bob!.userId);
    t.db.run('INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', bob!.userId, alice!.userId, Date.now());
    res = await alice!.get(`/api/users/${bob!.userId}`);
    expect(res.body.profile.friendStatus).toBe('blocked_by');

    addMember(server, privateServer, alice!.userId);
    res = await alice!.get(`/api/users/${bob!.userId}`);
    expect(res.body.profile.topMessages[0].id).toBe(privMsg);
    expect(res.body.profile.serverIds).toContain(privateServer);
    expect(res.body.profile.topMessages.some((m: { id: string }) => m.id === pubMsg)).toBe(true);
    expect(res.body.profile.topMessages.some((m: { content: string }) => m.content === 'encrypted secret')).toBe(false);

    t.db.run("UPDATE users SET status = 'invisible' WHERE id = ?", bob!.userId);
    res = await alice!.get(`/api/users/${bob!.userId}`);
    expect(res.body.profile.status).toBe('offline');
    const self = await bob!.get(`/api/users/${bob!.userId}`);
    expect(self.body.profile.status).toBe('invisible');

    const missing = await alice!.get('/api/users/u_doesnotexist');
    expect(missing.status).toBe(404);
  });
});

describe('users: profile update validation and realtime fanout', () => {
  test('rejects cooked values, persists theme/banner/avatar, broadcasts USER_UPDATE', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const t = server.runtime;

    expect((await bob!.patch('/api/users/@me', { bio: 'x'.repeat(501) })).status).toBe(400);
    expect((await bob!.patch('/api/users/@me', { pronouns: 'p'.repeat(41) })).status).toBe(400);
    expect((await bob!.patch('/api/users/@me', { customStatus: 'c'.repeat(129) })).status).toBe(400);
    expect((await bob!.patch('/api/users/@me', { displayName: '' })).status).toBe(400);
    const badTheme = await bob!.patch('/api/users/@me', { theme: 'neon-vaporwave' });
    expect(badTheme.status).toBe(400);
    expect(badTheme.body.fields.theme).toBeString();
    expect((await bob!.patch('/api/users/@me', { bannerColor: 'red' })).status).toBe(400);
    expect((await bob!.patch('/api/users/@me', { avatar: '/etc/passwd' })).status).toBe(400);
    expect((await bob!.patch('/api/users/@me', { avatar: 'https://evil.example/x.png' })).status).toBe(400);

    const foreignAvatar = addUpload(server, alice!.userId, 'avatar');
    // Not owned by bob: must be rejected.
    expect((await bob!.patch('/api/users/@me', { avatar: `/api/media/uploads/${foreignAvatar}` })).status).toBe(400);
    const ownUploadId = addUpload(server, bob!.userId, 'attachment');
    expect((await bob!.patch('/api/users/@me', { avatar: `/api/media/uploads/${ownUploadId}` })).status).toBe(400);
    t.db.run("UPDATE uploads SET purpose = 'avatar' WHERE id = ?", ownUploadId);

    const serverId = makeServer(server, 'Shared Slop', alice!.userId);
    addMember(server, serverId, alice!.userId);
    addMember(server, serverId, bob!.userId);
    const aliceWs = await connectWs(alice!, server);
    const updatePromise = waitFor<{ t: string; d: { user: { id: string; displayName: string; theme: string; avatar: string } } }>(
      aliceWs, (msg) => msg.t === 'USER_UPDATE' && msg.d?.user?.id === bob!.userId,
    );

    const updated = await bob!.patch('/api/users/@me', {
      displayName: 'Bob the Slop',
      bio: 'Professional goblin.',
      pronouns: 'he/they/slop',
      bannerColor: '#aabbcc',
      theme: 'terminal',
      customStatus: 'touching grass (not)',
      avatar: `/api/media/uploads/${ownUploadId}`,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.user).toMatchObject({
      displayName: 'Bob the Slop', bio: 'Professional goblin.', pronouns: 'he/they/slop',
      bannerColor: '#aabbcc', theme: 'terminal', customStatus: 'touching grass (not)',
      avatar: `/api/media/uploads/${ownUploadId}`,
    });
    const event = await updatePromise;
    expect(event.d.user.displayName).toBe('Bob the Slop');
    expect(event.d.user.theme).toBe('terminal');
    aliceWs.close();

    const cleared = await bob!.patch('/api/users/@me', { bio: null, avatar: null, bannerColor: null });
    expect(cleared.body.user.bio).toBeNull();
    expect(cleared.body.user.avatar).toBeNull();
    expect(cleared.body.user.bannerColor).toBeNull();
  });

  test('presence updates broadcast over WS and invisible becomes offline for others', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const serverId = makeServer(server, 'Presence Pen', bob!.userId);
    addMember(server, serverId, alice!.userId);
    addMember(server, serverId, bob!.userId);
    const aliceWs = await connectWs(alice!, server);
    const bobWs = await connectWs(bob!, server);

    const online = waitFor<{ t: string; d: { userId: string; status: string } }>(
      aliceWs, (msg) => msg.t === 'PRESENCE_UPDATE' && msg.d?.userId === bob!.userId && msg.d.status === 'online',
    );
    const res = await bob!.put('/api/users/@me/presence', { status: 'online', customStatus: 'vibing' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('online');
    expect(res.body.user.customStatus).toBe('vibing');
    expect((await online).d.status).toBe('online');

    const hidden = waitFor<{ t: string; d: { userId: string; status: string } }>(
      aliceWs, (msg) => msg.t === 'PRESENCE_UPDATE' && msg.d?.userId === bob!.userId && msg.d.status === 'offline',
    );
    const invisible = await bob!.put('/api/users/@me/presence', { status: 'invisible' });
    expect(invisible.status).toBe(200);
    expect(invisible.body.user.status).toBe('invisible');
    expect((await hidden).d.status).toBe('offline');
    expect((await alice!.get(`/api/users/${bob!.userId}`)).body.profile.status).toBe('offline');
    const search = await alice!.get('/api/users/search?q=bob');
    expect(search.body.users[0].status).toBe('offline');

    const bad = await bob!.put('/api/users/@me/presence', { status: 'dancing' });
    expect(bad.status).toBe(400);
    aliceWs.close();
    bobWs.close();
  });
});

describe('users: E2EE public keys', () => {
  test('accepts a public P-256 JWK and rejects any private material', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const { jwk, jwkObject } = await publicJwkJson();

    expect((await bob!.post('/api/users/@me/keys', { publicKey: 'not json' })).status).toBe(400);
    expect((await bob!.post('/api/users/@me/keys', { publicKey: JSON.stringify({ ...jwkObject, d: 'cHJpdmF0ZQ' }) })).status).toBe(400);
    expect((await bob!.post('/api/users/@me/keys', { publicKey: JSON.stringify({ ...jwkObject, kty: 'RSA' }) })).status).toBe(400);
    expect((await bob!.post('/api/users/@me/keys', { publicKey: JSON.stringify({ ...jwkObject, crv: 'P-384' }) })).status).toBe(400);
    expect((await bob!.post('/api/users/@me/keys', { publicKey: 'x'.repeat(2001) })).status).toBe(400);
    expect((await bob!.post('/api/users/@me/keys', {})).status).toBe(400);

    const stored = await bob!.post('/api/users/@me/keys', { publicKey: jwk });
    expect(stored.status).toBe(200);
    const parsed = JSON.parse(stored.body.publicKey);
    expect(parsed).toEqual({ kty: 'EC', crv: 'P-256', x: jwkObject.x, y: jwkObject.y });
    expect(parsed.d).toBeUndefined();

    const fetched = await alice!.get(`/api/users/${bob!.userId}/public-key`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.publicKey).toBe(stored.body.publicKey);
    const missing = await alice!.get('/api/users/u_nope/public-key');
    expect(missing.status).toBe(404);

    const cleared = await bob!.post('/api/users/@me/keys', { publicKey: null });
    expect(cleared.body.publicKey).toBeNull();
    const after = await alice!.get(`/api/users/${bob!.userId}/public-key`);
    expect(after.body.publicKey).toBeNull();
  });
});

describe('users: saved messages', () => {
  test('lists only my saves, newest save first', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const channel = addChannel(server, null, 'dm', 'dm');
    const older = addMessage(server, { channelId: channel, serverId: null, authorId: bob!.userId, content: 'save me first' });
    const newer = addMessage(server, { channelId: channel, serverId: null, authorId: bob!.userId, content: 'save me second' });
    const notSaved = addMessage(server, { channelId: channel, serverId: null, authorId: bob!.userId, content: 'uninteresting' });
    server.runtime.db.run('INSERT INTO saved_messages (user_id, message_id, created_at) VALUES (?, ?, ?)', alice!.userId, older, 1000);
    server.runtime.db.run('INSERT INTO saved_messages (user_id, message_id, created_at) VALUES (?, ?, ?)', alice!.userId, newer, 2000);
    server.runtime.db.run('INSERT INTO saved_messages (user_id, message_id, created_at) VALUES (?, ?, ?)', bob!.userId, notSaved, 3000);

    const res = await alice!.get('/api/users/@me/saved');
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { id: string }) => m.id)).toEqual([newer, older]);
    expect(res.body.messages[0].saved).toBe(true);
    const bobSaves = await bob!.get('/api/users/@me/saved');
    expect(bobSaves.body.messages.map((m: { id: string }) => m.id)).toEqual([notSaved]);
  });
});

describe('users: achievements and leaderboards', () => {
  test('decorates earned achievements and exposes defs plus leaderboard', async () => {
    const server = startTestServer();
    const [alice, bob] = await makeUsers(server, ['alice', 'bob']);
    const t = server.runtime;
    t.db.run('INSERT INTO achievements (user_id, key, earned_at) VALUES (?, ?, ?)', bob!.userId, 'first_message', 111);
    t.db.run('INSERT INTO achievements (user_id, key, earned_at) VALUES (?, ?, ?)', bob!.userId, 'based', 222);

    const mine = await alice!.get('/api/users/@me/achievements');
    expect(mine.status).toBe(200);
    expect(mine.body.achievements[0]).toMatchObject({ key: 'founder', name: 'Founder', emoji: expect.any(String), earnedAt: expect.any(Number) });

    const all = await alice!.get('/api/achievements');
    expect(all.status).toBe(200);
    expect(all.body.achievements.length).toBe(15);
    expect(all.body.achievements[0].key).toBe('founder');
    expect(all.body.leaderboard[0].user.id).toBe(bob!.userId);
    expect(all.body.leaderboard[0].count).toBe(2);
    expect(all.body.leaderboard[0].user.password_hash).toBeUndefined();
    expect(all.body.mine.map((a: { key: string }) => a.key)).toContain('founder');

    const bobMine = await bob!.get('/api/users/@me/achievements');
    expect(bobMine.body.achievements.map((a: { key: string }) => a.key)).toEqual(['based', 'first_message']);
  });

  test('karma leaderboard: all-time users.karma, ranged vote sums, current user included', async () => {
    const server = startTestServer();
    const [alice, bob, carol, dave] = await makeUsers(server, ['alice', 'bob', 'carol', 'dave']);
    const t = server.runtime;
    t.db.run('UPDATE users SET karma = 50 WHERE id = ?', bob!.userId);
    t.db.run('UPDATE users SET karma = 20 WHERE id = ?', carol!.userId);
    t.db.run('UPDATE users SET karma = 5 WHERE id = ?', alice!.userId);
    t.db.run('UPDATE users SET karma = 0 WHERE id = ?', dave!.userId);
    const channel = addChannel(server, null, 'scoreboard', 'dm');
    const recent = addMessage(server, { channelId: channel, serverId: null, authorId: bob!.userId, content: 'banger', score: 3 });
    const old = addMessage(server, {
      channelId: channel, serverId: null, authorId: bob!.userId, content: 'ancient', score: 9, createdAt: Date.now() - 40 * 86400_000,
    });
    addMessage(server, { channelId: channel, serverId: null, authorId: bob!.userId, content: 'third', score: 0 });
    t.db.run('INSERT INTO votes (message_id, user_id, value, created_at) VALUES (?, ?, 3, ?)', recent, alice!.userId, Date.now());
    t.db.run('INSERT INTO votes (message_id, user_id, value, created_at) VALUES (?, ?, 9, ?)', old, carol!.userId, Date.now());

    const all = await alice!.get('/api/leaderboard?range=all&limit=2');
    expect(all.status).toBe(200);
    expect(all.body.entries.length).toBe(3);
    expect(all.body.entries[0]).toMatchObject({ rank: 1, karma: 50 });
    expect(all.body.entries[0].user.id).toBe(bob!.userId);
    expect(all.body.entries[0].messageCount).toBe(3);
    expect(all.body.entries[1].user.id).toBe(carol!.userId);
    const mine = all.body.entries.find((e: { user: { id: string } }) => e.user.id === alice!.userId);
    expect(mine).toBeTruthy();
    expect(mine.rank).toBe(3);

    const week = await carol!.get('/api/leaderboard?range=week');
    const top = week.body.entries[0];
    expect(top.user.id).toBe(bob!.userId);
    expect(top.karma).toBe(3);
    expect(top.messageCount).toBe(2);
    expect(week.body.entries.some((e: { user: { id: string } }) => e.user.id === carol!.userId)).toBe(true);

    const month = await alice!.get('/api/leaderboard?range=month&limit=1');
    expect(month.body.entries[0].karma).toBe(3);
    expect((await alice!.get('/api/leaderboard?range=decade')).status).toBe(400);
    expect((await alice!.get('/api/leaderboard?limit=999')).status).toBe(400);
  });
});


