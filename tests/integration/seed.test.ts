import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, newClient } from '../helpers';

afterAll(() => stopAllServers());

describe('demo seed', () => {
  test('first user gets a fully populated public server, DMs, friends and board posts', async () => {
    const server = startTestServer({ demoSeed: true });
    const admin = newClient(server);
    const reg = await admin.register('bossman', 'password123');
    expect(reg.status).toBe(200);
    expect(reg.body.user.isAdmin).toBe(true);

    const servers = await admin.get('/api/servers');
    expect(servers.status).toBe(200);
    expect(servers.body.servers).toHaveLength(1);
    const summary = servers.body.servers[0];
    expect(summary.name).toBe('The Slop Pit');
    expect(summary.memberCount).toBe(7);
    expect(summary.isPublic).toBe(true);

    const detail = await admin.get(`/api/servers/${summary.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.server.name).toBe('The Slop Pit');
    const names = detail.body.channels.map((c: any) => c.name);
    expect(names).toContain('general');
    expect(names).toContain('shitpost');
    expect(names).toContain('slop-board');
    expect(detail.body.roles.length).toBeGreaterThanOrEqual(5);
    expect(detail.body.emojis.length).toBeGreaterThanOrEqual(10);
    expect(detail.body.stickers.length).toBeGreaterThanOrEqual(5);
    expect(detail.body.sounds.length).toBeGreaterThanOrEqual(5);
    expect(detail.body.member.roles.length).toBeGreaterThan(0);

    const general = detail.body.channels.find((c: any) => c.name === 'general');
    expect(general.unreadCount).toBeGreaterThan(0);
    const msgs = await admin.get(`/api/channels/${general.id}/messages`);
    expect(msgs.status).toBe(200);
    expect(msgs.body.messages.length).toBeGreaterThanOrEqual(8);
    const poll = msgs.body.messages.find((m: any) => m.poll);
    expect(poll.poll.question).toContain('superior slop');
    expect(poll.poll.totalVotes).toBe(5);
    expect(msgs.body.messages.some((m: any) => m.pinned)).toBe(true);
    expect(msgs.body.messages.some((m: any) => m.reactions.length > 0)).toBe(true);

    const board = detail.body.channels.find((c: any) => c.type === 'forum');
    const posts = await admin.get(`/api/channels/${board.id}/posts?sort=hot`);
    expect(posts.status).toBe(200);
    expect(posts.body.posts.length).toBe(3);
    expect(posts.body.posts[0].replyCount).toBeGreaterThan(0);
    expect(posts.body.posts[0].firstMessage).toBeTruthy();
    expect(board.tags).toContain('meme');

    const dms = await admin.get('/api/dms');
    expect(dms.body.channels).toHaveLength(2);
    expect(dms.body.channels.some((d: any) => d.type === 'group_dm')).toBe(true);
    expect(dms.body.channels.some((d: any) => d.unreadCount > 0)).toBe(true);

    const friends = await admin.get('/api/users/@me/friends');
    expect(friends.body.friends.length).toBe(4);
    expect(friends.body.incoming.length).toBe(1);

    const notifications = await admin.get('/api/notifications');
    expect(notifications.body.notifications.length).toBeGreaterThanOrEqual(2);
    expect(notifications.body.unreadCount).toBeGreaterThanOrEqual(2);

    const search = await admin.get('/api/search?q=pineapple');
    expect(search.status).toBe(200);
    expect(search.body.messages.length).toBeGreaterThan(0);

    const invite = await newClient(server).get('/api/invites/slop-pit');
    expect(invite.status).toBe(200);
    expect(invite.body.server.name).toBe('The Slop Pit');
    expect(invite.body.server.memberCount).toBe(7);

    const discover = await newClient(server).get('/api/discover');
    expect(discover.body.servers.some((s: any) => s.name === 'The Slop Pit')).toBe(true);

    const overview = await admin.get('/api/admin/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.counts.openReports).toBeGreaterThanOrEqual(1);
  });

  test('second registered user gets no seeded workspace but can discover/join', async () => {
    const server = startTestServer({ demoSeed: true });
    const admin = newClient(server);
    await admin.register('bossman', 'password123');
    const bob = newClient(server);
    const reg = await bob.register('bob', 'password123');
    expect(reg.body.user.isAdmin).toBe(false);
    const servers = await bob.get('/api/servers');
    expect(servers.body.servers).toHaveLength(0);
    const discover = await bob.get('/api/discover');
    const pit = discover.body.servers.find((s: any) => s.name === 'The Slop Pit');
    expect(pit).toBeTruthy();
    const join = await bob.post(`/api/discover/${pit.id}/join`, {});
    expect(join.status).toBe(200);
    const joined = await bob.get('/api/servers');
    expect(joined.body.servers).toHaveLength(1);
    const detail = await bob.get(`/api/servers/${pit.id}`);
    expect(detail.body.member).toBeTruthy();
    const messages = await bob.get(`/api/channels/${detail.body.channels.find((c:any)=>c.name==='welcome').id}/messages`);
    expect(messages.status).toBe(200);
    expect(messages.body.messages.length).toBeGreaterThan(0);
  });

  test('seeding is not repeated for the same admin on login', async () => {
    const server = startTestServer({ demoSeed: true });
    const admin = newClient(server);
    await admin.register('bossman', 'password123');
    const before = await admin.get('/api/servers');
    const fresh = newClient(server);
    const relogin = await fresh.login('bossman', 'password123');
    expect(relogin.status).toBe(200);
    const after = await fresh.get('/api/servers');
    expect(after.body.servers.length).toBe(before.body.servers.length);
    const again = await admin.get('/api/servers');
    expect(again.body.servers.length).toBe(before.body.servers.length);
  });
});
