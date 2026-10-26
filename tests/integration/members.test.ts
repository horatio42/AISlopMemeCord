import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, newClient, makeUsers, connectWs, waitFor, type TestServer, type Client } from '../helpers';
import { Perm, DEFAULT_EVERYONE } from '../../src/shared/permissions';
import { newId } from '../../src/server/util/ids';

afterAll(() => stopAllServers());

const MOD_PERMISSIONS =
  Perm.KICK_MEMBERS | Perm.BAN_MEMBERS | Perm.MODERATE_MEMBERS | Perm.MANAGE_MESSAGES |
  Perm.VIEW_AUDIT_LOG | Perm.MANAGE_ROLES | Perm.MANAGE_NICKNAMES | Perm.CHANGE_NICKNAME;
const PEER_PERMISSIONS =
  Perm.KICK_MEMBERS | Perm.BAN_MEMBERS | Perm.MODERATE_MEMBERS | Perm.MANAGE_MESSAGES | Perm.VIEW_AUDIT_LOG;
const JUNIOR_PERMISSIONS =
  Perm.KICK_MEMBERS | Perm.BAN_MEMBERS | Perm.MODERATE_MEMBERS | Perm.MANAGE_MESSAGES | Perm.VIEW_AUDIT_LOG | Perm.MANAGE_NICKNAMES;

interface Fixture {
  serverId: string;
  channelId: string;
  roles: { everyone: string; member: string; junior: string; peer: string; mod: string };
}

/**
 * Seeds a full server via DB fixtures so this slice's tests never depend on sibling route
 * slices (server creation/invites/messages) being finished.
 */
function createFixture(ts: TestServer, users: Client[], opts: { everyonePermissions?: number } = {}): Fixture {
  const db = ts.runtime.db;
  const serverId = newId('s');
  const channelId = newId('c');
  const now = Date.now();
  const alice = users[0]!;
  const bob = users[1]!;
  const carol = users[2]!;
  const dave = users[3]!;
  const evan = users[4]!;
  const roles = {
    everyone: newId('r'), member: newId('r'), junior: newId('r'), peer: newId('r'), mod: newId('r'),
  };
  db.run(
    `INSERT INTO servers (id, name, owner_id, member_count, system_channel_id, created_at) VALUES (?, 'Slop HQ', ?, 5, ?, ?)`,
    serverId, alice.userId, channelId, now,
  );
  db.run(
    `INSERT INTO channels (id, server_id, type, name, position, created_at) VALUES (?, ?, 'text', 'general', 0, ?)`,
    channelId, serverId, now,
  );
  const insertRole = (id: string, name: string, position: number, permissions: number, hoist: number, isDefault = 0) => {
    db.run(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
       VALUES (?, ?, ?, '#99aab5', ?, ?, 0, ?, ?, ?)`,
      id, serverId, name, position, permissions, hoist, isDefault, now,
    );
  };
  insertRole(roles.everyone, '@everyone', 0, opts.everyonePermissions ?? DEFAULT_EVERYONE, 0, 1);
  insertRole(roles.member, 'Member', 10, 0, 1);
  insertRole(roles.junior, 'Junior Mod', 20, JUNIOR_PERMISSIONS, 0);
  insertRole(roles.peer, 'Peer', 50, PEER_PERMISSIONS, 0);
  insertRole(roles.mod, 'Mod', 50, MOD_PERMISSIONS, 1);

  const joinedAt = 1000;
  users.forEach((user, index) => {
    db.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, user.userId, joinedAt + index * 1000);
  });
  const assign = (userId: string, roleId: string) => {
    db.run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', serverId, userId, roleId);
  };
  assign(bob.userId, roles.mod);
  assign(carol.userId, roles.member);
  assign(carol.userId, roles.peer);
  assign(dave.userId, roles.junior);
  assign(evan.userId, roles.member);
  return { serverId, channelId, roles };
}

interface ListedMember {
  user: { id: string; username: string; status: string };
  nickname: string | null;
  roles: string[];
  joinedAt: number;
  timeoutUntil: number | null;
}
interface MemberGroup { roleId: string | null; roleName: string; color: string; members: ListedMember[] }
interface MemberListBody { members: ListedMember[]; total: number; groups?: MemberGroup[] }
interface MemberBody { member: ListedMember }

function insertMessage(ts: TestServer, fx: Fixture, authorId: string, content: string, createdAt = Date.now()): string {
  const id = newId('m');
  ts.runtime.db.run(
    `INSERT INTO messages (id, channel_id, server_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id, fx.channelId, fx.serverId, authorId, content, createdAt,
  );
  return id;
}

function insertReport(ts: TestServer, fx: Fixture, input: { reporterId: string; targetUserId: string | null; messageId: string | null; reason: string }): string {
  const id = newId('rp');
  ts.runtime.db.run(
    `INSERT INTO reports (id, server_id, reporter_id, target_user_id, message_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    id, fx.serverId, input.reporterId, input.targetUserId, input.messageId, input.reason, Date.now(),
  );
  return id;
}

function auditActions(ts: TestServer, serverId: string): string[] {
  return ts.runtime.db.all<{ action: string }>('SELECT action FROM audit_logs WHERE server_id = ? ORDER BY created_at DESC, id DESC', serverId).map((r) => r.action);
}

describe('members: listing, presence, search, groups', () => {
  test('lists members with presence overlay, search, cursor pagination and hoist groups', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);

    const anon = newClient(ts);
    expect((await anon.get(`/api/servers/${fx.serverId}/members`)).status).toBe(401);

    const list = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(5);
    expect(list.body.members.map((m) => m.user.username).sort()).toEqual(['alice', 'bob', 'carol', 'dave', 'evan']);
    expect(list.body.members.every((m) => m.user.status === 'offline')).toBe(true);
    expect(list.body.groups).toBeUndefined();

    const searched = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?query=car`);
    expect(searched.body.total).toBe(1);
    expect(searched.body.members[0]!.user.id).toBe(carol!.userId);
    expect(searched.body.members[0]!.roles).toContain(fx.roles.peer);

    const first = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?limit=2`);
    expect(first.body.members.length).toBe(2);
    expect(first.body.total).toBe(5);
    const anchor = first.body.members[1]!.user.id;
    const next = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?limit=2&after=${anchor}`);
    expect(next.body.members.length).toBe(2);
    expect(next.body.members.some((m) => m.user.id === anchor)).toBe(false);

    const grouped = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?grouped=1`);
    expect(grouped.status).toBe(200);
    const names = grouped.body.groups!.map((g) => g.roleName);
    expect(names).toContain('Mod');
    expect(names).toContain('Member');
    expect(names).toContain('No Role');
    const modGroup = grouped.body.groups!.find((g) => g.roleName === 'Mod')!;
    expect(modGroup.members.map((m) => m.user.id)).toEqual([bob!.userId]);
    const noRole = grouped.body.groups!.find((g) => g.roleName === 'No Role')!;
    expect(noRole.members.map((m) => m.user.id).sort()).toEqual([alice!.userId, dave!.userId].sort());

    // A non-member without instance admin sees nothing.
    const outsider = newClient(ts);
    const registered = await outsider.register('frank', 'password123');
    expect(registered.status).toBe(200);
    expect((await outsider.get(`/api/servers/${fx.serverId}/members`)).status).toBe(404);

    // Presence overlay reflects a live websocket.
    const ws = await connectWs(bob!, ts);
    try {
      const withPresence = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?query=bob`);
      expect(withPresence.body.members[0]!.user.status).toBe('online');
    } finally {
      ws.close();
    }
  });
});

