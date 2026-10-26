import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, makeUsers, newClient, connectWs, waitFor, type Client, type TestServer } from '../helpers';
import { DEFAULT_EVERYONE, Perm } from '../../src/shared/permissions';
import type { Channel, Emoji, Invite, Message, Role, Server, ServerEvent, ServerMember, Sound, Sticker, Webhook } from '../../src/shared/types';

afterAll(() => stopAllServers());

interface ApiErrorBody { error: string; message: string; fields?: Record<string, string> }
interface CreateServerBody { server: Server; channels: Channel[]; roles: Role[]; member: ServerMember }
interface DetailBody { server: Server; channels: Channel[]; roles: Role[]; member: ServerMember | null }

function insertUpload(server: TestServer, ownerId: string, id: string, purpose: string, contentType = 'image/png') {
  server.runtime.db.run(
    `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, width, height, message_id, created_at)
     VALUES (?, ?, ?, 'upload.bin', ?, 123, '/tmp/upload.bin', 'deadbeef', NULL, NULL, NULL, ?)`,
    id, ownerId, purpose, contentType, Date.now(),
  );
}

async function setup(names: string[] = ['alice', 'bob']) {
  const server = startTestServer();
  const users = await makeUsers(server, names);
  const alice = users[0]!;
  const created = await alice.post<CreateServerBody>('/api/servers', { name: 'Slop Citadel', description: 'Certified slop.' });
  expect(created.status).toBe(200);
  return { server, users, alice, bob: users[1]!, created: created.body, serverId: created.body.server.id };
}

async function detail(client: Client, serverId: string): Promise<DetailBody> {
  const res = await client.get<DetailBody>(`/api/servers/${serverId}`);
  expect(res.status).toBe(200);
  return res.body;
}

async function joinViaInvite(owner: Client, joiner: Client, channelId: string): Promise<string> {
  const invite = await owner.post<{ invite: Invite }>(`/api/channels/${channelId}/invites`, {});
  expect(invite.status).toBe(201);
  const accepted = await joiner.post<{ server: Server; channel: Channel | null }>(`/api/invites/${invite.body.invite.code}`);
  expect(accepted.status).toBe(200);
  return invite.body.invite.code;
}

function channelNamed(channels: Channel[], name: string): Channel {
  const found = channels.find((c) => c.name === name);
  if (!found) throw new Error(`channel ${name} missing`);
  return found;
}

