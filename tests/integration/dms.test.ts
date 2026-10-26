import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, makeUsers, connectWs, waitFor, type TestServer } from '../helpers';
import { newId } from '../../src/server/util/ids';
import type { DMChannel, Friend, Notification } from '../../src/shared/types';

afterAll(() => stopAllServers());

interface ErrorBody {
  error?: string;
  message?: string;
  fields?: Record<string, string>;
}

interface FriendListsBody {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
  blocked: Friend[];
}

interface NotificationInbox {
  notifications: Notification[];
  unreadCount: number;
}

function addMessage(server: TestServer, channelId: string, authorId: string, content: string, mentionIds: string[] = []): string {
  const id = newId('m');
  server.runtime.db.run(
    'INSERT INTO messages (id, channel_id, server_id, author_id, content, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
    id, channelId, authorId, content, Date.now(),
  );
  for (const target of mentionIds) {
    server.runtime.db.run(
      "INSERT INTO message_mentions (message_id, mention_type, target_id) VALUES (?, 'user', ?)", id, target,
    );
  }
  return id;
}

function addUpload(server: TestServer, ownerId: string, purpose = 'server_icon'): string {
  const id = newId('up');
  server.runtime.db.run(
    `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, created_at)
     VALUES (?, ?, ?, 'icon.png', 'image/png', 12, ?, 'deadbeef', ?)`,
    id, ownerId, purpose, `${id}.png`, Date.now(),
  );
  return id;
}