describe('members: nickname and role assignment hierarchy', () => {
  test('self nickname needs CHANGE_NICKNAME, others need MANAGE_NICKNAMES and hierarchy', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);

    const own = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${bob!.userId}`, { nickname: 'Bob the Slop' });
    expect(own.status).toBe(200);
    expect(own.body.member.nickname).toBe('Bob the Slop');

    // Remove CHANGE_NICKNAME from @everyone so a plain member loses self-service nicknames.
    ts.runtime.db.run('UPDATE roles SET permissions = ? WHERE id = ?', DEFAULT_EVERYONE & ~Perm.CHANGE_NICKNAME, fx.roles.everyone);
    const deniedSelf = await evan!.patch(`/api/servers/${fx.serverId}/members/${evan!.userId}`, { nickname: 'Sneaky' });
    expect(deniedSelf.status).toBe(403);
    expect(deniedSelf.body.error).toBe('MISSING_PERMISSIONS');

    const renamed = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { nickname: 'Davelopment' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.member.nickname).toBe('Davelopment');
    expect(ts.runtime.db.get<{ nickname: string }>('SELECT nickname FROM members WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId)?.nickname).toBe('Davelopment');

    // Equal top role: hierarchy denies.
    const peerRename = await bob!.patch(`/api/servers/${fx.serverId}/members/${carol!.userId}`, { nickname: 'Nope' });
    expect(peerRename.status).toBe(403);
    expect(peerRename.body.error).toBe('ROLE_HIERARCHY');

    // Owner is untouchable.
    const ownerRename = await bob!.patch(`/api/servers/${fx.serverId}/members/${alice!.userId}`, { nickname: 'Puppet' });
    expect(ownerRename.status).toBe(403);
    expect(ownerRename.body.error).toBe('CANNOT_ACT_ON_OWNER');

    // Missing MANAGE_NICKNAMES.
    const carolRename = await carol!.patch(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { nickname: 'Mutiny' });
    expect(carolRename.status).toBe(403);
    expect(carolRename.body.error).toBe('MISSING_PERMISSIONS');

    // Clearing a nickname with null works.
    const cleared = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { nickname: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.member.nickname).toBeNull();

    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_UPDATE');
  });

  test('role assignment enforces hierarchy, grants and self-protection', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);

    const peerAssign = await bob!.patch(`/api/servers/${fx.serverId}/members/${evan!.userId}`, { roles: [fx.roles.peer] });
    expect(peerAssign.status).toBe(403);
    expect(peerAssign.body.error).toBe('ROLE_HIERARCHY');

    const validAssign = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${evan!.userId}`, { roles: [fx.roles.member, fx.roles.junior] });
    expect(validAssign.status).toBe(200);
    expect(validAssign.body.member.roles.sort()).toEqual([fx.roles.member, fx.roles.junior].sort());

    const unknownRole = await bob!.patch(`/api/servers/${fx.serverId}/members/${evan!.userId}`, { roles: ['r_missing'] });
    expect(unknownRole.status).toBe(400);
    expect(unknownRole.body.error).toBe('INVALID_ROLE');

    const everyoneAssign = await bob!.patch(`/api/servers/${fx.serverId}/members/${evan!.userId}`, { roles: [fx.roles.everyone] });
    expect(everyoneAssign.status).toBe(400);

    const selfRoles = await bob!.patch(`/api/servers/${fx.serverId}/members/${bob!.userId}`, { roles: [fx.roles.mod] });
    expect(selfRoles.status).toBe(403);
    expect(selfRoles.body.error).toBe('CANNOT_MODIFY_SELF_ROLES');

    // Owner may touch their own roles.
    const ownerSelf = await alice!.patch(`/api/servers/${fx.serverId}/members/${alice!.userId}`, { roles: [fx.roles.member] });
    expect(ownerSelf.status).toBe(200);

    // A role's permission bits cannot be handed out by someone who lacks them.
    const createAdmin = await bob!.post(`/api/servers/${fx.serverId}/roles`, { name: 'Coup', permissions: Perm.ADMINISTRATOR });
    expect(createAdmin.status).toBe(403);
    expect(createAdmin.body.error).toBe('PRIVILEGE_ESCALATION');

    const assignMod = await bob!.patch(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { roles: [fx.roles.mod] });
    expect(assignMod.status).toBe(403);
    expect(assignMod.body.error).toBe('ROLE_HIERARCHY');

    const carolAssign = await carol!.patch(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { roles: [] });
    expect(carolAssign.status).toBe(403);
    expect(carolAssign.body.error).toBe('MISSING_PERMISSIONS');
  });
});