describe('servers: creation and settings', () => {
  test('POST /api/servers creates default roles, categories, channels and welcome system message', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    expect(created.server.name).toBe('Slop Citadel');
    expect(created.server.ownerId).toBe(alice.userId);
    expect(created.server.memberCount).toBe(1);
    expect(created.member.user.id).toBe(alice.userId);
    expect(created.channels.map((c) => c.name)).toEqual([
      'Information', 'welcome', 'The Slop', 'general', 'shitpost', 'board', 'voice',
    ]);

    const everyone = created.roles.find((r) => r.isDefault);
    expect(everyone?.name).toBe('@everyone');
    expect(everyone?.permissions).toBe(DEFAULT_EVERYONE);
    const founder = created.roles.find((r) => !r.isDefault);
    if (!founder) throw new Error('Founder role missing');
    expect(founder.name).toBe('Founder');
    expect(founder.hoist).toBe(true);
    expect(founder.permissions).toBe(Perm.ADMINISTRATOR);
    expect(created.member.roles).toContain(founder.id);

    const types = created.channels.map((c) => c.type);
    expect(types.filter((t) => t === 'category').length).toBe(2);
    expect(types).toContain('forum');
    expect(types).toContain('voice');
    const welcome = channelNamed(created.channels, 'welcome');
    const general = channelNamed(created.channels, 'general');
    expect(created.server.welcomeChannelId).toBe(welcome.id);
    expect(created.server.systemChannelId).toBe(general.id);

    const msg = server.runtime.db.get<{ type: string; author_id: string; content: string }>(
      'SELECT type, author_id, content FROM messages WHERE channel_id = ?', welcome.id,
    );
    expect(msg?.type).toBe('system');
    expect(msg?.author_id).toBe(alice.userId);
    expect(msg?.content).toContain('Slop Citadel');
    const achievement = server.runtime.db.get<{ ok: number }>(
      'SELECT 1 AS ok FROM achievements WHERE user_id = ? AND key = ?', alice.userId, 'server_owner',
    );
    expect(achievement?.ok).toBe(1);
    expect(server.runtime.db.get<{ action: string }>('SELECT action FROM audit_logs WHERE target_id = ?', serverId)?.action).toBe('server.create');

    const list = await alice.get<{ servers: Server[] }>('/api/servers');
    expect(list.body.servers.length).toBe(1);
    const bobList = await bob.get<{ servers: Server[] }>('/api/servers');
    expect(bobList.body.servers.length).toBe(0);

    const d = await detail(alice, serverId);
    expect(d.server.roles?.length).toBe(2);
    expect(d.channels.length).toBe(7);
    expect(d.channels.every((c) => Array.isArray(c.overrides))).toBe(true);
    expect(d.member?.roles).toContain(founder.id);

    const forbidden = await bob.get(`/api/servers/${serverId}`);
    expect(forbidden.status).toBe(404);
    const bad = await bob.post<ApiErrorBody>('/api/servers', { name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.fields?.name).toBeString();
  });

  test('icon upload ownership/purpose is enforced and PATCH broadcasts SERVER_UPDATE', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    insertUpload(server, alice.userId, 'up_icon', 'server_icon');
    insertUpload(server, bob.userId, 'up_bob_icon', 'server_icon');
    insertUpload(server, alice.userId, 'up_wrong', 'emoji');

    const good = await alice.post<CreateServerBody>('/api/servers', { name: 'Iconic', icon: '/api/media/uploads/up_icon' });
    expect(good.status).toBe(200);
    expect(good.body.server.icon).toBe('/api/media/uploads/up_icon');
    const stolen = await alice.post<ApiErrorBody>('/api/servers', { name: 'Stolen', icon: '/api/media/uploads/up_bob_icon' });
    expect(stolen.status).toBe(400);
    expect(stolen.body.fields?.icon).toBeString();
    const wrongPurpose = await alice.post<ApiErrorBody>('/api/servers', { name: 'Wrong', icon: '/api/media/uploads/up_wrong' });
    expect(wrongPurpose.status).toBe(400);

    const ws = await connectWs(alice, server);
    const update = waitFor<{ t?: string; d?: Server }>(ws, (d: { t?: string; d?: Server }) => d.t === 'SERVER_UPDATE' && d.d?.name === 'Renamed Slop');
    const patched = await alice.patch<{ server: Server }>(`/api/servers/${serverId}`, {
      name: 'Renamed Slop', motd: 'touch grass', traits: ['slop', 'goblin'], isPublic: true, bannerColor: '#ff00aa',
    });
    const evt = await update;
    ws.close();
    expect(patched.status).toBe(200);
    expect(patched.body.server.name).toBe('Renamed Slop');
    expect(patched.body.server.motd).toBe('touch grass');
    expect(patched.body.server.traits).toEqual(['slop', 'goblin']);
    expect(patched.body.server.isPublic).toBe(true);
    expect(evt.d?.name).toBe('Renamed Slop');

    const bobPatch = await bob.patch(`/api/servers/${serverId}`, { name: 'Bob Was Here' });
    expect(bobPatch.status).toBe(404);
    const voice = channelNamed(created.channels, 'voice');
    const general = channelNamed(created.channels, 'general');
    const invalidWelcome = await alice.patch<ApiErrorBody>(`/api/servers/${serverId}`, { welcomeChannelId: voice.id });
    expect(invalidWelcome.status).toBe(400);
    expect(invalidWelcome.body.fields?.welcomeChannelId).toBeString();
    const validWelcome = await alice.patch<{ server: Server }>(`/api/servers/${serverId}`, { welcomeChannelId: general.id, traits: ['one'] });
    expect(validWelcome.status).toBe(200);
    expect(validWelcome.body.server.welcomeChannelId).toBe(general.id);
    const badBanner = await alice.patch<ApiErrorBody>(`/api/servers/${serverId}`, { banner: '/api/media/uploads/up_wrong' });
    expect(badBanner.status).toBe(400);
  });
});

