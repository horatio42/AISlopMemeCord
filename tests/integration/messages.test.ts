import { describe, expect, test, afterAll } from 'bun:test';
import { startTestServer, stopAllServers, makeUsers, connectWs, waitFor, type Client, type TestServer } from '../helpers';
import { DEFAULT_EVERYONE, Perm } from '../../src/shared/permissions';
import { newId } from '../../src/server/util/ids';
import { createMessage } from '../../src/server/services/messages';

afterAll(() => stopAllServers());

interface Fixture {
  server: TestServer;
  db: TestServer['runtime']['db'];
  alice: Client;
  bob: Client;
  carol: Client;
  serverId: string;
  everyoneRoleId: string;
  generalId: string;
  privateId: string;
  forumId: string;
  dmId: string;
}

async function setup(): Promise<Fixture> {
  const server = startTestServer();
  const [alice, bob, carol] = await makeUsers(server, ['alice', 'bob', 'carol']);
  const db = server.runtime.db;
  const now = Date.now();
  const serverId = newId('s');
  db.run('INSERT INTO servers (id, name, owner_id, member_count, created_at) VALUES (?, ?, ?, 2, ?)', serverId, 'Slop HQ', alice!.userId, now);
  db.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, alice!.userId, now);
  db.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', serverId, bob!.userId, now);
  const everyoneRoleId = newId('r');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
     VALUES (?, ?, '@everyone', '#99aab5', 0, ?, 0, 0, 1, ?)`,
    everyoneRoleId, serverId, DEFAULT_EVERYONE, now,
  );
  const generalId = newId('ch');
  db.run('INSERT INTO channels (id, server_id, type, name, position, created_at) VALUES (?, ?, ?, ?, 1, ?)', generalId, serverId, 'text', 'general', now);
  const privateId = newId('ch');
  db.run('INSERT INTO channels (id, server_id, type, name, position, created_at) VALUES (?, ?, ?, ?, 2, ?)', privateId, serverId, 'text', 'secret', now);
  db.run(
    'INSERT INTO channel_overrides (channel_id, target_type, target_id, allow, deny) VALUES (?, ?, ?, 0, ?)',
    privateId, 'role', everyoneRoleId, Perm.VIEW_CHANNEL,
  );
  const forumId = newId('ch');
  db.run(
    `INSERT INTO channels (id, server_id, type, name, position, tags, voting_enabled, created_at)
     VALUES (?, ?, 'forum', ?, 3, ?, 1, ?)`,
    forumId, serverId, 'memes', JSON.stringify(['meme', 'discussion']), now,
  );
  const dmId = newId('ch');
  db.run("INSERT INTO channels (id, server_id, type, name, created_at) VALUES (?, NULL, 'dm', '', ?)", dmId, now);
  db.run('INSERT INTO dm_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)', dmId, alice!.userId, now);
  db.run('INSERT INTO dm_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)', dmId, bob!.userId, now);
  return { server, db, alice: alice!, bob: bob!, carol: carol!, serverId, everyoneRoleId, generalId, privateId, forumId, dmId };
}

function send(client: Client, channelId: string, body: string | Record<string, unknown>) {
  return client.post(`/api/channels/${channelId}/messages`, typeof body === 'string' ? { content: body } : body);
}

function addUpload(db: Fixture['db'], ownerId: string, extra: { purpose?: string; contentType?: string } = {}): string {
  const id = newId('upl');
  db.run(
    `INSERT INTO uploads (id, owner_id, purpose, filename, content_type, size, path, sha256, width, height, message_id, created_at)
     VALUES (?, ?, ?, ?, ?, 1234, ?, ?, 640, 480, NULL, ?)`,
    id, ownerId, extra.purpose ?? 'attachment', 'slop.png', extra.contentType ?? 'image/png',
    `2026/10/${id}.png`, 'abc123', Date.now(),
  );
  return id;
}

describe('messages: send, list, edit, delete', () => {
  test('send + list around/before/after + GET single, nonce idempotency', async () => {
    const f = await setup();
    const first = await send(f.alice, f.generalId, 'hello slop world');
    expect(first.status).toBe(200);
    expect(first.body.message.content).toBe('hello slop world');
    expect(first.body.message.author.id).toBe(f.alice.userId);
    expect(first.body.message.serverId).toBe(f.serverId);
    const second = await send(f.bob, f.generalId, { content: 'reply slop', replyToId: first.body.message.id });
    expect(second.status).toBe(200);
    expect(second.body.message.replyTo.id).toBe(first.body.message.id);
    const third = await send(f.bob, f.generalId, 'third slop');

    const list = await f.bob.get(`/api/channels/${f.generalId}/messages?limit=2`);
    expect(list.status).toBe(200);
    expect(list.body.messages.map((m: MessageLike) => m.content)).toEqual(['reply slop', 'third slop']);
    expect(list.body.hasMore).toBe(true);

    const before = await f.bob.get(`/api/channels/${f.generalId}/messages?before=${third.body.message.id}`);
    expect(before.body.messages.map((m: MessageLike) => m.content)).toEqual(['hello slop world', 'reply slop']);
    const after = await f.bob.get(`/api/channels/${f.generalId}/messages?after=${first.body.message.id}`);
    expect(after.body.messages.map((m: MessageLike) => m.content)).toEqual(['reply slop', 'third slop']);
    const range = await f.bob.get(`/api/channels/${f.generalId}/messages?after=${first.body.message.id}&before=${third.body.message.id}`);
    expect(range.body.messages.map((m: MessageLike) => m.content)).toEqual(['reply slop']);
    expect(range.body.hasMore).toBe(false);
    const around = await f.bob.get(`/api/channels/${f.generalId}/messages?around=${second.body.message.id}&limit=2`);
    expect(around.body.messages.length).toBeLessThanOrEqual(2);
    expect(around.body.messages.some((m: MessageLike) => m.id === second.body.message.id)).toBe(true);

    const single = await f.bob.get(`/api/messages/${first.body.message.id}`);
    expect(single.status).toBe(200);
    expect(single.body.message.id).toBe(first.body.message.id);
    expect(single.body.channel.id).toBe(f.generalId);

    const n1 = await send(f.alice, f.generalId, { content: 'nonce slop', nonce: 'nonce-1' });
    const n2 = await send(f.alice, f.generalId, { content: 'nonce slop', nonce: 'nonce-1' });
    expect(n1.status).toBe(200);
    expect(n2.body.message.id).toBe(n1.body.message.id);
    const count = f.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE channel_id = ? AND json_extract(flags, \'$.nonce\') = ?', f.generalId, 'nonce-1');
    expect(count?.n).toBe(1);
  });

  test('edit and delete: author only, moderation delete, karma subtraction, deleted hidden', async () => {
    const f = await setup();
    const msg = await send(f.bob, f.generalId, 'editable slop');
    const id = msg.body.message.id;
    const denied = await f.alice.patch(`/api/messages/${id}`, { content: 'hijacked' });
    expect(denied.status).toBe(403);
    const edited = await f.bob.patch(`/api/messages/${id}`, { content: 'edited slop' });
    expect(edited.status).toBe(200);
    expect(edited.body.message.content).toBe('edited slop');
    expect(edited.body.message.editedAt).toBeNumber();
    const empty = await f.bob.patch(`/api/messages/${id}`, { content: '   ' });
    expect(empty.status).toBe(400);

    expect((await f.bob.put(`/api/messages/${id}/vote`, { value: 1 })).status).toBe(200);
    const beforeKarma = f.db.get<{ karma: number }>('SELECT karma FROM users WHERE id = ?', f.bob.userId)!.karma;
    const modDelete = await f.alice.delete(`/api/messages/${id}`);
    expect(modDelete.status).toBe(200);
    expect(modDelete.body.deleted).toBe(true);
    const afterKarma = f.db.get<{ karma: number }>('SELECT karma FROM users WHERE id = ?', f.bob.userId)!.karma;
    expect(afterKarma).toBe(beforeKarma - 1);
    const audit = f.db.get('SELECT * FROM audit_logs WHERE action = ? AND target_id = ?', 'MESSAGE_DELETE', id);
    expect(audit).toBeTruthy();
    const list = await f.bob.get(`/api/channels/${f.generalId}/messages`);
    expect(list.body.messages.some((m: MessageLike) => m.id === id)).toBe(false);
    const fetchDeleted = await f.bob.get(`/api/messages/${id}`);
    expect(fetchDeleted.status).toBe(404);

    const own = await send(f.alice, f.generalId, 'own delete');
    const ownDelete = await f.alice.delete(`/api/messages/${own.body.message.id}`);
    expect(ownDelete.status).toBe(200);
    const bobDeleteOther = await send(f.bob, f.generalId, 'bob protected');
    expect((await f.alice.delete(`/api/messages/${bobDeleteOther.body.message.id}`)).status).toBe(200);
    const bobCant = await send(f.alice, f.generalId, 'alice protects');
    expect((await f.bob.delete(`/api/messages/${bobCant.body.message.id}`)).status).toBe(403);
  });

  test('slowmode and timeout gates', async () => {
    const f = await setup();
    f.db.run('UPDATE channels SET slowmode = 60 WHERE id = ?', f.generalId);
    expect((await send(f.bob, f.generalId, 'first')).status).toBe(200);
    const second = await send(f.bob, f.generalId, 'second');
    expect(second.status).toBe(429);
    expect(second.body.error).toBe('SLOWMODE');

    f.db.run('UPDATE channels SET slowmode = 0 WHERE id = ?', f.generalId);
    f.db.run('UPDATE members SET timeout_until = ? WHERE server_id = ? AND user_id = ?', Date.now() + 60_000, f.serverId, f.bob.userId);
    const timedOut = await send(f.bob, f.generalId, 'timed out slop');
    expect(timedOut.status).toBe(403);
    expect(timedOut.body.error).toBe('MEMBER_TIMED_OUT');
    f.db.run('UPDATE members SET timeout_until = NULL WHERE server_id = ? AND user_id = ?', f.serverId, f.bob.userId);
    expect((await send(f.bob, f.generalId, 'free again')).status).toBe(200);

    f.db.run('UPDATE channels SET locked = 1 WHERE id = ?', f.generalId);
    expect((await send(f.bob, f.generalId, 'locked out')).status).toBe(403);
    expect((await send(f.alice, f.generalId, 'owner bypass')).status).toBe(200);
  });

  test('permissions: outsider, private channel, DM access', async () => {
    const f = await setup();
    expect((await send(f.alice, f.generalId, 'public slop')).status).toBe(200);
    expect((await f.carol.get(`/api/channels/${f.generalId}/messages`)).status).toBe(404);
    expect((await send(f.carol, f.generalId, 'intruder')).status).toBe(404);
    expect((await f.bob.get(`/api/channels/${f.privateId}/messages`)).status).toBe(403);
    expect((await send(f.bob, f.privateId, 'secret leak')).status).toBe(403);
    expect((await f.alice.get(`/api/channels/${f.privateId}/messages`)).status).toBe(200);

    const dm = await send(f.alice, f.dmId, 'dm slop');
    expect(dm.status).toBe(200);
    expect(dm.body.message.channelId).toBe(f.dmId);
    expect((await f.bob.get(`/api/channels/${f.dmId}/messages`)).status).toBe(200);
    expect((await f.carol.get(`/api/channels/${f.dmId}/messages`)).status).toBe(404);
    expect((await f.carol.get(`/api/messages/${dm.body.message.id}`)).status).toBe(404);
  });
});

describe('messages: attachments, polls, reactions, votes, awards, saved', () => {
  test('attachments require owned uploads with purpose attachment', async () => {
    const f = await setup();
    const bobUpload = addUpload(f.db, f.bob.userId);
    const stolen = await send(f.alice, f.generalId, { content: 'steal', attachmentIds: [bobUpload] });
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toBe('NOT_YOUR_UPLOAD');
    expect(f.db.get<{ message_id: string | null }>('SELECT message_id FROM uploads WHERE id = ?', bobUpload)?.message_id).toBeNull();

    const aliceUpload = addUpload(f.db, f.alice.userId);
    const ok = await send(f.alice, f.generalId, { content: 'meme dump', attachmentIds: [aliceUpload] });
    expect(ok.status).toBe(200);
    expect(ok.body.message.attachments.length).toBe(1);
    expect(ok.body.message.attachments[0].id).toBe(aliceUpload);
    expect(ok.body.message.attachments[0].url).toBe(`/api/attachments/${aliceUpload}`);
    expect(f.db.get<{ message_id: string | null }>('SELECT message_id FROM uploads WHERE id = ?', aliceUpload)?.message_id).toBe(ok.body.message.id);
    const attachment = f.db.get<{ path: string }>('SELECT path FROM attachments WHERE id = ?', aliceUpload);
    expect(attachment?.path).toBe(`2026/10/${aliceUpload}.png`);

    const avatarUpload = addUpload(f.db, f.alice.userId, { purpose: 'avatar' });
    const wrongPurpose = await send(f.alice, f.generalId, { content: 'avatar?', attachmentIds: [avatarUpload] });
    expect(wrongPurpose.status).toBe(400);
    expect(wrongPurpose.body.error).toBe('INVALID_ATTACHMENT');

    const ids = Array.from({ length: 11 }, () => addUpload(f.db, f.alice.userId));
    expect((await send(f.alice, f.generalId, { content: 'too many', attachmentIds: ids })).status).toBe(400);
  });

  test('polls validate and serialize options', async () => {
    const f = await setup();
    const poll = await send(f.alice, f.generalId, {
      content: '', poll: { question: 'Best slop?', options: ['meme', 'copypasta', 'goblin'], multiple: false, durationHours: 24 },
    });
    expect(poll.status).toBe(200);
    expect(poll.body.message.poll.question).toBe('Best slop?');
    expect(poll.body.message.poll.options.length).toBe(3);
    expect(poll.body.message.poll.multiple).toBe(false);
    expect(poll.body.message.poll.closesAt).toBeNumber();
    const stored = f.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM poll_options WHERE poll_id = ?', poll.body.message.poll.id);
    expect(stored?.n).toBe(3);
    const bad = await send(f.alice, f.generalId, { content: '', poll: { question: 'Only one?', options: ['lonely'] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_POLL');
    const dup = await send(f.alice, f.generalId, { content: '', poll: { question: 'Dupes?', options: ['same', 'SAME'] } });
    expect(dup.status).toBe(400);
    const empty = await send(f.alice, f.generalId, { content: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('EMPTY_MESSAGE');

    const opts = f.db.all<{ id: string }>('SELECT id FROM poll_options WHERE poll_id = ? ORDER BY position', poll.body.message.poll.id);
    const vote1 = await f.bob.post(`/api/messages/${poll.body.message.id}/poll/vote`, { optionIds: [opts[0]!.id] });
    expect(vote1.status).toBe(200);
    expect(vote1.body.poll.totalVotes).toBe(1);
    expect(vote1.body.poll.myVotes).toEqual([opts[0]!.id]);
    const multiSingle = await f.bob.post(`/api/messages/${poll.body.message.id}/poll/vote`, { optionIds: [opts[0]!.id, opts[1]!.id] });
    expect(multiSingle.status).toBe(400);
    expect(multiSingle.body.error).toBe('POLL_SINGLE_CHOICE');
    expect((await f.bob.post(`/api/messages/${poll.body.message.id}/poll/vote`, { optionId: 'po_nope' })).status).toBe(400);
    const cleared = await f.bob.delete(`/api/messages/${poll.body.message.id}/poll/vote`);
    expect(cleared.body.poll.totalVotes).toBe(0);
    expect((await f.bob.post('/api/messages/m_nope/poll/vote', { optionId: opts[0]!.id })).status).toBe(404);

    const multiPoll = await send(f.alice, f.generalId, { content: '', poll: { question: 'Pick several', options: ['a', 'b', 'c'], multiple: true } });
    const mopts = f.db.all<{ id: string }>('SELECT id FROM poll_options WHERE poll_id = ? ORDER BY position', multiPoll.body.message.poll.id);
    const multiVote = await f.bob.post(`/api/messages/${multiPoll.body.message.id}/poll/vote`, { optionIds: [mopts[0]!.id, mopts[2]!.id] });
    expect(multiVote.status).toBe(200);
    expect(multiVote.body.poll.totalVotes).toBe(2);
    expect(multiVote.body.poll.myVotes.length).toBe(2);
    f.db.run('UPDATE polls SET closes_at = ? WHERE id = ?', Date.now() - 1_000, multiPoll.body.message.poll.id);
    const closed = await f.bob.post(`/api/messages/${multiPoll.body.message.id}/poll/vote`, { optionId: mopts[1]!.id });
    expect(closed.status).toBe(400);
    expect(closed.body.error).toBe('POLL_CLOSED');
  });

  test('reactions toggle, validate unicode and custom emoji', async () => {
    const f = await setup();
    const msg = await send(f.alice, f.generalId, 'react to me');
    const id = msg.body.message.id;
    const fire = encodeURIComponent('🔥');
    const added = await f.bob.put(`/api/messages/${id}/reactions/${fire}`);
    expect(added.status).toBe(200);
    expect(added.body.reactions).toEqual([{ emoji: '🔥', count: 1, me: true, userIds: [f.bob.userId] }]);
    const again = await f.bob.put(`/api/messages/${id}/reactions/${fire}`);
    expect(again.body.reactions[0].count).toBe(1);

    const emojiId = newId('e');
    f.db.run(
      "INSERT INTO emojis (id, server_id, name, path, animated, created_at) VALUES (?, ?, 'party', 'emojis/party.png', 0, ?)",
      emojiId, f.serverId, Date.now(),
    );
    const customPath = encodeURIComponent(`<:party:${emojiId}>`);
    const custom = await f.bob.put(`/api/messages/${id}/reactions/${customPath}`);
    expect(custom.status).toBe(200);
    expect(custom.body.reactions.some((r: { emoji: string; count: number }) => r.emoji === `<:party:${emojiId}>` && r.count === 1)).toBe(true);

    const inlineOk = await send(f.bob, f.generalId, `inline emoji <:party:${emojiId}> slop`);
    expect(inlineOk.status).toBe(200);
    const inlineMissing = await send(f.bob, f.generalId, 'bad emoji <:ghost:notarealid>');
    expect(inlineMissing.status).toBe(400);
    expect(inlineMissing.body.error).toBe('INVALID_EMOJI');
    const foreignServer = newId('s');
    f.db.run('INSERT INTO servers (id, name, owner_id, member_count, created_at) VALUES (?, ?, ?, 1, ?)', foreignServer, 'Other Slop', f.bob.userId, Date.now());
    const foreignEmojiId = newId('e');
    f.db.run("INSERT INTO emojis (id, server_id, name, path, animated, created_at) VALUES (?, ?, 'stolen', 'emojis/s.png', 0, ?)", foreignEmojiId, foreignServer, Date.now());
    expect((await send(f.bob, f.generalId, `external <:stolen:${foreignEmojiId}>`)).status).toBe(200);
    f.db.run('UPDATE roles SET permissions = ? WHERE id = ?', DEFAULT_EVERYONE & ~Perm.EXTERNAL_EMOJIS, f.everyoneRoleId);
    const externalDenied = await send(f.bob, f.generalId, `external again <:stolen:${foreignEmojiId}>`);
    expect(externalDenied.status).toBe(400);
    expect(externalDenied.body.error).toBe('INVALID_EMOJI');
    expect((await send(f.alice, f.generalId, `owner <:stolen:${foreignEmojiId}>`)).status).toBe(200);

    const bogus = await f.bob.put(`/api/messages/${id}/reactions/${encodeURIComponent('<:party:notarealid>')}`);
    expect(bogus.status).toBe(400);
    expect(bogus.body.error).toBe('INVALID_EMOJI');
    expect((await f.bob.put(`/api/messages/${id}/reactions/${encodeURIComponent('x'.repeat(200))}`)).status).toBe(400);

    const removed = await f.bob.delete(`/api/messages/${id}/reactions/${fire}`);
    expect(removed.status).toBe(200);
    expect(removed.body.reactions.some((r: { emoji: string }) => r.emoji === '🔥')).toBe(false);
    const outsider = await f.carol.put(`/api/messages/${id}/reactions/${fire}`);
    expect(outsider.status).toBe(404);
  });

  test('votes update score and author karma, achievements fire', async () => {
    const f = await setup();
    const msg = await send(f.alice, f.generalId, 'vote on this');
    const id = msg.body.message.id;
    const up = await f.bob.put(`/api/messages/${id}/vote`, { value: 1 });
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ score: 1, myVote: 1, karma: 1 });
    const clear = await f.bob.put(`/api/messages/${id}/vote`, { value: 0 });
    expect(clear.body).toEqual({ score: 0, myVote: 0, karma: 0 });
    const down = await f.bob.put(`/api/messages/${id}/vote`, { value: -1 });
    expect(down.body).toEqual({ score: -1, myVote: -1, karma: -1 });
    const seen = await f.bob.get(`/api/messages/${id}`);
    expect(seen.body.message.score).toBe(-1);
    expect(seen.body.message.myVote).toBe(-1);
    expect((await f.bob.put(`/api/messages/${id}/vote`, { value: 5 })).status).toBe(400);

    const ratioMsg = await send(f.alice, f.generalId, 'ratio candidate');
    f.db.run('UPDATE messages SET score = -9 WHERE id = ?', ratioMsg.body.message.id);
    await f.bob.put(`/api/messages/${ratioMsg.body.message.id}/vote`, { value: -1 });
    expect(f.db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', f.alice.userId, 'ratio')).toBeTruthy();

    f.db.run('UPDATE users SET karma = 99 WHERE id = ?', f.alice.userId);
    const basedMsg = await send(f.alice, f.generalId, 'based candidate');
    const basedVote = await f.bob.put(`/api/messages/${basedMsg.body.message.id}/vote`, { value: 1 });
    expect(basedVote.body.karma).toBe(100);
    expect(f.db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', f.alice.userId, 'based')).toBeTruthy();

    const dm = await send(f.alice, f.dmId, 'dm vote');
    const dmVote = await f.bob.put(`/api/messages/${dm.body.message.id}/vote`, { value: 1 });
    expect(dmVote.status).toBe(200);
    expect(dmVote.body.score).toBe(1);
  });

  test('awards validate, saved messages toggle', async () => {
    const f = await setup();
    const msg = await send(f.alice, f.generalId, 'award me');
    const id = msg.body.message.id;
    const award = await f.bob.post(`/api/messages/${id}/award`, { award: 'based' });
    expect(award.status).toBe(200);
    expect(award.body.message.awards).toEqual([{ key: 'based', count: 1 }]);
    const invalid = await f.bob.post(`/api/messages/${id}/award`, { award: 'fake_economy' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('INVALID_AWARD');

    const saved = await f.bob.post(`/api/messages/${id}/save`);
    expect(saved.body).toEqual({ saved: true, messageId: id });
    expect((await f.bob.get(`/api/messages/${id}`)).body.message.saved).toBe(true);
    expect((await f.alice.get(`/api/messages/${id}`)).body.message.saved).toBe(false);
    const unsaved = await f.bob.delete(`/api/messages/${id}/save`);
    expect(unsaved.body).toEqual({ saved: false, messageId: id });
    expect((await f.bob.get(`/api/messages/${id}`)).body.message.saved).toBe(false);
  });
});

interface MessageLike {
  id: string;
  content: string;
  channelId: string;
  score: number;
  myVote: number;
  mentions: { users: string[]; everyone: boolean };
  reactions: { emoji: string; count: number; me: boolean }[];
  attachments: { id: string }[];
  poll: { id: string; options: unknown[] } | null;
  awards: { key: string; count: number }[];
  saved: boolean;
  author: { id: string };
  replyTo: { id: string } | null;
  editedAt: number | null;
  pinned: boolean;
}

describe('messages: mentions, notifications, reads, typing, pins, purge, reports', () => {
  test('mentions and replies notify once, self excluded, @everyone gated', async () => {
    const f = await setup();
    const mention = await send(f.alice, f.generalId, `hey <@${f.bob.userId}> look at this slop`);
    expect(mention.status).toBe(200);
    expect(mention.body.message.mentions.users).toContain(f.bob.userId);
    const note = f.db.get<{ type: string }>('SELECT type FROM notifications WHERE user_id = ? AND message_id = ?', f.bob.userId, mention.body.message.id);
    expect(note?.type).toBe('mention');
    const state = f.db.get<{ mention_count: number }>('SELECT mention_count FROM read_states WHERE user_id = ? AND channel_id = ?', f.bob.userId, f.generalId);
    expect(state?.mention_count).toBe(1);

    const reply = await send(f.bob, f.generalId, { content: 'replying', replyToId: mention.body.message.id });
    expect(reply.status).toBe(200);
    const replyNote = f.db.get<{ type: string }>('SELECT type FROM notifications WHERE user_id = ? AND message_id = ?', f.alice.userId, reply.body.message.id);
    expect(replyNote?.type).toBe('reply');

    const dedupe = await send(f.bob, f.generalId, { content: `<@${f.alice.userId}> both mention and reply`, replyToId: mention.body.message.id });
    const dupCount = f.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND message_id = ?', f.alice.userId, dedupe.body.message.id);
    expect(dupCount?.n).toBe(1);
    expect(f.db.get<{ type: string }>('SELECT type FROM notifications WHERE user_id = ? AND message_id = ?', f.alice.userId, dedupe.body.message.id)?.type).toBe('mention');

    const beforeSelf = f.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', f.alice.userId)!.n;
    await send(f.alice, f.generalId, `<@${f.alice.userId}> talking to myself`);
    const afterSelf = f.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', f.alice.userId)!.n;
    expect(afterSelf).toBe(beforeSelf);

    const denied = await send(f.bob, f.generalId, '@everyone assemble');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('MISSING_PERMISSIONS');
    const everyone = await send(f.alice, f.generalId, '@everyone assemble');
    expect(everyone.status).toBe(200);
    expect(everyone.body.message.mentions.everyone).toBe(true);
    const everyoneNote = f.db.get('SELECT 1 FROM notifications WHERE user_id = ? AND message_id = ?', f.bob.userId, everyone.body.message.id);
    expect(everyoneNote).toBeTruthy();

    const roleId = newId('r');
    f.db.run(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
       VALUES (?, ?, 'Ping Squad', '#ff0000', 1, 0, 1, 0, 0, ?)`,
      roleId, f.serverId, Date.now(),
    );
    f.db.run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', f.serverId, f.bob.userId, roleId);
    const roleMention = await send(f.alice, f.generalId, `<@&${roleId}> get in here`);
    expect(roleMention.status).toBe(200);
    expect(roleMention.body.message.mentions.roles).toContain(roleId);
    expect(f.db.get('SELECT 1 FROM notifications WHERE user_id = ? AND message_id = ?', f.bob.userId, roleMention.body.message.id)).toBeTruthy();
  });

  test('read state updates DM last_read and resets mentions; typing throttles', async () => {
    const f = await setup();
    const msg = await send(f.alice, f.generalId, `<@${f.bob.userId}> unread slop`);
    const id = msg.body.message.id;
    const read = await f.bob.post(`/api/channels/${f.generalId}/read`, { messageId: id });
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ channelId: f.generalId, lastReadId: id, mentionCount: 0 });
    const state = f.db.get<{ last_read_id: string; mention_count: number }>('SELECT last_read_id, mention_count FROM read_states WHERE user_id = ? AND channel_id = ?', f.bob.userId, f.generalId);
    expect(state?.last_read_id).toBe(id);
    expect(state?.mention_count).toBe(0);
    const badRead = await f.bob.post(`/api/channels/${f.generalId}/read`, { messageId: 'm_nope' });
    expect(badRead.status).toBe(404);

    const dm = await send(f.alice, f.dmId, 'dm unread slop');
    const dmRead = await f.bob.post(`/api/channels/${f.dmId}/read`, { messageId: dm.body.message.id });
    expect(dmRead.status).toBe(200);
    const dmState = f.db.get<{ last_read_id: string }>('SELECT last_read_id FROM dm_members WHERE channel_id = ? AND user_id = ?', f.dmId, f.bob.userId);
    expect(dmState?.last_read_id).toBe(dm.body.message.id);

    const first = await f.bob.post(`/api/channels/${f.generalId}/typing`);
    expect(first.status).toBe(200);
    expect(first.body.throttled).toBe(false);
    const second = await f.bob.post(`/api/channels/${f.generalId}/typing`);
    expect(second.body.throttled).toBe(true);
    expect((await f.carol.post(`/api/channels/${f.generalId}/typing`)).status).toBe(404);
    const ws = await connectWs(f.bob, f.server);
    const readP = waitFor<{ t: string; d: { channelId: string; lastReadId: string; mentionCount: number } }>(ws, (e: { t?: string; d?: { channelId?: string } }) => e.t === 'READ_STATE_UPDATE' && e.d?.channelId === f.generalId);
    await f.bob.post(`/api/channels/${f.generalId}/read`, { messageId: id });
    const readEvent = await readP;
    expect(readEvent.d.mentionCount).toBe(0);
    expect(readEvent.d.lastReadId).toBe(id);
    ws.close();
  });

  test('pins require PIN_MESSAGES and purge requires MANAGE_MESSAGES', async () => {
    const f = await setup();
    const msg = await send(f.bob, f.generalId, 'pin me');
    const id = msg.body.message.id;
    expect((await f.bob.post(`/api/messages/${id}/pin`)).status).toBe(403);
    const pinned = await f.alice.post(`/api/messages/${id}/pin`);
    expect(pinned.status).toBe(200);
    expect(pinned.body.message.pinned).toBe(true);
    const pins = await f.bob.get(`/api/channels/${f.generalId}/pins`);
    expect(pins.status).toBe(200);
    expect(pins.body.pins.map((m: MessageLike) => m.id)).toContain(id);
    const unpinned = await f.alice.delete(`/api/messages/${id}/pin`);
    expect(unpinned.body.message.pinned).toBe(false);
    expect((await f.bob.get(`/api/channels/${f.generalId}/pins`)).body.pins.length).toBe(0);

    const m1 = await send(f.alice, f.generalId, 'purge one');
    const m2 = await send(f.alice, f.generalId, 'purge two');
    const m3 = await send(f.alice, f.generalId, 'purge three');
    expect((await f.bob.post(`/api/channels/${f.generalId}/purge`, { amount: 2 })).status).toBe(403);
    const purge = await f.alice.post(`/api/channels/${f.generalId}/purge`, { amount: 2 });
    expect(purge.status).toBe(200);
    expect(purge.body.deleted).toBe(2);
    const remaining = await f.bob.get(`/api/channels/${f.generalId}/messages`);
    const remainingIds = remaining.body.messages.map((m: MessageLike) => m.id);
    expect(remainingIds).toContain(msg.body.message.id);
    expect(remainingIds).not.toContain(m2.body.message.id);
    expect(remainingIds).not.toContain(m3.body.message.id);
    expect(f.db.get('SELECT 1 FROM audit_logs WHERE action = ?', 'MESSAGE_PURGE')).toBeTruthy();
    void m1;
  });

  test('reports dedupe and notify admins plus server moderators', async () => {
    const f = await setup();
    const msg = await send(f.alice, f.generalId, 'reportable slop');
    const modRoleId = newId('r');
    f.db.run(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
       VALUES (?, ?, 'Janitor', '#00ff00', 2, ?, 0, 0, 0, ?)`,
      modRoleId, f.serverId, Perm.MANAGE_MESSAGES, Date.now(),
    );
    f.db.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)', f.serverId, f.carol.userId, Date.now());
    f.db.run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', f.serverId, f.carol.userId, modRoleId);

    const report = await f.bob.post(`/api/messages/${msg.body.message.id}/report`, { reason: 'This slop is illegal' });
    expect(report.status).toBe(200);
    expect(report.body.report.status).toBe('open');
    expect(report.body.report.guildId).toBe(f.serverId);
    expect(report.body.report.targetUser.id).toBe(f.alice.userId);
    expect(report.body.report.reporter.id).toBe(f.bob.userId);
    expect(report.body.report.message.id).toBe(msg.body.message.id);
    const duplicate = await f.bob.post(`/api/messages/${msg.body.message.id}/report`, { reason: 'Again' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('REPORT_EXISTS');
    const adminNote = f.db.get('SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND message_id = ?', f.alice.userId, 'report', msg.body.message.id);
    const modNote = f.db.get('SELECT 1 FROM notifications WHERE user_id = ? AND type = ? AND message_id = ?', f.carol.userId, 'report', msg.body.message.id);
    expect(adminNote).toBeTruthy();
    expect(modNote).toBeTruthy();
    expect((await f.bob.post(`/api/messages/${msg.body.message.id}/report`, { reason: 'x' })).status).toBe(400);
  });
});

describe('messages: exported createMessage and achievements', () => {
  test('createMessage grants first_message/night_owl/shitposter/e2ee and bypasses gates for system messages', async () => {
    const f = await setup();
    await send(f.alice, f.generalId, 'first ever slop');
    expect(f.db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', f.alice.userId, 'first_message')).toBeTruthy();

    const at3am = new Date();
    at3am.setHours(3, 0, 0, 0);
    const night = createMessage(f.db, f.server.runtime.hub, {
      channelId: f.generalId, authorId: f.bob.userId, content: 'up late slop', createdAt: at3am.getTime(),
    }, f.server.runtime.config);
    expect(night.content).toBe('up late slop');
    expect(f.db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', f.bob.userId, 'night_owl')).toBeTruthy();

    for (let i = 0; i < 100; i++) {
      createMessage(f.db, f.server.runtime.hub, { channelId: f.generalId, authorId: f.bob.userId, content: `spam slop ${i}`, skipChecks: true }, f.server.runtime.config);
    }
    expect(f.db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', f.bob.userId, 'shitposter')).toBeTruthy();

    const enc = await send(f.alice, f.dmId, { content: 'ciphertext slop', encrypted: true });
    expect(enc.status).toBe(200);
    expect(f.db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', f.alice.userId, 'e2ee')).toBeTruthy();

    f.db.run('UPDATE channels SET locked = 1, slowmode = 600 WHERE id = ?', f.generalId);
    const system = createMessage(f.db, f.server.runtime.hub, {
      channelId: f.generalId, authorId: f.bob.userId, content: 'system slop', type: 'system', skipChecks: true,
    }, f.server.runtime.config);
    expect(system.system).toBe(true);
    expect((await send(f.bob, f.generalId, 'still locked for humans')).status).toBe(403);
  });
});

describe('messages: threads and forums', () => {
  test('thread create, list, permissions, archive/lock updates, sending', async () => {
    const f = await setup();
    const root = await send(f.alice, f.generalId, 'thread root slop');
    const ws = await connectWs(f.bob, f.server);
    f.server.runtime.hub.invalidateChannel(f.generalId);
    const threadEventP = waitFor<{ t: string; d: { thread: { id: string; type: string } } }>(ws, (e: { t?: string }) => e.t === 'THREAD_CREATE');
    const channelEventP = waitFor<{ t: string }>(ws, (e: { t?: string }) => e.t === 'CHANNEL_CREATE');
    const created = await f.alice.post(`/api/messages/${root.body.message.id}/thread`, { name: 'Deep Thoughts' });
    expect(created.status).toBe(200);
    expect((await threadEventP).d.thread.type).toBe('thread');
    expect((await channelEventP).t).toBe('CHANNEL_CREATE');
    const thread = created.body.thread;
    expect(thread.type).toBe('thread');
    expect(thread.parentId).toBe(f.generalId);
    expect(thread.originMessageId).toBe(root.body.message.id);
    expect(thread.serverId).toBe(f.serverId);
    expect(created.body.message.system).toBe(true);
    const systemRow = f.db.get<{ type: string }>('SELECT type FROM messages WHERE channel_id = ?', thread.id);
    expect(systemRow?.type).toBe('system');

    const active = await f.bob.get(`/api/channels/${f.generalId}/threads`);
    expect(active.status).toBe(200);
    expect(active.body.threads.map((t: { id: string }) => t.id)).toContain(thread.id);

    expect((await f.bob.patch(`/api/threads/${thread.id}`, { name: 'Hijacked' })).status).toBe(403);
    const updated = await f.alice.patch(`/api/threads/${thread.id}`, { name: 'Renamed Thread', archived: true });
    expect(updated.status).toBe(200);
    expect(updated.body.thread.name).toBe('Renamed Thread');
    expect(updated.body.thread.archived).toBe(true);
    const hidden = await f.bob.get(`/api/channels/${f.generalId}/threads`);
    expect(hidden.body.threads.map((t: { id: string }) => t.id)).not.toContain(thread.id);
    const included = await f.bob.get(`/api/channels/${f.generalId}/threads?includeArchived=1`);
    expect(included.body.threads.map((t: { id: string }) => t.id)).toContain(thread.id);

    const blocked = await send(f.bob, thread.id, 'into archived thread');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('THREAD_ARCHIVED');
    await f.alice.patch(`/api/threads/${thread.id}`, { archived: false, locked: true });
    const locked = await send(f.bob, thread.id, 'into locked thread');
    expect(locked.status).toBe(403);
    expect(locked.body.error).toBe('THREAD_LOCKED');
    const modSend = await send(f.alice, thread.id, 'mod can talk');
    expect(modSend.status).toBe(200);
    expect(f.db.get<{ last_message_id: string }>('SELECT last_message_id FROM channels WHERE id = ?', thread.id)?.last_message_id).toBe(modSend.body.message.id);
    expect((await f.bob.patch(`/api/threads/${f.generalId}`, { name: 'not a thread' })).status).toBe(404);
  });

  test('forum posts: tags, sorting, voting, replies, archive filter', async () => {
    const f = await setup();
    const post1 = await f.alice.post(`/api/channels/${f.forumId}/posts`, { title: 'Post one', content: 'forum slop one', tags: ['meme'] });
    expect(post1.status).toBe(200);
    expect(post1.body.thread.type).toBe('thread');
    expect(post1.body.thread.parentId).toBe(f.forumId);
    expect(post1.body.thread.tags).toEqual(['meme']);
    expect(post1.body.firstMessage.content).toBe('forum slop one');
    expect(post1.body.thread.originMessageId).toBe(post1.body.firstMessage.id);
    const badTag = await f.alice.post(`/api/channels/${f.forumId}/posts`, { title: 'Bad tag', content: 'nope', tags: ['illegal'] });
    expect(badTag.status).toBe(400);
    expect(badTag.body.error).toBe('INVALID_TAG');
    expect((await f.alice.post(`/api/channels/${f.generalId}/posts`, { title: 'x y', content: 'not forum' })).status).toBe(400);

    const post2 = await f.bob.post(`/api/channels/${f.forumId}/posts`, { title: 'Post two', content: 'forum slop two', tags: ['discussion'] });
    expect(post2.status).toBe(200);
    f.db.run('UPDATE channels SET created_at = ? WHERE id = ?', Date.now() - 10_000, post1.body.thread.id);

    const fresh = await f.bob.get(`/api/channels/${f.forumId}/posts?sort=new`);
    expect(fresh.status).toBe(200);
    expect(fresh.body.posts.map((p: { thread: { name: string } }) => p.thread.name)).toEqual(['Post two', 'Post one']);
    expect(fresh.body.hasMore).toBe(false);

    await f.bob.put(`/api/messages/${post1.body.firstMessage.id}/vote`, { value: 1 });
    const top = await f.bob.get(`/api/channels/${f.forumId}/posts?sort=top`);
    expect(top.body.posts[0].thread.id).toBe(post1.body.thread.id);
    expect(top.body.posts[0].score).toBe(1);

    const tagged = await f.bob.get(`/api/channels/${f.forumId}/posts?tag=meme`);
    expect(tagged.body.posts.length).toBe(1);
    expect(tagged.body.posts[0].thread.id).toBe(post1.body.thread.id);

    const reply = await send(f.bob, post1.body.thread.id, 'forum reply slop');
    expect(reply.status).toBe(200);
    const afterReply = await f.bob.get(`/api/channels/${f.forumId}/posts?sort=hot&includeArchived=1`);
    const p1 = afterReply.body.posts.find((p: { thread: { id: string } }) => p.thread.id === post1.body.thread.id);
    expect(p1.replyCount).toBe(1);
    const participantIds = p1.participants.map((u: { id: string }) => u.id);
    expect(participantIds).toContain(f.alice.userId);
    expect(participantIds).toContain(f.bob.userId);

    const archived = await f.alice.patch(`/api/threads/${post1.body.thread.id}`, { archived: true });
    expect(archived.status).toBe(200);
    expect((await f.bob.get(`/api/channels/${f.forumId}/posts`)).body.posts.map((p: { thread: { id: string } }) => p.thread.id)).not.toContain(post1.body.thread.id);
    expect((await f.bob.get(`/api/channels/${f.forumId}/posts?includeArchived=1`)).body.posts.map((p: { thread: { id: string } }) => p.thread.id)).toContain(post1.body.thread.id);

    f.db.run('UPDATE channels SET voting_enabled = 0 WHERE id = ?', f.forumId);
    const disabled = await f.alice.put(`/api/messages/${post2.body.firstMessage.id}/vote`, { value: 1 });
    expect(disabled.status).toBe(400);
    expect(disabled.body.error).toBe('VOTING_DISABLED');
  });
});

describe('messages: search privacy and encryption', () => {
  test('search respects channel access, filters, excludes encrypted', async () => {
    const f = await setup();
    await send(f.alice, f.generalId, 'banana slop');
    await send(f.bob, f.generalId, 'banana reply');
    await send(f.alice, f.privateId, 'banana secret');
    await send(f.alice, f.dmId, 'banana dm');
    const encrypted = await send(f.alice, f.dmId, { content: 'banana ciphertext', encrypted: true, cryptoMeta: { alg: 'x' } });
    expect(encrypted.status).toBe(200);
    expect(encrypted.body.message.encrypted).toBe(true);
    const serverEncrypted = await send(f.alice, f.generalId, { content: 'banana plaintext?', encrypted: true });
    expect(serverEncrypted.status).toBe(400);
    expect(serverEncrypted.body.error).toBe('ENCRYPTION_NOT_ALLOWED');

    const upload = addUpload(f.db, f.alice.userId);
    await send(f.alice, f.generalId, { content: 'banana image', attachmentIds: [upload] });
    await send(f.alice, f.generalId, 'banana link https://example.com/slop');

    const found = await f.bob.get('/api/search?q=banana');
    expect(found.status).toBe(200);
    expect(found.body.total).toBeGreaterThan(0);
    const contents = found.body.messages.map((m: MessageLike) => m.content);
    expect(contents).toContain('banana slop');
    expect(contents).toContain('banana reply');
    expect(contents).toContain('banana dm');
    expect(contents).not.toContain('banana secret');
    expect(contents).not.toContain('banana ciphertext');

    const aliceSearch = await f.alice.get('/api/search?q=banana');
    expect(aliceSearch.body.messages.map((m: MessageLike) => m.content)).toContain('banana secret');
    expect(aliceSearch.body.messages.map((m: MessageLike) => m.content)).not.toContain('banana ciphertext');

    const outsider = await f.carol.get('/api/search?q=banana');
    expect(outsider.status).toBe(200);
    expect(outsider.body.messages).toEqual([]);
    expect(outsider.body.total).toBe(0);
    expect((await f.carol.get(`/api/search?q=banana&channelId=${f.generalId}`)).status).toBe(403);
    expect((await f.carol.get(`/api/search?q=banana&serverId=${f.serverId}`)).status).toBe(403);
    expect((await f.bob.get(`/api/search?q=banana&channelId=${f.privateId}`)).status).toBe(403);

    f.db.run('UPDATE users SET is_admin = 1 WHERE id = ?', f.carol.userId);
    const adminSearch = await f.carol.get(`/api/search?q=banana&serverId=${f.serverId}`);
    expect(adminSearch.status).toBe(200);
    const adminContents = adminSearch.body.messages.map((m: MessageLike) => m.content);
    expect(adminContents).toContain('banana secret');
    expect(adminContents).not.toContain('banana dm');
    f.db.run('UPDATE users SET is_admin = 0 WHERE id = ?', f.carol.userId);

    const byChannel = await f.bob.get(`/api/search?q=banana&channelId=${f.generalId}`);
    expect(byChannel.body.messages.every((m: MessageLike) => m.channelId === f.generalId)).toBe(true);
    const byAuthor = await f.alice.get(`/api/search?q=banana&authorId=${f.bob.userId}`);
    expect(byAuthor.body.messages.map((m: MessageLike) => m.content)).toEqual(['banana reply']);
    const images = await f.bob.get('/api/search?q=banana&has=image');
    expect(images.body.messages.map((m: MessageLike) => m.content)).toContain('banana image');
    const files = await f.bob.get('/api/search?q=banana&has=file');
    expect(files.body.messages.map((m: MessageLike) => m.content)).toContain('banana image');
    const links = await f.bob.get('/api/search?q=banana&has=link');
    expect(links.body.messages.map((m: MessageLike) => m.content)).toContain('banana link https://example.com/slop');
    const paged = await f.bob.get('/api/search?q=banana&limit=1&offset=1');
    expect(paged.body.messages.length).toBe(1);
    const sanitized = await f.bob.get(`/api/search?q=${encodeURIComponent('"* OR AND')}`);
    expect(sanitized.status).toBe(200);
    expect((await f.bob.get('/api/search?q=')).status).toBe(400);
  });

  test('realtime MESSAGE_CREATE/UPDATE/DELETE reach channel viewers', async () => {
    const f = await setup();
    const ws = await connectWs(f.bob, f.server);
    try {
      const createdP = waitFor<{ t: string; d: { message: MessageLike } }>(ws, (e: { t?: string; d?: { message?: { content?: string } } }) => e.t === 'MESSAGE_CREATE' && e.d?.message?.content === 'realtime slop');
      const sent = await send(f.alice, f.generalId, 'realtime slop');
      const created = await createdP;
      expect(created.d.message.id).toBe(sent.body.message.id);
      const id = sent.body.message.id;

      const updatedP = waitFor<{ t: string; d: { message: MessageLike } }>(ws, (e: { t?: string; d?: { message?: { content?: string } } }) => e.t === 'MESSAGE_UPDATE' && e.d?.message?.content === 'realtime edited');
      await f.alice.patch(`/api/messages/${id}`, { content: 'realtime edited' });
      expect((await updatedP).d.message.id).toBe(id);

      const deletedP = waitFor<{ t: string; d: { messageId: string } }>(ws, (e: { t?: string; d?: { messageId?: string } }) => e.t === 'MESSAGE_DELETE' && e.d?.messageId === id);
      await f.alice.delete(`/api/messages/${id}`);
      expect((await deletedP).d.messageId).toBe(id);
    } finally {
      ws.close();
    }
  });
});