describe('members: timeouts', () => {
  test('sets, broadcasts and clears timeouts; message sending is blocked while timed out', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const db = ts.runtime.db;

    const until = Date.now() + 60_000;
    const timed = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { timeoutUntil: until });
    expect(timed.status).toBe(200);
    expect(timed.body.member.timeoutUntil).toBe(until);
    expect(db.get<{ timeout_until: number | null }>(
      'SELECT timeout_until FROM members WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId,
    )?.timeout_until).toBe(until);
    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_TIMEOUT');
    const notice = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND server_id = ? AND type = 'system' AND title LIKE 'Timed out%'",
      dave!.userId, fx.serverId,
    );
    expect(notice?.n).toBe(1);

    const listing = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?query=dave`);
    expect(listing.body.members[0]!.timeoutUntil).toBe(until);

    // Timed-out members keep read access but the messages slice must reject new posts.
    const send = await dave!.post(`/api/channels/${fx.channelId}/messages`, { content: 'sneaky slop' });
    expect(send.status).toBe(403);
    expect(send.body.error).toBe('MEMBER_TIMED_OUT');

    const noPerm = await evan!.patch(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { timeoutUntil: until });
    expect(noPerm.status).toBe(403);
    expect(noPerm.body.error).toBe('MISSING_PERMISSIONS');

    const owner = await bob!.patch(`/api/servers/${fx.serverId}/members/${alice!.userId}`, { timeoutUntil: until });
    expect(owner.status).toBe(403);
    expect(owner.body.error).toBe('CANNOT_ACT_ON_OWNER');

    const self = await bob!.patch(`/api/servers/${fx.serverId}/members/${bob!.userId}`, { timeoutUntil: until });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('CANNOT_ACT_ON_SELF');

    const peer = await bob!.patch(`/api/servers/${fx.serverId}/members/${carol!.userId}`, { timeoutUntil: until });
    expect(peer.status).toBe(403);
    expect(peer.body.error).toBe('ROLE_HIERARCHY');

    const tooLong = await bob!.patch(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { timeoutUntil: Date.now() + 29 * 86400_000 });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe('TIMEOUT_TOO_LONG');

    const cleared = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { timeoutUntil: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.member.timeoutUntil).toBeNull();

    const after = await dave!.post(`/api/channels/${fx.channelId}/messages`, { content: 'free again' });
    expect(after.status).toBe(200);
  });
});

describe('members: kicks', () => {
  test('kicks remove membership, update counts, audit, post a system message and notify', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const db = ts.runtime.db;

    const kick = await bob!.delete(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { reason: 'Too much slop' });
    expect(kick.status).toBe(200);
    expect(kick.body.kicked).toBe(true);
    expect(db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId)).toBeNull();
    expect(db.get('SELECT 1 FROM member_roles WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId)).toBeNull();
    expect(db.get<{ member_count: number }>('SELECT member_count FROM servers WHERE id = ?', fx.serverId)?.member_count).toBe(4);
    const audit = db.get<{ action: string; reason: string }>(
      "SELECT action, reason FROM audit_logs WHERE server_id = ? AND action = 'MEMBER_KICK' ORDER BY created_at DESC LIMIT 1", fx.serverId,
    );
    expect(audit?.reason).toBe('Too much slop');
    expect(db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND type = 'system' AND content LIKE '%kicked%'`, fx.channelId,
    )?.n).toBe(1);
    expect(db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title LIKE 'Kicked from%'", dave!.userId,
    )?.n).toBe(1);

    const again = await bob!.delete(`/api/servers/${fx.serverId}/members/${dave!.userId}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('MEMBER_NOT_FOUND');

    const owner = await bob!.delete(`/api/servers/${fx.serverId}/members/${alice!.userId}`);
    expect(owner.status).toBe(403);
    expect(owner.body.error).toBe('CANNOT_ACT_ON_OWNER');

    const peer = await bob!.delete(`/api/servers/${fx.serverId}/members/${carol!.userId}`);
    expect(peer.status).toBe(403);
    expect(peer.body.error).toBe('ROLE_HIERARCHY');

    const self = await bob!.delete(`/api/servers/${fx.serverId}/members/${bob!.userId}`);
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('CANNOT_ACT_ON_SELF');

    const noPerm = await evan!.delete(`/api/servers/${fx.serverId}/members/${bob!.userId}`);
    expect(noPerm.status).toBe(403);
    expect(noPerm.body.error).toBe('MISSING_PERMISSIONS');
  });
});

describe('members: bans', () => {
  test('ban, purge, list, hierarchy guards and unban', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const db = ts.runtime.db;
    const messageId = insertMessage(ts, fx, dave!.userId, 'ban me please');

    const banned = await bob!.post(`/api/servers/${fx.serverId}/bans/${dave!.userId}`, { reason: 'Slop overload', deleteMessageSeconds: 3600 });
    expect(banned.status).toBe(200);
    expect(banned.body.removed).toBe(true);
    expect(banned.body.deletedMessages).toBe(1);
    expect(banned.body.ban.user.id).toBe(dave!.userId);
    expect(banned.body.ban.moderator.id).toBe(bob!.userId);
    expect(banned.body.ban.reason).toBe('Slop overload');
    expect(db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId)).toBeNull();
    expect(db.get<{ deleted_at: number | null }>('SELECT deleted_at FROM messages WHERE id = ?', messageId)?.deleted_at).toBeNumber();
    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_BAN');
    expect(db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title LIKE 'Banned from%'", dave!.userId,
    )?.n).toBe(1);

    const bans = await bob!.get<{ bans: { user: { id: string }; moderator: { id: string }; reason: string; createdAt: number }[] }>(`/api/servers/${fx.serverId}/bans`);
    expect(bans.status).toBe(200);
    expect(bans.body.bans.length).toBe(1);
    expect(bans.body.bans[0]!.user.id).toBe(dave!.userId);
    expect(bans.body.bans[0]!.moderator.id).toBe(bob!.userId);
    expect(bans.body.bans[0]!.reason).toBe('Slop overload');

    const noPerm = await evan!.get(`/api/servers/${fx.serverId}/bans`);
    expect(noPerm.status).toBe(403);

    const ownerBan = await bob!.post(`/api/servers/${fx.serverId}/bans/${alice!.userId}`, {});
    expect(ownerBan.status).toBe(403);
    expect(ownerBan.body.error).toBe('CANNOT_ACT_ON_OWNER');

    const selfBan = await bob!.post(`/api/servers/${fx.serverId}/bans/${bob!.userId}`, {});
    expect(selfBan.status).toBe(403);
    expect(selfBan.body.error).toBe('CANNOT_ACT_ON_SELF');

    const peerBan = await bob!.post(`/api/servers/${fx.serverId}/bans/${carol!.userId}`, {});
    expect(peerBan.status).toBe(403);
    expect(peerBan.body.error).toBe('ROLE_HIERARCHY');

    const ghostBan = await bob!.post(`/api/servers/${fx.serverId}/bans/u_nonexistent`, {});
    expect(ghostBan.status).toBe(404);
    expect(ghostBan.body.error).toBe('USER_NOT_FOUND');

    const badDelete = await bob!.post(`/api/servers/${fx.serverId}/bans/${evan!.userId}`, { deleteMessageSeconds: 604801 });
    expect(badDelete.status).toBe(400);
    expect(badDelete.body.error).toBe('VALIDATION_ERROR');

    const unbanned = await bob!.delete(`/api/servers/${fx.serverId}/bans/${dave!.userId}`);
    expect(unbanned.status).toBe(200);
    expect(unbanned.body.unbanned).toBe(true);
    expect(db.get('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId)).toBeNull();
    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_UNBAN');
    const empty = await bob!.get<{ bans: unknown[] }>(`/api/servers/${fx.serverId}/bans`);
    expect(empty.body.bans.length).toBe(0);
    const again = await bob!.delete(`/api/servers/${fx.serverId}/bans/${dave!.userId}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('BAN_NOT_FOUND');
  });
});