describe('servers: channels, positions and overrides', () => {
  test('channel CRUD, permissions, reorder and override privacy', async () => {
    const { server, users, alice, bob, created, serverId } = await setup(['alice', 'bob', 'carol']);
    const carol = users[2]!;
    const general = channelNamed(created.channels, 'general');
    const shitpost = channelNamed(created.channels, 'shitpost');
    const voice = channelNamed(created.channels, 'voice');
    await joinViaInvite(alice, bob, general.id);

    const bobDetail = await detail(bob, serverId);
    expect(bobDetail.member?.user.id).toBe(bob.userId);
    expect(bobDetail.channels.every((c) => typeof c.unreadCount === 'number')).toBe(true);
    expect(bobDetail.channels.every((c) => Array.isArray(c.overrides))).toBe(false);

    const deniedCreate = await bob.post(`/api/servers/${serverId}/channels`, { name: 'nope', type: 'text' });
    expect(deniedCreate.status).toBe(403);
    const badParent = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/channels`, { name: 'bad', type: 'text', parentId: voice.id });
    expect(badParent.status).toBe(400);
    expect(badParent.body.fields?.parentId).toBeString();
    const badType = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/channels`, { name: 'bad', type: 'voice_but_wrong' });
    expect(badType.status).toBe(400);

    const ws = await connectWs(alice, server);
    const createEvent = waitFor<{ t?: string; d?: Channel }>(ws, (d: { t?: string; d?: Channel }) => d.t === 'CHANNEL_CREATE' && d.d?.name === 'vault');
    const categoryRes = await alice.post<{ channel: Channel }>(`/api/servers/${serverId}/channels`, { name: 'Secret Lair', type: 'category' });
    expect(categoryRes.status).toBe(201);
    const nestedCategory = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/channels`, { name: 'Nested', type: 'category', parentId: categoryRes.body.channel.id });
    expect(nestedCategory.status).toBe(400);
    const vaultRes = await alice.post<{ channel: Channel }>(`/api/servers/${serverId}/channels`, {
      name: 'vault', type: 'text', parentId: categoryRes.body.channel.id, topic: 'secrets', slowmode: 30,
    });
    expect(vaultRes.status).toBe(201);
    expect(vaultRes.body.channel.parentId).toBe(categoryRes.body.channel.id);
    expect(vaultRes.body.channel.slowmode).toBe(30);
    const createEvt = await createEvent;
    expect(createEvt.d?.id).toBe(vaultRes.body.channel.id);
    const vault = vaultRes.body.channel;

    const patched = await alice.patch<{ channel: Channel }>(`/api/channels/${vault.id}`, {
      name: 'vault-renamed', topic: 'even more secrets', nsfw: true, locked: true, tags: ['classified'],
    });
    expect(patched.status).toBe(200);
    expect(patched.body.channel.name).toBe('vault-renamed');
    expect(patched.body.channel.nsfw).toBe(true);
    expect(patched.body.channel.tags).toEqual(['classified']);
    const badSort = await alice.patch<ApiErrorBody>(`/api/channels/${vault.id}`, { defaultSort: 'new' });
    expect(badSort.status).toBe(400);
    const bobPatch = await bob.patch(`/api/channels/${vault.id}`, { name: 'mine now' });
    expect(bobPatch.status).toBe(403);

    expect((await detail(bob, serverId)).channels.some((c) => c.id === vault.id)).toBe(true);
    const everyone = created.roles.find((r) => r.isDefault)!;
    const denyView = await alice.put<{ overrides: unknown[] }>(`/api/channels/${vault.id}/overrides`, {
      overrides: [{ targetType: 'role', targetId: everyone.id, allow: 0, deny: Perm.VIEW_CHANNEL }],
    });
    expect(denyView.status).toBe(200);
    expect(denyView.body.overrides.length).toBe(1);
    const hidden = await detail(bob, serverId);
    expect(hidden.channels.some((c) => c.id === vault.id)).toBe(false);
    const managerView = await detail(alice, serverId);
    expect(managerView.channels.find((c) => c.id === vault.id)?.overrides?.length).toBe(1);

    const bobPatchHidden = await bob.patch(`/api/channels/${vault.id}`, { name: 'still mine' });
    expect(bobPatchHidden.status).toBe(403);
    const bobOverrides = await bob.put(`/api/channels/${vault.id}/overrides`, { overrides: [] });
    expect(bobOverrides.status).toBe(403);
    const otherServer = await alice.post<CreateServerBody>('/api/servers', { name: 'Other Slop' });
    const foreignRole = otherServer.body.roles.find((r) => !r.isDefault)!;
    const invalidRole = await alice.put<ApiErrorBody>(`/api/channels/${vault.id}/overrides`, {
      overrides: [{ targetType: 'role', targetId: foreignRole.id, allow: Perm.VIEW_CHANNEL, deny: 0 }],
    });
    expect(invalidRole.status).toBe(400);
    const invalidUser = await alice.put<ApiErrorBody>(`/api/channels/${vault.id}/overrides`, {
      overrides: [{ targetType: 'user', targetId: carol.userId, allow: Perm.VIEW_CHANNEL, deny: 0 }],
    });
    expect(invalidUser.status).toBe(400);

    const allowBob = await alice.put<{ overrides: unknown[] }>(`/api/channels/${vault.id}/overrides`, {
      overrides: [
        { targetType: 'role', targetId: everyone.id, allow: 0, deny: Perm.VIEW_CHANNEL },
        { targetType: 'user', targetId: bob.userId, allow: Perm.VIEW_CHANNEL, deny: 0 },
      ],
    });
    expect(allowBob.status).toBe(200);
    expect((await detail(bob, serverId)).channels.some((c) => c.id === vault.id)).toBe(true);

    const reorder = await alice.patch<{ channels: Channel[] }>(`/api/servers/${serverId}/channels/positions`, {
      positions: [{ id: general.id, position: 20 }, { id: shitpost.id, position: 1 }],
    });
    expect(reorder.status).toBe(200);
    const reordered = await detail(alice, serverId);
    expect(reordered.channels.find((c) => c.id === general.id)?.position).toBe(20);
    expect(reordered.channels.find((c) => c.id === shitpost.id)?.position).toBe(1);
    const foreignPosition = await alice.patch<ApiErrorBody>(`/api/servers/${serverId}/channels/positions`, {
      positions: [{ id: otherServer.body.channels[0]!.id, position: 0 }],
    });
    expect(foreignPosition.status).toBe(400);

    const bobDelete = await bob.delete(`/api/channels/${vault.id}`);
    expect(bobDelete.status).toBe(403);
    const deleteCategory = await alice.delete(`/api/channels/${categoryRes.body.channel.id}`);
    expect(deleteCategory.status).toBe(200);
    const reparented = await detail(alice, serverId);
    expect(reparented.channels.some((c) => c.id === categoryRes.body.channel.id)).toBe(false);
    expect(reparented.channels.find((c) => c.id === vault.id)?.parentId).toBeNull();
    ws.close();
    const deleteVault = await alice.delete<{ ok: boolean; channelId: string }>(`/api/channels/${vault.id}`);
    expect(deleteVault.status).toBe(200);
    expect(deleteVault.body.channelId).toBe(vault.id);
    expect((await detail(alice, serverId)).channels.some((c) => c.id === vault.id)).toBe(false);
  });
});

interface DiscoveryServer extends Server { onlineCount: number; members?: unknown }

interface InvitePreviewBody {
  invite: { code: string; serverId: string; channelId: string | null; uses: number; maxUses: number; expiresAt: number | null; createdAt: number };
  server: { id: string; name: string; icon: string | null; description: string | null; memberCount: number; onlineCount: number };
  channel: { id: string; name: string } | null;
  inviter: { id: string; displayName: string };
}

describe('servers: invites, membership and discovery', () => {
  test('invite create/preview/accept, max uses, expiry, bans and leave', async () => {
    const { server, users, alice, bob, created, serverId } = await setup(['alice', 'bob', 'carol', 'dave']);
    const carol = users[2]!;
    const dave = users[3]!;
    const general = channelNamed(created.channels, 'general');
    const welcome = channelNamed(created.channels, 'welcome');
    const inviteRes = await alice.post<{ invite: Invite }>(`/api/channels/${general.id}/invites`, { maxUses: 1, expiresInHours: 24 });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.invite.code.length).toBeGreaterThan(4);
    expect(inviteRes.body.invite.maxUses).toBe(1);
    expect(inviteRes.body.invite.uses).toBe(0);

    const anon = newClient(server);
    const preview = await anon.get<InvitePreviewBody>(`/api/invites/${inviteRes.body.invite.code}`);
    expect(preview.status).toBe(200);
    expect(Object.keys(preview.body.server).sort()).toEqual(['description', 'icon', 'id', 'memberCount', 'name', 'onlineCount']);
    expect(preview.body.server.memberCount).toBe(1);
    expect(preview.body.server.onlineCount).toBe(0);
    expect(preview.body.channel?.name).toBe('general');
    expect(preview.body.inviter.id).toBe(alice.userId);
    expect(preview.body.inviter.displayName).toBe('alice');
    expect('creator' in preview.body.invite).toBe(false);

    const accepted = await bob.post<{ server: Server; channel: Channel | null }>(`/api/invites/${inviteRes.body.invite.code}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.server.memberCount).toBe(2);
    expect(accepted.body.channel?.name).toBe('general');
    expect((await detail(bob, serverId)).member?.user.id).toBe(bob.userId);
    const welcomeMessages = server.runtime.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND type = 'system'", welcome.id,
    )?.n;
    expect(welcomeMessages).toBe(2);

    const exhausted = await carol.post<ApiErrorBody>(`/api/invites/${inviteRes.body.invite.code}`);
    expect(exhausted.status).toBe(410);
    expect(exhausted.body.error).toBe('INVITE_MAX_USES');

    server.runtime.db.run(
      `INSERT INTO invites (code, server_id, channel_id, creator_id, max_uses, uses, expires_at, created_at)
       VALUES ('expiredcode', ?, ?, ?, 0, 0, ?, ?)`,
      serverId, general.id, alice.userId, Date.now() - 60_000, Date.now(),
    );
    const expired = await anon.get<ApiErrorBody>('/api/invites/expiredcode');
    expect(expired.status).toBe(410);
    expect(expired.body.error).toBe('INVITE_EXPIRED');

    server.runtime.db.run(
      'INSERT INTO bans (server_id, user_id, banned_by, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      serverId, dave.userId, alice.userId, 'slop crimes', Date.now(),
    );
    const bannedInvite = await alice.post<{ invite: Invite }>(`/api/channels/${general.id}/invites`, {});
    const banned = await dave.post<ApiErrorBody>(`/api/invites/${bannedInvite.body.invite.code}`);
    expect(banned.status).toBe(403);
    expect(banned.body.error).toBe('BANNED_FROM_SERVER');

    const bobList = await bob.get<{ invites: Invite[] }>(`/api/servers/${serverId}/invites`);
    expect(bobList.status).toBe(200);
    expect(bobList.body.invites.some((i) => i.code === bannedInvite.body.invite.code)).toBe(true);
    const carolList = await carol.get(`/api/servers/${serverId}/invites`);
    expect(carolList.status).toBe(404);
    const bobDelete = await bob.delete(`/api/invites/${bannedInvite.body.invite.code}`);
    expect(bobDelete.status).toBe(403);
    const aliceDelete = await alice.delete<{ ok: boolean }>(`/api/invites/${bannedInvite.body.invite.code}`);
    expect(aliceDelete.status).toBe(200);
    expect((await anon.get(`/api/invites/${bannedInvite.body.invite.code}`)).status).toBe(404);

    const ownerLeave = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/leave`);
    expect(ownerLeave.status).toBe(409);
    expect(ownerLeave.body.error).toBe('OWNER_CANNOT_LEAVE');
    const bobLeave = await bob.post<{ ok: boolean }>(`/api/servers/${serverId}/leave`);
    expect(bobLeave.status).toBe(200);
    expect((await bob.get(`/api/servers/${serverId}`)).status).toBe(404);
    expect((await detail(alice, serverId)).server.memberCount).toBe(1);
  });

  test('discovery lists public servers and join is idempotent', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    const patched = await alice.patch<{ server: Server }>(`/api/servers/${serverId}`, { isPublic: true, description: 'public slop' });
    expect(patched.status).toBe(200);
    const anon = newClient(server);
    const discover = await anon.get<{ servers: DiscoveryServer[] }>('/api/discover');
    expect(discover.status).toBe(200);
    const listed = discover.body.servers.find((s) => s.id === serverId);
    expect(listed?.name).toBe('Slop Citadel');
    expect(listed?.onlineCount).toBe(0);
    expect(listed?.members).toBeUndefined();
    expect(listed?.roles).toBeUndefined();

    const privateServer = await alice.post<CreateServerBody>('/api/servers', { name: 'Private Slop' });
    const discoverAgain = await anon.get<{ servers: Server[] }>('/api/discover');
    expect(discoverAgain.body.servers.some((s) => s.id === privateServer.body.server.id)).toBe(false);

    const join = await bob.post<{ server: Server; channel: Channel | null }>(`/api/discover/${serverId}/join`);
    expect(join.status).toBe(200);
    expect(join.body.server.memberCount).toBe(2);
    expect(join.body.channel?.id ?? null).toBe(created.server.welcomeChannelId);
    const again = await bob.post<{ server: Server }>(`/api/discover/${serverId}/join`);
    expect(again.status).toBe(200);
    expect(again.body.server.memberCount).toBe(2);
    const privateJoin = await bob.post(`/api/discover/${privateServer.body.server.id}/join`);
    expect(privateJoin.status).toBe(404);
  });

  test('transfer is owner-only and moves the Founder role', async () => {
    const { users, alice, bob, created, serverId } = await setup(['alice', 'bob', 'carol']);
    const carol = users[2]!;
    const general = channelNamed(created.channels, 'general');
    await joinViaInvite(alice, bob, general.id);
    const founder = created.roles.find((r) => !r.isDefault)!;
    const denied = await bob.post<ApiErrorBody>(`/api/servers/${serverId}/transfer`, { userId: bob.userId });
    expect(denied.status).toBe(403);
    const nonMember = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/transfer`, { userId: carol.userId });
    expect(nonMember.status).toBe(400);
    expect(nonMember.body.fields?.userId).toBeString();
    const transferred = await alice.post<{ server: Server }>(`/api/servers/${serverId}/transfer`, { userId: bob.userId });
    expect(transferred.status).toBe(200);
    expect(transferred.body.server.ownerId).toBe(bob.userId);
    expect((await detail(bob, serverId)).member?.roles).toContain(founder.id);
    expect((await detail(alice, serverId)).member?.roles).not.toContain(founder.id);
    const again = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/transfer`, { userId: alice.userId });
    expect(again.status).toBe(403);
    expect(again.body.error).toBe('OWNER_ONLY');
  });

  test('delete server requires exact name, broadcasts SERVER_LEAVE and audits', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    const general = channelNamed(created.channels, 'general');
    await joinViaInvite(alice, bob, general.id);
    const wrong = await alice.delete<ApiErrorBody>(`/api/servers/${serverId}`, { confirmName: 'wrong name' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.fields?.confirmName).toBeString();
    const bobDelete = await bob.delete(`/api/servers/${serverId}`, { confirmName: 'Slop Citadel' });
    expect(bobDelete.status).toBe(403);
    const ws = await connectWs(bob, server);
    const leaveEvent = waitFor<{ t?: string; d?: { serverId?: string } }>(ws, (d: { t?: string; d?: { serverId?: string } }) => d.t === 'SERVER_LEAVE' && d.d?.serverId === serverId);
    const deleted = await alice.delete<{ ok: boolean }>(`/api/servers/${serverId}`, { confirmName: 'Slop Citadel' });
    const evt = await leaveEvent;
    ws.close();
    expect(deleted.status).toBe(200);
    expect(evt.d?.serverId).toBe(serverId);
    expect((await alice.get(`/api/servers/${serverId}`)).status).toBe(404);
    expect((await alice.get<{ servers: Server[] }>('/api/servers')).body.servers.length).toBe(0);
    const audit = server.runtime.db.get<{ action: string; server_id: string | null }>(
      "SELECT action, server_id FROM audit_logs WHERE action = 'server.delete' AND target_id = ?", serverId,
    );
    expect(audit?.action).toBe('server.delete');
    expect(audit?.server_id).toBeNull();
  });
});

describe('servers: emojis, stickers, sounds and webhooks', () => {
  test('emoji/sticker/sound uploads validate ownership, purpose and permission', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    const general = channelNamed(created.channels, 'general');
    await joinViaInvite(alice, bob, general.id);
    insertUpload(server, alice.userId, 'up_emoji', 'emoji');
    insertUpload(server, alice.userId, 'up_emoji2', 'emoji');
    insertUpload(server, alice.userId, 'up_icon', 'server_icon');
    insertUpload(server, alice.userId, 'up_sticker', 'sticker');
    insertUpload(server, alice.userId, 'up_sound', 'sound', 'audio/mpeg');
    insertUpload(server, bob.userId, 'up_bob_emoji', 'emoji');

    const badName = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/emojis`, { name: '../bad', uploadId: 'up_emoji' });
    expect(badName.status).toBe(400);
    expect(badName.body.fields?.name).toBeString();
    const stolen = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/emojis`, { name: 'stolen', uploadId: 'up_bob_emoji' });
    expect(stolen.status).toBe(400);
    expect(stolen.body.fields?.uploadId).toBeString();
    const wrongPurpose = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/emojis`, { name: 'wrong', uploadId: 'up_icon' });
    expect(wrongPurpose.status).toBe(400);
    const missingUpload = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/emojis`, { name: 'missing' });
    expect(missingUpload.status).toBe(400);
    const denied = await bob.post(`/api/servers/${serverId}/emojis`, { name: 'bob_emoji', uploadId: 'up_bob_emoji' });
    expect(denied.status).toBe(403);

    const emojiRes = await alice.post<{ emoji: Emoji }>(`/api/servers/${serverId}/emojis`, { name: 'slop_emoji', uploadId: 'up_emoji' });
    expect(emojiRes.status).toBe(201);
    expect(emojiRes.body.emoji.url).toBe('/api/media/uploads/up_emoji');
    expect(emojiRes.body.emoji.animated).toBe(false);
    const duplicate = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/emojis`, { name: 'slop_emoji', uploadId: 'up_emoji2' });
    expect(duplicate.status).toBe(409);
    const list = await bob.get<{ emojis: Emoji[] }>(`/api/servers/${serverId}/emojis`);
    expect(list.status).toBe(200);
    expect(list.body.emojis.some((e) => e.name === 'slop_emoji')).toBe(true);
    const bobDelete = await bob.delete(`/api/emojis/${emojiRes.body.emoji.id}`);
    expect(bobDelete.status).toBe(403);
    expect((await alice.delete(`/api/emojis/${emojiRes.body.emoji.id}`)).status).toBe(200);
    expect((await alice.get<{ emojis: Emoji[] }>(`/api/servers/${serverId}/emojis`)).body.emojis.length).toBe(0);

    const stickerRes = await alice.post<{ sticker: Sticker }>(`/api/servers/${serverId}/stickers`, {
      name: 'slop sticker', uploadId: 'up_sticker', description: 'a cursed sticker', tags: ['slop', 'cursed'],
    });
    expect(stickerRes.status).toBe(201);
    expect(stickerRes.body.sticker.tags).toEqual(['slop', 'cursed']);
    expect(stickerRes.body.sticker.url).toBe('/api/media/uploads/up_sticker');
    const stickerWrongPurpose = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/stickers`, { name: 'wrong', uploadId: 'up_emoji2' });
    expect(stickerWrongPurpose.status).toBe(400);
    expect((await bob.get<{ stickers: Sticker[] }>(`/api/servers/${serverId}/stickers`)).body.stickers.length).toBe(1);
    expect((await bob.delete(`/api/stickers/${stickerRes.body.sticker.id}`)).status).toBe(403);
    expect((await alice.delete(`/api/stickers/${stickerRes.body.sticker.id}`)).status).toBe(200);

    const soundRes = await alice.post<{ sound: Sound }>(`/api/servers/${serverId}/sounds`, { name: 'airhorn', uploadId: 'up_sound' });
    expect(soundRes.status).toBe(201);
    expect(soundRes.body.sound.emoji).toBe('🔊');
    expect(soundRes.body.sound.url).toBe('/api/media/uploads/up_sound');
    const soundWrongKind = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/sounds`, { name: 'bad', uploadId: 'up_emoji2' });
    expect(soundWrongKind.status).toBe(400);
    expect((await bob.get<{ sounds: Sound[] }>(`/api/servers/${serverId}/sounds`)).body.sounds.length).toBe(1);
    expect((await alice.delete(`/api/sounds/${soundRes.body.sound.id}`)).status).toBe(200);
  });

  test('webhook tokens are hashed, permissions enforced and posts broadcast as the owner', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    const general = channelNamed(created.channels, 'general');
    const voice = channelNamed(created.channels, 'voice');
    await joinViaInvite(alice, bob, general.id);
    insertUpload(server, alice.userId, 'up_hook_avatar', 'webhook_avatar');

    const denied = await bob.post(`/api/servers/${serverId}/webhooks`, { name: 'bob hook', channelId: general.id });
    expect(denied.status).toBe(403);
    const wrongChannel = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/webhooks`, { name: 'voice hook', channelId: voice.id });
    expect(wrongChannel.status).toBe(400);
    expect(wrongChannel.body.fields?.channelId).toBeString();
    const createdHook = await alice.post<{ webhook: Webhook }>(`/api/servers/${serverId}/webhooks`, {
      name: 'Slop Hook', channelId: general.id, avatar: '/api/media/uploads/up_hook_avatar',
    });
    expect(createdHook.status).toBe(201);
    const webhook = createdHook.body.webhook;
    expect(webhook.token).toBeString();
    expect(webhook.avatar).toBe('/api/media/uploads/up_hook_avatar');
    const stored = server.runtime.db.get<{ token_hash: string }>('SELECT token_hash FROM webhooks WHERE id = ?', webhook.id);
    expect(stored?.token_hash).not.toBe(webhook.token);
    expect(stored?.token_hash).toHaveLength(64);

    const listed = await alice.get<{ webhooks: Webhook[] }>(`/api/servers/${serverId}/webhooks`);
    expect(listed.status).toBe(200);
    expect(listed.body.webhooks[0]?.token).toBeUndefined();
    expect((await bob.get(`/api/servers/${serverId}/webhooks`)).status).toBe(403);

    const anon = newClient(server);
    const posted = await anon.post<{ message: Message }>(`/api/webhooks/${webhook.id}/${webhook.token}`, {
      content: 'hello from the sewer', username: 'Hook Goblin',
    });
    expect(posted.status).toBe(200);
    expect(posted.body.message.author.id).toBe(alice.userId);
    expect(posted.body.message.channelId).toBe(general.id);
    expect(posted.body.message.content).toBe('hello from the sewer');
    const storedMessage = server.runtime.db.get<{ flags: string; author_id: string }>(
      'SELECT flags, author_id FROM messages WHERE id = ?', posted.body.message.id,
    );
    expect(storedMessage?.author_id).toBe(alice.userId);
    if (storedMessage) {
      const flags = JSON.parse(storedMessage.flags) as { webhook?: string; webhookName?: string; username?: string };
      expect(flags.webhook).toBe(webhook.id);
      expect(flags.webhookName).toBe('Slop Hook');
      expect(flags.username).toBe('Hook Goblin');
    }
    expect((await detail(alice, serverId)).channels.find((c) => c.id === general.id)?.lastMessageId).toBe(posted.body.message.id);

    const badToken = await anon.post<ApiErrorBody>(`/api/webhooks/${webhook.id}/not-the-token`, { content: 'nope' });
    expect(badToken.status).toBe(401);
    expect(badToken.body.error).toBe('INVALID_WEBHOOK_TOKEN');
    const empty = await anon.post<ApiErrorBody>(`/api/webhooks/${webhook.id}/${webhook.token}`, { content: '' });
    expect(empty.status).toBe(400);
    const tooLong = await anon.post<ApiErrorBody>(`/api/webhooks/${webhook.id}/${webhook.token}`, { content: 'x'.repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.fields?.content).toBeString();
    const ignoredAvatar = await anon.post<{ message: Message }>(`/api/webhooks/${webhook.id}/${webhook.token}`, {
      content: 'no external fetches here', avatar_url: 'https://evil.example/avatar.png',
    });
    expect(ignoredAvatar.status).toBe(200);
    expect(ignoredAvatar.body.message.author.avatar).toBeNull();

    expect((await bob.delete(`/api/webhooks/${webhook.id}`)).status).toBe(403);
    expect((await alice.delete(`/api/webhooks/${webhook.id}`)).status).toBe(200);
    expect((await anon.post(`/api/webhooks/${webhook.id}/${webhook.token}`, { content: 'gone' })).status).toBe(401);
  });
});

interface RuleRecord { id: string; serverId: string | null; pattern: string; action: string; enabled: boolean; createdBy: string | null; createdAt: number }

describe('servers: events and rules', () => {
  test('event create/rsvp/edit permissions and broadcasts', async () => {
    const { server, alice, bob, created, serverId } = await setup();
    const general = channelNamed(created.channels, 'general');
    await joinViaInvite(alice, bob, general.id);
    const startsAt = Date.now() + 86_400_000;
    const badEvent = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/events`, { name: 'bad', startsAt: 0 });
    expect(badEvent.status).toBe(400);
    const createdEvent = await alice.post<{ event: ServerEvent }>(`/api/servers/${serverId}/events`, {
      name: 'Slop Fest', description: 'bring your worst memes', startsAt, endsAt: startsAt + 3_600_000, channelId: general.id,
    });
    expect(createdEvent.status).toBe(201);
    expect(createdEvent.body.event.name).toBe('Slop Fest');
    expect(createdEvent.body.event.creator.id).toBe(alice.userId);
    expect(createdEvent.body.event.rsvp).toBeNull();
    expect(createdEvent.body.event.counts).toEqual({ interested: 0, going: 0 });
    expect(createdEvent.body.event.channelId).toBe(general.id);

    const ws = await connectWs(bob, server);
    const updateEvent = waitFor<{ t?: string; d?: { event?: ServerEvent } }>(ws, (d: { t?: string; d?: { event?: ServerEvent } }) => d.t === 'SERVER_EVENT_UPDATE' && d.d?.event?.counts.going === 1);
    const bobList = await bob.get<{ events: ServerEvent[] }>(`/api/servers/${serverId}/events`);
    expect(bobList.status).toBe(200);
    expect(bobList.body.events.length).toBe(1);
    const going = await bob.post<{ event: ServerEvent }>(`/api/events/${createdEvent.body.event.id}/rsvp`, { status: 'going' });
    expect(going.status).toBe(200);
    expect(going.body.event.rsvp).toBe('going');
    expect(going.body.event.counts.going).toBe(1);
    const broadcast = await updateEvent;
    expect(broadcast.d?.event?.counts.going).toBe(1);
    ws.close();
    const interested = await bob.post<{ event: ServerEvent }>(`/api/events/${createdEvent.body.event.id}/rsvp`, { status: 'interested' });
    expect(interested.body.event.counts).toEqual({ interested: 1, going: 0 });
    const cleared = await bob.post<{ event: ServerEvent }>(`/api/events/${createdEvent.body.event.id}/rsvp`, { status: null });
    expect(cleared.body.event.rsvp).toBeNull();
    expect(cleared.body.event.counts).toEqual({ interested: 0, going: 0 });
    const invalidRsvp = await bob.post<ApiErrorBody>(`/api/events/${createdEvent.body.event.id}/rsvp`, { status: 'maybe' });
    expect(invalidRsvp.status).toBe(400);

    const bobPatch = await bob.patch(`/api/events/${createdEvent.body.event.id}`, { name: 'Bob Fest' });
    expect(bobPatch.status).toBe(403);
    const alicePatch = await alice.patch<{ event: ServerEvent }>(`/api/events/${createdEvent.body.event.id}`, {
      name: 'Slop Fest Deluxe', description: 'now with more slop', endsAt: startsAt + 7_200_000,
    });
    expect(alicePatch.status).toBe(200);
    expect(alicePatch.body.event.name).toBe('Slop Fest Deluxe');
    const badEnd = await alice.patch<ApiErrorBody>(`/api/events/${createdEvent.body.event.id}`, { endsAt: startsAt - 1 });
    expect(badEnd.status).toBe(400);

    const bobEvent = await bob.post<{ event: ServerEvent }>(`/api/servers/${serverId}/events`, { name: 'Bob Hangout', startsAt });
    expect(bobEvent.status).toBe(201);
    expect((await bob.patch<{ event: ServerEvent }>(`/api/events/${bobEvent.body.event.id}`, { name: 'Bob Hangout 2' })).status).toBe(200);
    expect((await bob.delete(`/api/events/${bobEvent.body.event.id}`)).status).toBe(200);
    expect((await alice.delete(`/api/events/${createdEvent.body.event.id}`)).status).toBe(200);
    expect((await alice.get<{ events: ServerEvent[] }>(`/api/servers/${serverId}/events`)).body.events.length).toBe(0);
  });

  test('server rules use moderation_rules and MANAGE_SERVER', async () => {
    const { alice, bob, created, serverId } = await setup();
    const general = channelNamed(created.channels, 'general');
    await joinViaInvite(alice, bob, general.id);
    const empty = await bob.get<{ rules: RuleRecord[] }>(`/api/servers/${serverId}/rules`);
    expect(empty.status).toBe(200);
    expect(empty.body.rules).toEqual([]);
    expect((await bob.post(`/api/servers/${serverId}/rules`, { pattern: 'no fun' })).status).toBe(403);
    const badAction = await alice.post<ApiErrorBody>(`/api/servers/${serverId}/rules`, { pattern: 'bad', action: 'yeet' });
    expect(badAction.status).toBe(400);
    const rule = await alice.post<{ rule: RuleRecord }>(`/api/servers/${serverId}/rules`, { pattern: 'no slop before noon', action: 'warn' });
    expect(rule.status).toBe(201);
    expect(rule.body.rule.action).toBe('warn');
    expect(rule.body.rule.enabled).toBe(true);
    expect(rule.body.rule.createdBy).toBe(alice.userId);
    const listed = await bob.get<{ rules: RuleRecord[] }>(`/api/servers/${serverId}/rules`);
    expect(listed.body.rules.length).toBe(1);
    expect((await bob.delete(`/api/rules/${rule.body.rule.id}`)).status).toBe(403);
    expect((await alice.delete(`/api/rules/${rule.body.rule.id}`)).status).toBe(200);
    expect((await alice.get<{ rules: RuleRecord[] }>(`/api/servers/${serverId}/rules`)).body.rules.length).toBe(0);
  });
});