describe('dms', () => {
  test('creates 1:1 DMs, derives the peer identity, lists unread/mentions and reuses the channel', async () => {
    const server = startTestServer();
    const [alice, bob, carol] = await makeUsers(server, ['alice', 'bob', 'carol']);

    const created = await alice!.post<{ channel: DMChannel }>('/api/dms', { recipientIds: [bob!.userId] });
    expect(created.status).toBe(200);
    const channel = created.body.channel;
    expect(channel.type).toBe('dm');
    expect(channel.name).toBe('bob');
    expect(channel.icon).toBeNull();
    expect(channel.ownerId).toBeNull();
    expect(channel.members.map((m) => m.id).sort()).toEqual([alice!.userId, bob!.userId].sort());
    expect(channel.unreadCount).toBe(0);
    expect(channel.lastMessage).toBeNull();

    // Duplicate recipient ids collapse; the same 1:1 is reused rather than duplicated.
    const again = await alice!.post<{ channel: DMChannel }>('/api/dms', { recipientIds: [bob!.userId, bob!.userId, bob!.userId] });
    expect(again.status).toBe(200);
    expect(again.body.channel.id).toBe(channel.id);

    const self = await alice!.post<ErrorBody>('/api/dms', { recipientIds: [alice!.userId] });
    expect(self.status).toBe(400);
    expect(self.body.error).toBe('VALIDATION_ERROR');
    expect(self.body.fields?.recipientIds).toBeString();

    const missing = await alice!.post<ErrorBody>('/api/dms', { recipientIds: ['u_does_not_exist'] });
    expect(missing.status).toBe(400);
    expect(missing.body.fields?.recipientIds).toBeString();

    const tooMany = await alice!.post<ErrorBody>('/api/dms', {
      recipientIds: Array.from({ length: 10 }, (_, i) => `u_fake_${i}`),
    });
    expect(tooMany.status).toBe(400);

    // Fixture messages stand in for the sibling messages slice.
    const firstFromBob = addMessage(server, channel.id, bob!.userId, 'first slop', [alice!.userId]);
    addMessage(server, channel.id, bob!.userId, 'second slop');
    addMessage(server, channel.id, alice!.userId, 'my own slop');

    const listed = await alice!.get<{ channels: DMChannel[] }>('/api/dms');
    expect(listed.status).toBe(200);
    const mine = listed.body.channels.find((c) => c.id === channel.id)!;
    expect(mine.unreadCount).toBe(2);
    expect(mine.mentionCount).toBe(1);
    expect(mine.lastMessage?.content).toBe('my own slop');

    const bobList = await bob!.get<{ channels: DMChannel[] }>('/api/dms');
    const bobsView = bobList.body.channels.find((c) => c.id === channel.id)!;
    expect(bobsView.unreadCount).toBe(1);
    expect(bobsView.mentionCount).toBe(0);

    server.runtime.db.run(
      'INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?)',
      alice!.userId, channel.id, firstFromBob, Date.now(),
    );
    const afterRead = await alice!.get<{ channels: DMChannel[] }>('/api/dms');
    const readChannel = afterRead.body.channels.find((c) => c.id === channel.id)!;
    expect(readChannel.unreadCount).toBe(1);
    expect(readChannel.mentionCount).toBe(0);
    expect(readChannel.lastReadId).toBe(firstFromBob);

    // Non-members can neither read nor see the channel.
    const strangerGet = await carol!.get<ErrorBody>(`/api/dms/${channel.id}`);
    expect(strangerGet.status).toBe(404);
    expect(strangerGet.body.error).toBe('DM_NOT_FOUND');
    const strangerList = await carol!.get<{ channels: DMChannel[] }>('/api/dms');
    expect(strangerList.body.channels).toHaveLength(0);

    // Closing is per-user; posting again reopens the same channel.
    const closed = await alice!.delete(`/api/dms/${channel.id}`);
    expect(closed.status).toBe(200);
    expect((await alice!.get<{ channels: DMChannel[] }>('/api/dms')).body.channels).toHaveLength(0);
    const reopened = await alice!.post<{ channel: DMChannel }>('/api/dms', { recipientIds: [bob!.userId] });
    expect(reopened.body.channel.id).toBe(channel.id);
    expect((await alice!.get<{ channels: DMChannel[] }>('/api/dms')).body.channels).toHaveLength(1);
  });

  test('group DMs: naming, ownership, rename/icon, member add/remove, leave and owner delete', async () => {
    const server = startTestServer();
    const [alice, bob, carol, dave] = await makeUsers(server, ['alice', 'bob', 'carol', 'dave']);

    const missingName = await alice!.post<ErrorBody>('/api/dms', { recipientIds: [bob!.userId, carol!.userId] });
    expect(missingName.status).toBe(400);
    expect(missingName.body.fields?.name).toBeString();
    const longName = await alice!.post<ErrorBody>('/api/dms', {
      recipientIds: [bob!.userId, carol!.userId], name: 'x'.repeat(101),
    });
    expect(longName.status).toBe(400);

    const created = await alice!.post<{ channel: DMChannel }>('/api/dms', {
      recipientIds: [bob!.userId, carol!.userId], name: 'Goon Squad',
    });
    expect(created.status).toBe(200);
    const group = created.body.channel;
    expect(group.type).toBe('group_dm');
    expect(group.name).toBe('Goon Squad');
    expect(group.ownerId).toBe(alice!.userId);
    expect(group.members).toHaveLength(3);

    const bobsList = await bob!.get<{ channels: DMChannel[] }>('/api/dms');
    expect(bobsList.body.channels.map((c) => c.id)).toContain(group.id);

    const byBob = await bob!.patch<ErrorBody>(`/api/dms/${group.id}`, { name: 'Bob Rules' });
    expect(byBob.status).toBe(403);
    expect(byBob.body.error).toBe('NOT_OWNER');
    const rename = await alice!.patch<{ channel: DMChannel }>(`/api/dms/${group.id}`, { name: 'Goon Squad 2' });
    expect(rename.status).toBe(200);
    expect(rename.body.channel.name).toBe('Goon Squad 2');
    expect((await alice!.patch<ErrorBody>(`/api/dms/${group.id}`, { name: '   ' })).status).toBe(400);
    expect((await alice!.patch<ErrorBody>(`/api/dms/${group.id}`, {})).status).toBe(400);

    const uploadId = addUpload(server, alice!.userId);
    const icon = await alice!.patch<{ channel: DMChannel }>(`/api/dms/${group.id}`, {
      icon: `/api/media/uploads/${uploadId}`,
    });
    expect(icon.status).toBe(200);
    expect(icon.body.channel.icon).toBe(`/api/media/uploads/${uploadId}`);
    const foreignUpload = addUpload(server, bob!.userId);
    expect((await alice!.patch<ErrorBody>(`/api/dms/${group.id}`, {
      icon: `/api/media/uploads/${foreignUpload}`,
    })).status).toBe(403);
    expect((await alice!.patch<ErrorBody>(`/api/dms/${group.id}`, {
      icon: 'https://evil.example/icon.png',
    })).status).toBe(400);

    const oneOnOne = await alice!.post<{ channel: DMChannel }>('/api/dms', { recipientIds: [bob!.userId] });
    const dmPatch = await alice!.patch<ErrorBody>(`/api/dms/${oneOnOne.body.channel.id}`, { name: 'Nope' });
    expect(dmPatch.status).toBe(403);
    expect(dmPatch.body.error).toBe('NOT_GROUP_DM');

    const addByBob = await bob!.post<ErrorBody>(`/api/dms/${group.id}/members`, { userId: dave!.userId });
    expect(addByBob.status).toBe(403);
    const add = await alice!.post<{ channel: DMChannel }>(`/api/dms/${group.id}/members`, { userId: dave!.userId });
    expect(add.status).toBe(200);
    expect(add.body.channel.members).toHaveLength(4);
    expect((await alice!.post<ErrorBody>(`/api/dms/${group.id}/members`, { userId: dave!.userId })).status).toBe(409);
    expect((await alice!.post<ErrorBody>(`/api/dms/${group.id}/members`, { userId: 'u_ghost' })).status).toBe(404);
    expect((await alice!.post<ErrorBody>(`/api/dms/${group.id}/members`, { userId: alice!.userId })).status).toBe(400);
    const addToDm = await alice!.post<ErrorBody>(`/api/dms/${oneOnOne.body.channel.id}/members`, { userId: carol!.userId });
    expect(addToDm.status).toBe(400);
    expect(addToDm.body.error).toBe('NOT_GROUP_DM');

    const removed = await alice!.delete(`/api/dms/${group.id}/members/${carol!.userId}`);
    expect(removed.status).toBe(200);
    expect((await carol!.get<ErrorBody>(`/api/dms/${group.id}`)).status).toBe(404);
    expect((await alice!.get<{ channel: DMChannel }>(`/api/dms/${group.id}`)).body.channel.members).toHaveLength(3);

    const bobRemovesDave = await bob!.delete<ErrorBody>(`/api/dms/${group.id}/members/${dave!.userId}`);
    expect(bobRemovesDave.status).toBe(403);
    const bobLeaves = await bob!.delete(`/api/dms/${group.id}`);
    expect(bobLeaves.status).toBe(200);
    expect((await bob!.get<ErrorBody>(`/api/dms/${group.id}`)).status).toBe(404);
    expect((await alice!.get<{ channel: DMChannel }>(`/api/dms/${group.id}`)).body.channel.members).toHaveLength(2);

    const removePeer = await alice!.delete<ErrorBody>(`/api/dms/${oneOnOne.body.channel.id}/members/${bob!.userId}`);
    expect(removePeer.status).toBe(403);
    const closeSelf = await alice!.delete(`/api/dms/${oneOnOne.body.channel.id}/members/${alice!.userId}`);
    expect(closeSelf.status).toBe(200);
    expect((await alice!.get<{ channels: DMChannel[] }>('/api/dms')).body.channels.map((c) => c.id))
      .not.toContain(oneOnOne.body.channel.id);

    const deleted = await alice!.delete(`/api/dms/${group.id}`);
    expect(deleted.status).toBe(200);
    expect((await dave!.get<ErrorBody>(`/api/dms/${group.id}`)).status).toBe(404);
  });

  test('friends: request, auto-accept, accept, decline, remove and achievements', async () => {
    const server = startTestServer();
    const [alice, bob, carol, dave] = await makeUsers(server, ['alice', 'bob', 'carol', 'dave']);

    const requested = await alice!.post<{ friend: Friend }>(`/api/friends/${bob!.userId}`);
    expect(requested.status).toBe(200);
    expect(requested.body.friend.status).toBe('pending_out');
    expect(requested.body.friend.user.id).toBe(bob!.userId);

    const bobLists = await bob!.get<FriendListsBody>('/api/users/@me/friends');
    expect(bobLists.status).toBe(200);
    expect(bobLists.body.incoming.map((f) => f.user.id)).toEqual([alice!.userId]);
    expect(bobLists.body.friends).toHaveLength(0);
    const aliceLists = await alice!.get<FriendListsBody>('/api/users/@me/friends');
    expect(aliceLists.body.outgoing.map((f) => f.user.id)).toEqual([bob!.userId]);

    expect((await alice!.post<ErrorBody>(`/api/friends/${bob!.userId}`)).status).toBe(409);
    expect((await alice!.post<ErrorBody>(`/api/friends/${alice!.userId}`)).status).toBe(400);
    expect((await alice!.post<ErrorBody>('/api/friends/u_ghost')).status).toBe(404);

    // Asking back auto-accepts the pending request.
    const auto = await bob!.post<{ friend: Friend }>(`/api/friends/${alice!.userId}`);
    expect(auto.status).toBe(200);
    expect(auto.body.friend.status).toBe('accepted');
    const aliceFriends = await alice!.get<FriendListsBody>('/api/users/@me/friends');
    expect(aliceFriends.body.friends.map((f) => f.user.id)).toContain(bob!.userId);
    expect(aliceFriends.body.outgoing).toHaveLength(0);
    const friendAchievements = server.runtime.db.all<{ key: string }>(
      "SELECT key FROM achievements WHERE user_id IN (?, ?) AND key = 'friend'", alice!.userId, bob!.userId,
    );
    expect(friendAchievements).toHaveLength(2);

    await alice!.post(`/api/friends/${carol!.userId}`);
    const accepted = await carol!.post<{ friend: Friend }>(`/api/friends/${alice!.userId}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.friend.status).toBe('accepted');
    const carolFriends = await carol!.get<FriendListsBody>('/api/users/@me/friends');
    expect(carolFriends.body.friends.map((f) => f.user.id)).toContain(alice!.userId);

    // Notifications carry the actor for the accepted request.
    const carolInbox = await carol!.get<NotificationInbox>('/api/notifications');
    const acceptedNotice = carolInbox.body.notifications.find((n) => n.type === 'friend_request');
    expect(acceptedNotice?.actor?.id).toBe(alice!.userId);

    await alice!.post(`/api/friends/${dave!.userId}`);
    const declined = await dave!.post(`/api/friends/${alice!.userId}/decline`);
    expect(declined.status).toBe(200);
    const afterDecline = await alice!.get<FriendListsBody>('/api/users/@me/friends');
    expect(afterDecline.body.outgoing.map((f) => f.user.id)).not.toContain(dave!.userId);
    expect((await dave!.post<ErrorBody>(`/api/friends/${alice!.userId}/accept`)).status).toBe(404);

    const removedFriend = await alice!.delete(`/api/friends/${carol!.userId}`);
    expect(removedFriend.status).toBe(200);
    const carolAfter = await carol!.get<FriendListsBody>('/api/users/@me/friends');
    expect(carolAfter.body.friends.map((f) => f.user.id)).not.toContain(alice!.userId);
    expect((await alice!.delete<ErrorBody>(`/api/friends/${carol!.userId}`)).status).toBe(404);
  });

  test('blocks are mutual: they stop DMs and friend requests, strip friendships, and stay private', async () => {
    const server = startTestServer();
    const [alice, bob, carol, dave] = await makeUsers(server, ['alice', 'bob', 'carol', 'dave']);

    await alice!.post(`/api/friends/${bob!.userId}`);
    await bob!.post(`/api/friends/${alice!.userId}/accept`);
    expect((await alice!.get<FriendListsBody>('/api/users/@me/friends')).body.friends).toHaveLength(1);

    const blocked = await alice!.post<{ friend: Friend; blocked: boolean }>(`/api/users/${bob!.userId}/block`);
    expect(blocked.status).toBe(200);
    expect(blocked.body.blocked).toBe(true);
    expect(blocked.body.friend.status).toBe('blocked');

    const aliceLists = await alice!.get<FriendListsBody>('/api/users/@me/friends');
    expect(aliceLists.body.friends).toHaveLength(0);
    expect(aliceLists.body.blocked.map((f) => f.user.id)).toEqual([bob!.userId]);
    const bobLists = await bob!.get<FriendListsBody>('/api/users/@me/friends');
    expect(bobLists.body.friends).toHaveLength(0);
    expect(bobLists.body.blocked).toHaveLength(0);

    const dmFromAlice = await alice!.post<ErrorBody>('/api/dms', { recipientIds: [bob!.userId] });
    expect(dmFromAlice.status).toBe(403);
    expect(dmFromAlice.body.error).toBe('BLOCKED');
    expect((await bob!.post<ErrorBody>('/api/dms', { recipientIds: [alice!.userId] })).status).toBe(403);

    expect((await alice!.post<ErrorBody>(`/api/friends/${bob!.userId}`)).status).toBe(403);
    expect((await bob!.post<ErrorBody>(`/api/friends/${alice!.userId}`)).status).toBe(403);

    // A blocked user cannot be summoned into a group DM by the blocker either.
    const group = await alice!.post<{ channel: DMChannel }>('/api/dms', {
      recipientIds: [carol!.userId, dave!.userId], name: 'Blocked Zone',
    });
    expect(group.status).toBe(200);
    const inviteBlocked = await alice!.post<ErrorBody>(`/api/dms/${group.body.channel.id}/members`, { userId: bob!.userId });
    expect(inviteBlocked.status).toBe(403);
    expect(inviteBlocked.body.error).toBe('BLOCKED');

    // Pending requests are wiped by the block, so acceptance has nothing left to accept.
    await carol!.post(`/api/friends/${bob!.userId}`);
    await bob!.post(`/api/users/${carol!.userId}/block`);
    expect((await bob!.post<ErrorBody>(`/api/friends/${carol!.userId}/accept`)).status).toBe(404);
    expect((await carol!.post<ErrorBody>(`/api/friends/${bob!.userId}`)).status).toBe(403);

    const unblocked = await alice!.delete(`/api/users/${bob!.userId}/block`);
    expect(unblocked.status).toBe(200);
    const reopened = await alice!.post<{ channel: DMChannel }>('/api/dms', { recipientIds: [bob!.userId] });
    expect(reopened.status).toBe(200);
    expect((await alice!.post<ErrorBody>(`/api/users/${alice!.userId}/block`)).status).toBe(400);
  });

  test('notifications: listing, filters, read marking, deletion and privacy', async () => {
    const server = startTestServer();
    const [alice, bob, carol] = await makeUsers(server, ['alice', 'bob', 'carol']);

    await alice!.post(`/api/friends/${bob!.userId}`);
    await carol!.post(`/api/friends/${bob!.userId}`);

    const inbox = await bob!.get<NotificationInbox>('/api/notifications');
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications).toHaveLength(2);
    expect(inbox.body.unreadCount).toBe(2);
    expect(inbox.body.notifications.every((n) => n.type === 'friend_request')).toBe(true);
    expect(inbox.body.notifications[0]!.actor?.id).toBe(carol!.userId);

    const limited = await bob!.get<NotificationInbox>('/api/notifications?limit=1');
    expect(limited.body.notifications).toHaveLength(1);
    expect(limited.body.unreadCount).toBe(2);
    const older = await bob!.get<NotificationInbox>(`/api/notifications?before=${limited.body.notifications[0]!.id}`);
    expect(older.body.notifications).toHaveLength(1);
    expect(older.body.notifications[0]!.id).not.toBe(limited.body.notifications[0]!.id);
    expect((await bob!.get<NotificationInbox>('/api/notifications?unread=true')).body.notifications).toHaveLength(2);
    expect((await bob!.get<ErrorBody>('/api/notifications?limit=0')).status).toBe(400);

    const aliceInbox = await alice!.get<NotificationInbox>('/api/notifications');
    expect(aliceInbox.body.notifications).toHaveLength(0);
    const victimId = inbox.body.notifications[0]!.id;
    expect((await alice!.delete<ErrorBody>(`/api/notifications/${victimId}`)).status).toBe(404);

    const mark = await bob!.post<{ unreadCount: number; readIds: string[] | null }>('/api/notifications/read', { ids: [victimId] });
    expect(mark.status).toBe(200);
    expect(mark.body.unreadCount).toBe(1);
    expect(mark.body.readIds).toEqual([victimId]);
    const afterMark = await bob!.get<NotificationInbox>('/api/notifications');
    expect(afterMark.body.unreadCount).toBe(1);
    expect(afterMark.body.notifications.find((n) => n.id === victimId)?.read).toBe(true);
    expect((await bob!.post<ErrorBody>('/api/notifications/read', {})).status).toBe(400);

    const allRead = await bob!.post<{ unreadCount: number }>('/api/notifications/read', { all: true });
    expect(allRead.body.unreadCount).toBe(0);
    const unreadOnly = await bob!.get<NotificationInbox>('/api/notifications?unread=true');
    expect(unreadOnly.body.notifications).toHaveLength(0);
    expect(unreadOnly.body.unreadCount).toBe(0);

    const single = await bob!.delete(`/api/notifications/${victimId}`);
    expect(single.status).toBe(200);
    expect((await bob!.delete<ErrorBody>(`/api/notifications/${victimId}`)).status).toBe(404);

    const wipe = await bob!.delete<{ ok: boolean; deleted: number }>('/api/notifications/all');
    expect(wipe.status).toBe(200);
    expect(wipe.body.deleted).toBeGreaterThan(0);
    expect((await bob!.get<NotificationInbox>('/api/notifications')).body.notifications).toHaveLength(0);
  });

  test('realtime: DM_CREATE, DM_UPDATE and FRIEND_UPDATE reach the right sockets', async () => {
    interface GatewayFrame {
      op?: string;
      t?: string;
      d?: { channel?: DMChannel; userId?: string; friend?: Friend | null };
    }
    const server = startTestServer();
    const [alice, bob, carol] = await makeUsers(server, ['alice', 'bob', 'carol']);
    const bobWs = await connectWs(bob!, server);
    try {
      // Heartbeat round-trip proves the hub has tracked this socket before we assert on dispatches.
      const pongPromise = waitFor<GatewayFrame>(bobWs, (frame: GatewayFrame) => frame.op === 'pong');
      bobWs.send(JSON.stringify({ op: 'heartbeat' }));
      await pongPromise;
      const createPromise = waitFor<GatewayFrame>(bobWs, (frame: GatewayFrame) =>
        frame.t === 'DM_CREATE' && frame.d?.channel?.members.some((m) => m.id === alice!.userId) === true);
      const created = await alice!.post<{ channel: DMChannel }>('/api/dms', { recipientIds: [bob!.userId] });
      const createdFrame = await createPromise;
      expect(createdFrame.d?.channel?.id).toBe(created.body.channel.id);
      expect(createdFrame.d?.channel?.name).toBe('alice');

      const group = await alice!.post<{ channel: DMChannel }>('/api/dms', {
        recipientIds: [bob!.userId, carol!.userId], name: 'Squad Goals',
      });
      expect(group.status).toBe(200);
      const updatePromise = waitFor<GatewayFrame>(bobWs, (frame: GatewayFrame) =>
        frame.t === 'DM_UPDATE' && frame.d?.channel?.id === group.body.channel.id && frame.d.channel.name === 'Renamed Squad');
      await alice!.patch(`/api/dms/${group.body.channel.id}`, { name: 'Renamed Squad' });
      const updateFrame = await updatePromise;
      expect(updateFrame.d?.channel?.name).toBe('Renamed Squad');

      const friendPromise = waitFor<GatewayFrame>(bobWs, (frame: GatewayFrame) =>
        frame.t === 'FRIEND_UPDATE' && frame.d?.userId === alice!.userId);
      await alice!.post(`/api/friends/${bob!.userId}`);
      const friendFrame = await friendPromise;
      expect(friendFrame.d?.friend?.status).toBe('pending_in');
      expect(friendFrame.d?.friend?.user.id).toBe(alice!.userId);
    } finally {
      bobWs.close();
    }
  });
});