describe('members: warnings', () => {
  test('creates, lists and deletes warnings with hierarchy, notify and audit', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const db = ts.runtime.db;

    const created = await bob!.post<{ warning: { id: string; user: { id: string }; moderator: { id: string }; reason: string } }>(
      `/api/servers/${fx.serverId}/warnings`, { userId: dave!.userId, reason: 'Excessive slop posting' },
    );
    expect(created.status).toBe(200);
    expect(created.body.warning.user.id).toBe(dave!.userId);
    expect(created.body.warning.moderator.id).toBe(bob!.userId);
    expect(created.body.warning.reason).toBe('Excessive slop posting');
    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_WARN');
    expect(db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND title LIKE 'Warning in%'", dave!.userId,
    )?.n).toBe(1);

    const listed = await bob!.get<{ warnings: { id: string; user: { id: string }; reason: string }[] }>(`/api/servers/${fx.serverId}/warnings`);
    expect(listed.status).toBe(200);
    expect(listed.body.warnings.length).toBe(1);
    expect(listed.body.warnings[0]!.id).toBe(created.body.warning.id);
    const filtered = await bob!.get<{ warnings: unknown[] }>(`/api/servers/${fx.serverId}/warnings?userId=${evan!.userId}`);
    expect(filtered.body.warnings.length).toBe(0);

    const noPerm = await evan!.get(`/api/servers/${fx.serverId}/warnings`);
    expect(noPerm.status).toBe(403);
    const postNoPerm = await evan!.post(`/api/servers/${fx.serverId}/warnings`, { userId: dave!.userId, reason: 'nope' });
    expect(postNoPerm.status).toBe(403);

    const owner = await bob!.post(`/api/servers/${fx.serverId}/warnings`, { userId: alice!.userId, reason: 'nope' });
    expect(owner.status).toBe(403);
    expect(owner.body.error).toBe('CANNOT_ACT_ON_OWNER');
    const self = await bob!.post(`/api/servers/${fx.serverId}/warnings`, { userId: bob!.userId, reason: 'nope' });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('CANNOT_ACT_ON_SELF');
    const peer = await bob!.post(`/api/servers/${fx.serverId}/warnings`, { userId: carol!.userId, reason: 'nope' });
    expect(peer.status).toBe(403);
    expect(peer.body.error).toBe('ROLE_HIERARCHY');
    const ghost = await bob!.post(`/api/servers/${fx.serverId}/warnings`, { userId: 'u_missing', reason: 'nope' });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toBe('MEMBER_NOT_FOUND');
    const noReason = await bob!.post(`/api/servers/${fx.serverId}/warnings`, { userId: dave!.userId });
    expect(noReason.status).toBe(400);

    const deleted = await bob!.delete(`/api/servers/${fx.serverId}/warnings/${created.body.warning.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    expect(db.get('SELECT 1 FROM warnings WHERE id = ?', created.body.warning.id)).toBeNull();
    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_WARNING_DELETE');
    const again = await bob!.delete(`/api/servers/${fx.serverId}/warnings/${created.body.warning.id}`);
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('WARNING_NOT_FOUND');
  });
});

interface RoleBody {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: number;
  hoist: boolean;
  mentionable: boolean;
  isDefault: boolean;
}

describe('roles: CRUD and hierarchy', () => {
  test('create, edit and delete roles within hierarchy and permission limits', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const db = ts.runtime.db;

    const created = await bob!.post<{ role: RoleBody }>(`/api/servers/${fx.serverId}/roles`, {
      name: 'Slopling', color: '#ff00ff', permissions: Perm.EMBED_LINKS, hoist: true, mentionable: true,
    });
    expect(created.status).toBe(200);
    expect(created.body.role.name).toBe('Slopling');
    expect(created.body.role.color).toBe('#ff00ff');
    expect(created.body.role.permissions).toBe(Perm.EMBED_LINKS);
    expect(created.body.role.hoist).toBe(true);
    expect(created.body.role.isDefault).toBe(false);
    expect(created.body.role.position).toBeLessThan(50);
    expect(auditActions(ts, fx.serverId)).toContain('ROLE_CREATE');

    const carolCreate = await carol!.post(`/api/servers/${fx.serverId}/roles`, { name: 'Nope' });
    expect(carolCreate.status).toBe(403);
    expect(carolCreate.body.error).toBe('MISSING_PERMISSIONS');

    const escalation = await bob!.post(`/api/servers/${fx.serverId}/roles`, { name: 'Coup', permissions: Perm.ADMINISTRATOR });
    expect(escalation.status).toBe(403);
    expect(escalation.body.error).toBe('PRIVILEGE_ESCALATION');

    const badColor = await bob!.post(`/api/servers/${fx.serverId}/roles`, { name: 'Ugly', color: 'red' });
    expect(badColor.status).toBe(400);
    const badPerm = await bob!.post(`/api/servers/${fx.serverId}/roles`, { name: 'Overflow', permissions: 0x80000000 });
    expect(badPerm.status).toBe(400);

    const patched = await bob!.patch<{ role: RoleBody }>(`/api/roles/${created.body.role.id}`, { name: 'Slopling II', color: '#00ff00' });
    expect(patched.status).toBe(200);
    expect(patched.body.role.name).toBe('Slopling II');
    expect(patched.body.role.color).toBe('#00ff00');
    expect(auditActions(ts, fx.serverId)).toContain('ROLE_UPDATE');

    const patchHigh = await bob!.patch(`/api/roles/${fx.roles.mod}`, { name: 'Mine Now' });
    expect(patchHigh.status).toBe(403);
    expect(patchHigh.body.error).toBe('ROLE_HIERARCHY');

    const patchEscalate = await bob!.patch(`/api/roles/${created.body.role.id}`, { permissions: Perm.ADMINISTRATOR });
    expect(patchEscalate.status).toBe(403);
    expect(patchEscalate.body.error).toBe('PRIVILEGE_ESCALATION');

    const deleteHigh = await bob!.delete(`/api/roles/${fx.roles.mod}`);
    expect(deleteHigh.status).toBe(403);
    const deleteDefault = await bob!.delete(`/api/roles/${fx.roles.everyone}`);
    expect(deleteDefault.status).toBe(403);
    const deleted = await bob!.delete(`/api/roles/${created.body.role.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    expect(db.get('SELECT 1 FROM roles WHERE id = ?', created.body.role.id)).toBeNull();
    expect(auditActions(ts, fx.serverId)).toContain('ROLE_DELETE');

    // Owner bypasses both the hierarchy and permission-subset guards.
    const ownerRole = await alice!.post<{ role: RoleBody }>(`/api/servers/${fx.serverId}/roles`, { name: 'Godmode', permissions: Perm.ADMINISTRATOR });
    expect(ownerRole.status).toBe(200);
    expect(ownerRole.body.role.permissions).toBe(Perm.ADMINISTRATOR);
    expect(ownerRole.body.role.position).toBeGreaterThan(50);
  });

  test('reorders role positions with hierarchy and default-role protection', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);

    const moved = await bob!.patch<{ roles: RoleBody[] }>(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.member, position: 30 }, { id: fx.roles.junior, position: 25 }],
    });
    expect(moved.status).toBe(200);
    expect(moved.body.roles.find((r) => r.id === fx.roles.member)?.position).toBe(30);
    expect(moved.body.roles.find((r) => r.id === fx.roles.junior)?.position).toBe(25);
    expect(auditActions(ts, fx.serverId)).toContain('ROLE_POSITIONS_UPDATE');

    const tooHigh = await bob!.patch(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.member, position: 50 }],
    });
    expect(tooHigh.status).toBe(403);
    expect(tooHigh.body.error).toBe('ROLE_HIERARCHY');

    const unmanageable = await bob!.patch(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.peer, position: 40 }],
    });
    expect(unmanageable.status).toBe(403);
    expect(unmanageable.body.error).toBe('ROLE_HIERARCHY');

    const everyoneMove = await bob!.patch(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.everyone, position: 1 }],
    });
    expect(everyoneMove.status).toBe(400);
    expect(everyoneMove.body.error).toBe('DEFAULT_ROLE_POSITION');

    const duplicate = await bob!.patch(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.member, position: 30 }, { id: fx.roles.junior, position: 30 }],
    });
    expect(duplicate.status).toBe(400);

    const noPerm = await carol!.patch(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.member, position: 5 }],
    });
    expect(noPerm.status).toBe(403);

    const ownerMove = await alice!.patch<{ roles: RoleBody[] }>(`/api/servers/${fx.serverId}/roles/positions`, {
      positions: [{ id: fx.roles.peer, position: 60 }],
    });
    expect(ownerMove.status).toBe(200);
  });
});

interface AuditBody {
  id: string;
  action: string;
  actor: { username: string } | null;
  targetId: string | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  createdAt: number;
}

describe('audit log', () => {
  test('lists entries with actor, filters by action and pages by before cursor', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);

    await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { nickname: 'Davey' });
    await bob!.delete(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { reason: 'audit me' });

    const log = await bob!.get<{ entries: AuditBody[] }>(`/api/servers/${fx.serverId}/audit-log`);
    expect(log.status).toBe(200);
    expect(log.body.entries.length).toBeGreaterThanOrEqual(2);
    const kick = log.body.entries.find((e) => e.action === 'MEMBER_KICK')!;
    expect(kick.actor?.username).toBe('bob');
    expect(kick.targetId).toBe(dave!.userId);
    expect(kick.reason).toBe('audit me');

    const filtered = await bob!.get<{ entries: AuditBody[] }>(`/api/servers/${fx.serverId}/audit-log?action=MEMBER_KICK&limit=1`);
    expect(filtered.body.entries.length).toBe(1);
    expect(filtered.body.entries[0]!.action).toBe('MEMBER_KICK');

    const paged = await bob!.get<{ entries: AuditBody[] }>(`/api/servers/${fx.serverId}/audit-log?limit=1&before=${filtered.body.entries[0]!.id}`);
    expect(paged.body.entries.length).toBe(1);
    expect(paged.body.entries[0]!.id).not.toBe(filtered.body.entries[0]!.id);
    expect(paged.body.entries[0]!.createdAt).toBeLessThanOrEqual(filtered.body.entries[0]!.createdAt);

    const noPerm = await evan!.get(`/api/servers/${fx.serverId}/audit-log`);
    expect(noPerm.status).toBe(403);
    expect(noPerm.body.error).toBe('MISSING_PERMISSIONS');
  });
});

interface ReportBody {
  id: string;
  status: string;
  resolution: string | null;
  reason: string;
  reporter: { id: string; username: string };
  targetUser: { id: string } | null;
  message: { id: string; content: string; deletedAt: number | null } | null;
  resolvedBy: { id: string } | null;
  resolvedAt: number | null;
}

describe('server reports', () => {
  test('lists visible reports and resolves them with actions, audit and reporter notice', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const db = ts.runtime.db;
    const messageId = insertMessage(ts, fx, dave!.userId, 'extremely cursed message');
    const report1 = insertReport(ts, fx, { reporterId: alice!.userId, targetUserId: dave!.userId, messageId, reason: 'cursed' });
    const report2 = insertReport(ts, fx, { reporterId: alice!.userId, targetUserId: carol!.userId, messageId: null, reason: 'vibes' });

    const list = await bob!.get<{ reports: ReportBody[] }>(`/api/servers/${fx.serverId}/reports`);
    expect(list.status).toBe(200);
    expect(list.body.reports.length).toBe(2);
    const first = list.body.reports.find((r) => r.id === report1)!;
    expect(first.reporter.id).toBe(alice!.userId);
    expect(first.targetUser?.id).toBe(dave!.userId);
    expect(first.message?.content).toBe('extremely cursed message');
    expect(first.status).toBe('open');

    const filtered = await bob!.get<{ reports: ReportBody[] }>(`/api/servers/${fx.serverId}/reports?status=resolved`);
    expect(filtered.body.reports.length).toBe(0);
    const badStatus = await bob!.get(`/api/servers/${fx.serverId}/reports?status=nope`);
    expect(badStatus.status).toBe(400);
    const noPerm = await evan!.get(`/api/servers/${fx.serverId}/reports`);
    expect(noPerm.status).toBe(403);

    const resolved = await bob!.patch<{ report: ReportBody }>(`/api/reports/${report1}`, {
      status: 'resolved', resolution: 'Deleted the cursed slop', action: 'delete_message',
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.report.status).toBe('resolved');
    expect(resolved.body.report.resolution).toBe('Deleted the cursed slop');
    expect(resolved.body.report.resolvedBy?.id).toBe(bob!.userId);
    expect(resolved.body.report.resolvedAt).toBeNumber();
    expect(resolved.body.report.message?.deletedAt).toBeNumber();
    expect(db.get<{ deleted_at: number | null }>('SELECT deleted_at FROM messages WHERE id = ?', messageId)?.deleted_at).toBeNumber();
    expect(auditActions(ts, fx.serverId)).toContain('REPORT_RESOLVE');
    expect(auditActions(ts, fx.serverId)).toContain('MESSAGE_DELETE');
    expect(db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'report'", alice!.userId,
    )?.n).toBe(1);

    // Hierarchy blocks actions against peers, and the report must stay open.
    const peerTimeout = await bob!.patch(`/api/reports/${report2}`, {
      status: 'resolved', action: 'timeout', durationMs: 60_000,
    });
    expect(peerTimeout.status).toBe(403);
    expect(peerTimeout.body.error).toBe('ROLE_HIERARCHY');
    expect(db.get<{ status: string }>('SELECT status FROM reports WHERE id = ?', report2)?.status).toBe('open');

    const report3 = insertReport(ts, fx, { reporterId: alice!.userId, targetUserId: dave!.userId, messageId: null, reason: 'timeout pls' });
    const timed = await bob!.patch<{ report: ReportBody }>(`/api/reports/${report3}`, {
      status: 'resolved', resolution: 'Take five', action: 'timeout', durationMs: 60_000,
    });
    expect(timed.status).toBe(200);
    expect(timed.body.report.status).toBe('resolved');
    expect(db.get<{ timeout_until: number | null }>(
      'SELECT timeout_until FROM members WHERE server_id = ? AND user_id = ?', fx.serverId, dave!.userId,
    )?.timeout_until).toBeNumber();
    expect(auditActions(ts, fx.serverId)).toContain('MEMBER_TIMEOUT');

    const report4 = insertReport(ts, fx, { reporterId: alice!.userId, targetUserId: evan!.userId, messageId: null, reason: 'ban pls' });
    const banResolved = await bob!.patch<{ report: ReportBody }>(`/api/reports/${report4}`, {
      status: 'resolved', resolution: 'Begone', action: 'ban',
    });
    expect(banResolved.status).toBe(200);
    expect(db.get('SELECT 1 FROM bans WHERE server_id = ? AND user_id = ?', fx.serverId, evan!.userId)).not.toBeNull();
    expect(db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', fx.serverId, evan!.userId)).toBeNull();

    const dismissedReport = insertReport(ts, fx, { reporterId: alice!.userId, targetUserId: null, messageId: null, reason: 'nothing' });
    const dismissed = await bob!.patch<{ report: ReportBody }>(`/api/reports/${dismissedReport}`, {
      status: 'dismissed', resolution: 'Not slop', action: 'none',
    });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.report.status).toBe('dismissed');

    const noDuration = await bob!.patch(`/api/reports/${report2}`, { status: 'resolved', action: 'timeout' });
    expect(noDuration.status).toBe(400);
    expect(noDuration.body.error).toBe('VALIDATION_ERROR');
    const badAction = await bob!.patch(`/api/reports/${report2}`, { status: 'resolved', action: 'yeet' });
    expect(badAction.status).toBe(400);
    const badResolveStatus = await bob!.patch(`/api/reports/${report2}`, { status: 'open' });
    expect(badResolveStatus.status).toBe(400);
    const missing = await bob!.patch('/api/reports/rp_missing', { status: 'resolved' });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('REPORT_NOT_FOUND');
  });
});

interface GatewayFrame {
  op: string;
  t?: string;
  d: {
    serverId?: string;
    member?: ListedMember;
    role?: RoleBody;
    userId?: string;
    reason?: string | null;
  };
}

describe('members: realtime broadcasts', () => {
  test('member/role changes fan out to connected members', async () => {
    const ts = startTestServer();
    const [alice, bob, carol, dave, evan] = await makeUsers(ts, ['alice', 'bob', 'carol', 'dave', 'evan']);
    const fx = createFixture(ts, [alice!, bob!, carol!, dave!, evan!]);
    const ws = await connectWs(carol!, ts);
    try {
      const presence = await alice!.get<MemberListBody>(`/api/servers/${fx.serverId}/members?query=carol`);
      expect(presence.body.members[0]!.user.status).toBe('online');

      const memberEvent = waitFor<GatewayFrame>(ws, (data) => data.t === 'MEMBER_UPDATE' && data.d.member?.user.id === dave!.userId);
      const renamed = await bob!.patch<MemberBody>(`/api/servers/${fx.serverId}/members/${dave!.userId}`, { nickname: 'Live Dave' });
      expect(renamed.status).toBe(200);
      const update = await memberEvent;
      expect(update.d.serverId).toBe(fx.serverId);
      expect(update.d.member?.nickname).toBe('Live Dave');

      const roleEvent = waitFor<GatewayFrame>(ws, (data) => data.t === 'ROLE_CREATE');
      const created = await bob!.post<{ role: RoleBody }>(`/api/servers/${fx.serverId}/roles`, { name: 'Live Role', permissions: Perm.SEND_MESSAGES });
      expect(created.status).toBe(200);
      const rolePayload = await roleEvent;
      expect(rolePayload.d.role?.id).toBe(created.body.role.id);

      const removeEvent = waitFor<GatewayFrame>(ws, (data) => data.t === 'MEMBER_REMOVE' && data.d.userId === evan!.userId);
      const kicked = await bob!.delete(`/api/servers/${fx.serverId}/members/${evan!.userId}`, { reason: 'live' });
      expect(kicked.status).toBe(200);
      const removal = await removeEvent;
      expect(removal.d.reason).toBe('live');
    } finally {
      ws.close();
    }
  });
});
