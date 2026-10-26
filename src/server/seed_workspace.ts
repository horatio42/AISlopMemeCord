import type { DatabaseWrapper } from './db';
import { newId } from './util/ids';
import { DEFAULT_EVERYONE, Perm } from '../shared/permissions';
import { COPYPASTAS } from '../shared/memes';

const STATIC = '/static/assets';

export interface SeedWorld {
  serverId: string;
  botId: string;
  adminId: string;
  users: Record<string, string>;
  roles: Record<string, string>;
  channels: Record<string, string>;
  messages: Record<string, string>;
}

function createSeedUser(db: DatabaseWrapper, username: string, displayName: string, avatar: string, opts: { bot?: boolean; bio?: string } = {}): string {
  const existing = db.get<{ id: string }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username);
  if (existing) return existing.id;
  const id = newId('u');
  const now = Date.now();
  db.run(
    `INSERT INTO users (id, username, display_name, password_hash, avatar, bio, status, is_bot, badges, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 'offline', ?, '[]', ?, ?)`,
    id, username, displayName, '!seed-account-unusable-' + Math.random().toString(36), avatar, opts.bio ?? null, opts.bot ? 1 : 0, now, now,
  );
  return id;
}

function addChannel(db: DatabaseWrapper, serverId: string, input: {
  name: string; type: string; parentId?: string | null; position: number; topic?: string | null;
  nsfw?: boolean; slowmode?: number; tags?: string[]; votingEnabled?: boolean; defaultSort?: string | null; icon?: string | null;
}): string {
  const id = newId('ch');
  db.run(
    `INSERT INTO channels (id, server_id, type, name, topic, nsfw, slowmode, position, parent_id, locked, archived,
      last_message_id, tags, icon, default_sort, voting_enabled, origin_message_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, NULL, ?)`,
    id, serverId, input.type, input.name, input.topic ?? null, input.nsfw ? 1 : 0, input.slowmode ?? 0, input.position,
    input.parentId ?? null, JSON.stringify(input.tags ?? []), input.icon ?? null, input.defaultSort ?? null,
    input.votingEnabled === false ? 0 : 1, Date.now(),
  );
  return id;
}

export function seedStarterWorkspace(db: DatabaseWrapper, adminId: string): SeedWorld | null {
  const already = db.get<{ id: string }>('SELECT id FROM servers WHERE owner_id = ? AND name = ?', adminId, 'The Slop Pit');
  if (already) return null;
  const now = Date.now();
  const botId = createSeedUser(db, 'slopbot', 'SlopBot', `${STATIC}/brand/mascot.svg`, { bot: true, bio: 'I live in the walls. I post the slop. I am contractually obligated to be unfunny.' });
  const memelord = createSeedUser(db, 'memelord', 'Meme Lord', `${STATIC}/avatars/avatar-2.svg`, { bio: 'I was there when the ratio happened. I said nothing.' });
  const chungus = createSeedUser(db, 'chungusmaximus', 'Chungus Maximus', `${STATIC}/avatars/avatar-3.svg`, { bio: 'Big chungus, big heart, zero thoughts.' });
  const grass = createSeedUser(db, 'touchgrass', 'Touch Grass', `${STATIC}/avatars/avatar-4.svg`, { bio: 'I go outside. I am better than you. (I am lying.)' });
  const ratio = createSeedUser(db, 'ratiofan', 'Ratio Fan', `${STATIC}/avatars/avatar-5.svg`, { bio: 'L + ratio + you fell off + no bitches.' });
  const slopgoblin = createSeedUser(db, 'slopgoblin', 'Slop Goblin', `${STATIC}/avatars/avatar-6.svg`, { bio: 'Goblin mode: permanent.' });

  const serverId = newId('s');
  db.run(
    `INSERT INTO servers (id, name, icon, banner, banner_color, description, owner_id, member_count, is_public, nsfw, welcome_channel_id, system_channel_id, motd, traits, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, 6, 1, 0, NULL, NULL, ?, ?, ?)`,
    serverId, 'The Slop Pit', `${STATIC}/brand/mascot.svg`, '#b58cff',
    'The official demo server. Certified 100% organic free-range AI slop. Touch grass is not mandatory but recommended.',
    adminId, 'Welcome to the Pit. The goblin bites, but only metaphorically.',
    JSON.stringify(['certified slop', 'goblin approved', 'no crypto']), now,
  );
  const everyoneId = newId('r');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
     VALUES (?, ?, '@everyone', '#99aab5', 0, ?, 0, 0, 1, ?)`,
    everyoneId, serverId, DEFAULT_EVERYONE, now,
  );
  const founderId = newId('r');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
     VALUES (?, ?, 'Slop Overlord', '#e3b341', 50, ?, 1, 1, 0, ?)`,
    founderId, serverId, Perm.ADMINISTRATOR, now,
  );
  const councilId = newId('r');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
     VALUES (?, ?, 'Slop Council', '#b58cff', 30, ?, 1, 1, 0, ?)`,
    councilId, serverId, Perm.MANAGE_MESSAGES | Perm.MODERATE_MEMBERS | Perm.PIN_MESSAGES | Perm.VIEW_AUDIT_LOG | Perm.KICK_MEMBERS | Perm.MANAGE_THREADS, now,
  );
  const shitposterId = newId('r');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
     VALUES (?, ?, 'Certified Shitposter', '#ff9f1c', 20, 0, 1, 1, 0, ?)`,
    shitposterId, serverId, now,
  );
  const grassId = newId('r');
  db.run(
    `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
     VALUES (?, ?, 'Allegedly Touched Grass', '#57d98a', 10, 0, 1, 0, 0, ?)`,
    grassId, serverId, now,
  );

  const members: [string, string[]][] = [
    [adminId, [founderId]], [botId, [councilId]], [memelord, [shitposterId]], [chungus, [shitposterId, grassId]],
    [grass, [grassId]], [ratio, []], [slopgoblin, [shitposterId]],
  ];
  for (const [userId, roles] of members) {
    db.run('INSERT OR IGNORE INTO members (server_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?)', serverId, userId, now - Math.floor(Math.random() * 30) * 86400000);
    for (const roleId of roles) db.run('INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', serverId, userId, roleId);
  }

  const pitCat = addChannel(db, serverId, { name: 'THE PIT', type: 'category', position: 0, topic: null });
  const welcome = addChannel(db, serverId, { name: 'welcome', type: 'text', parentId: pitCat, position: 0, topic: 'Read this or perish. Or just lurk. We are not the police.' });
  const general = addChannel(db, serverId, { name: 'general', type: 'text', parentId: pitCat, position: 1, topic: 'The main artery of slop. Be normal-ish.' });
  const shitpost = addChannel(db, serverId, { name: 'shitpost', type: 'text', parentId: pitCat, position: 2, topic: 'No thoughts. Head empty. Only memes.', slowmode: 0 });
  const hot = addChannel(db, serverId, { name: 'hot-takes', type: 'text', parentId: pitCat, position: 3, topic: 'Post your worst opinions. Dig your own grave.', votingEnabled: true });
  const boardCat = addChannel(db, serverId, { name: 'THE BOARD', type: 'category', position: 1 });
  const board = addChannel(db, serverId, { name: 'slop-board', type: 'forum', parentId: boardCat, position: 0, topic: 'Reddit-style posts, threaded replies and cow-clicker votes. Hot takes welcome.', tags: ['meme', 'hot-take', 'help', 'copypasta', 'cursed'], defaultSort: 'hot' });
  const voiceCat = addChannel(db, serverId, { name: 'VOICE', type: 'category', position: 2 });
  const vc = addChannel(db, serverId, { name: 'The Slop Pit VC', type: 'voice', parentId: voiceCat, position: 0, topic: 'Mic optional. Vibes mandatory.' });
  const afk = addChannel(db, serverId, { name: 'AFK / Touch Grass', type: 'voice', parentId: voiceCat, position: 1, topic: 'You are not AFK. You are avoiding something.' });
  db.run('UPDATE servers SET welcome_channel_id = ?, system_channel_id = ? WHERE id = ?', welcome, general, serverId);

  return {
    serverId, botId, adminId,
    users: { bot: botId, memelord, chungus, grass, ratio, slopgoblin, admin: adminId },
    roles: { everyone: everyoneId, founder: founderId, council: councilId, shitposter: shitposterId, grass: grassId },
    channels: { welcome, general, shitpost, hot, board, vc, afk, pitCat, boardCat, voiceCat },
    messages: {},
  };
}

const EMOJIS: [string, string][] = [
  ['slop', 'slop'], ['based', 'based'], ['sus', 'sus'], ['kek', 'kek'], ['copium', 'copium'],
  ['touchgrass', 'touchgrass'], ['banger', 'banger'], ['ratio', 'ratio'], ['goblin', 'goblin'],
  ['goat', 'goat'], ['chungus', 'chungus'], ['sigma', 'sigma'], ['sob', 'sob'], ['dead', 'dead'],
];
const STICKERS: [string, string, string][] = [
  ['touchgrass', 'Touch Grass', 'The grass is calling. You will not answer.'],
  ['banger', 'Certified Banger', 'This post slaps and you know it.'],
  ['ratio', 'L + Ratio', 'A ratio so devastating it should be studied.'],
  ['slop', 'Fresh Slop', 'Still warm from the AI mines.'],
  ['sus', 'Kinda Sus', 'Extremely sus. Do not trust.'],
  ['goat', 'Absolute GOAT', 'The greatest slopper of all time.'],
];
const MEMES = ['this-is-slop', 'touch-grass', 'ratio', 'brain-empty', 'ceo-slop'];

function addEmojiAssets(db: DatabaseWrapper, world: SeedWorld) {
  const now = Date.now();
  for (const [name, file] of EMOJIS) {
    const id = `em_seed_${name}`;
    db.run('INSERT OR IGNORE INTO emojis (id, server_id, name, path, animated, uploader_id, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id, world.serverId, name, `${STATIC}/emoji/${file}.svg`, world.botId, now);
  }
  for (const [name, label, desc] of STICKERS) {
    db.run('INSERT OR IGNORE INTO stickers (id, server_id, name, path, description, tags, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', `st_seed_${name}`, world.serverId, label, `${STATIC}/stickers/${name}.svg`, desc, JSON.stringify([name, 'slop']), world.botId, now);
  }
  const sounds: [string, string, string][] = [
    ['airhorn', 'Airhorn', '📢'], ['bruh', 'Bruh', '🗿'], ['vine-boom', 'Vine Boom', '💥'],
    ['among-us', 'Sus Alert', '🛸'], ['bonk', 'Bonk', '🔨'], ['pog', 'Pog', '😲'],
  ];
  for (const [slug, label, emoji] of sounds) {
    db.run('INSERT OR IGNORE INTO sounds (id, server_id, name, path, emoji, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `snd_seed_${slug}`, world.serverId, label, `${STATIC}/sounds/${slug}.wav`, emoji, world.botId, now);
  }
}

function insertMessage(db: DatabaseWrapper, world: SeedWorld, channelId: string, authorId: string, content: string, ts: number, opts: {
  replyToId?: string | null; type?: string; pinned?: boolean; flags?: Record<string, unknown>;
} = {}): string {
  const id = newId('m');
  const flags = opts.flags ?? {};
  const channelRow = db.get<{ server_id: string | null }>('SELECT server_id FROM channels WHERE id = ?', channelId);
  if (!channelRow) throw new Error('Seed channel missing: ' + channelId);
  db.run(
    `INSERT INTO messages (id, channel_id, server_id, author_id, content, type, reply_to_id, pinned, pinned_at, pinned_by,
      edited_at, deleted_at, deleted_by, tts, encrypted, crypto_meta, score, flags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, NULL, 0, ?, ?)`,
    id, channelId, channelRow.server_id, authorId, content, opts.type ?? 'default', opts.replyToId ?? null, opts.pinned ? 1 : 0,
    opts.pinned ? ts : null, opts.pinned ? authorId : null, JSON.stringify(flags), ts,
  );
  db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', id, channelId);
  world.messages[channelId] = id;
  return id;
}

function reactions(db: DatabaseWrapper, messageId: string, emoji: string, userIds: string[]) {
  const now = Date.now();
  for (const userId of userIds) db.run('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', messageId, userId, emoji, now);
}

function votes(db: DatabaseWrapper, messageId: string, entries: [string, -1 | 1][]) {
  const now = Date.now();
  for (const [userId, value] of entries) db.run('INSERT OR IGNORE INTO votes (message_id, user_id, value, created_at) VALUES (?, ?, ?, ?)', messageId, userId, value, now);
}

function seedWelcomeAndGeneral(db: DatabaseWrapper, world: SeedWorld) {
  const { botId, adminId, users, roles, channels } = world;
  const t = Date.now();
  const welcome1 = insertMessage(db, world, channels.welcome!, botId, `# Welcome to The Slop Pit\n\nA **certified AI slop** server. No algorithmic feed, no engagement metrics, no adults.\n\n> Touch grass? Never heard of her.\n\nHere you will find memes, hot takes, forum posts, voice chaos and a goblin with a keyboard. The server rules are simple:\n\n- Be unhinged, not cruel.\n- No doxxing, harassment or illegal nonsense.\n- Mark your NSFW (and your spoilers with \`||like this||\`).\n- Do not feed the goblin after midnight.\n\nRead <#${channels.general}> for the vibe, or start posting in <#${channels.shitpost}>. Ping <@&${roles.council}> if something is on fire (metaphorically).\n\n![](/static/assets/memes/this-is-slop.svg)\n\n*This message is pinned because the council insists.*`, t - 40 * 3600_000, { pinned: true });
  const welcome2 = insertMessage(db, world, channels.welcome!, botId, `## House rules, the short version\n\n1. **No bigotry.** Instant vibe violation.\n2. **No spam.** The slop must flow naturally.\n3. **No unsolicited crypto.** We are broke on purpose.\n4. **Spoilers exist.** Use \`||spoiler tags||\`.\n5. **Grass is optional.** Being a decent goblin is not.\n\nWe keep reports anonymous. Server mods can see the reported message; instance admins can review reports too. E2EE DMs stay encrypted. ${''}`, t - 39 * 3600_000, { pinned: true });
  const intro = insertMessage(db, world, channels.welcome!, users.memelord!, `I'm not reading all that. Happy for you though. Or sorry that happened.\n\n![](/static/assets/memes/touch-grass.svg)`, t - 37 * 3600_000);
  reactions(db, welcome1, '🔥', [users.memelord!, users.chungus!, users.grass!]);
  reactions(db, welcome1, '💩', [users.ratio!]);
  reactions(db, welcome2, '✅', [users.memelord!, users.chungus!]);
  reactions(db, intro, '🌿', [users.grass!, users.chungus!]);

  const g1 = insertMessage(db, world, channels.general!, botId, `The pit is open. The slop is warm. Who is getting ratioed first?`, t - 8 * 3600_000);
  const g2 = insertMessage(db, world, channels.general!, users.memelord!, `it's sloppin' time 🟢\n\n![](/static/assets/memes/ratio.svg)`, t - 7.4 * 3600_000, { replyToId: g1 });
  const g3 = insertMessage(db, world, channels.general!, users.chungus!, `big if true`, t - 7.2 * 3600_000, { replyToId: g2 });
  const g4 = insertMessage(db, world, channels.general!, adminId, `First time? It gets worse. Welcome to the council, <@${botId}>.`, t - 6.8 * 3600_000);
  const g5 = insertMessage(db, world, channels.general!, botId, `## Certified poll\n\nThe council requires your opinion. Resistance is futile.\n\nVote below or be sentenced to lurking.`, t - 6.2 * 3600_000);
  const pollId = newId('poll');
  db.run("INSERT INTO polls (id, message_id, question, multiple, closes_at) VALUES (?, ?, 'Which is the superior slop delivery mechanism?', 0, ?)", pollId, g5, t + 3 * 86400_000);
  const optIds = ['Shitposting', 'Forum essay', 'Voice chaos', 'Silent lurking'].map((label, i) => {
    const id = newId('po'); db.run('INSERT INTO poll_options (id, poll_id, label, position) VALUES (?, ?, ?, ?)', id, pollId, label, i); return id;
  });
  for (const [userId, idx] of [[users.memelord!, 0], [users.chungus!, 1], [users.grass!, 0], [users.ratio!, 3], [users.slopgoblin!, 2]] as [string, number][]) {
    db.run('INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_id, created_at) VALUES (?, ?, ?, ?)', pollId, userId, optIds[idx]!, Date.now() - Math.floor(Math.random() * 3600000));
  }
  const g6 = insertMessage(db, world, channels.general!, users.memelord!, `This is the content I come here for. Also <@${adminId}> the soundboard is broken again.`, t - 2.2 * 3600_000);
  const g7 = insertMessage(db, world, channels.general!, users.grass!, `Skill issue. The airhorn works for me.`, t - 2 * 3600_000, { replyToId: g6 });
  const g8 = insertMessage(db, world, channels.general!, botId, `Reminder: the **Slop Movie Night** event is scheduled. RSVP in server events so I can estimate pizza orders that nobody will actually place.`, t - 40 * 60_000);
  reactions(db, g1, '💀', [users.memelord!, users.chungus!, users.ratio!]);
  reactions(db, g2, '🔥', [users.chungus!, users.grass!, users.slopgoblin!]);
  reactions(db, g3, '😭', [users.memelord!]);
  reactions(db, g4, '🫡', [users.memelord!, users.chungus!, users.grass!]);
  reactions(db, g6, '👀', [users.chungus!]); reactions(db, g7, '🌿', [users.memelord!, users.chungus!]);
  votes(db, g4, [[users.memelord!, 1], [users.chungus!, 1], [users.grass!, 1]]);
  votes(db, g6, [[users.chungus!, 1], [users.grass!, 1], [users.ratio!, -1]]);
  votes(db, g7, [[users.memelord!, 1]]);
  db.run('UPDATE messages SET pinned = 1, pinned_at = ?, pinned_by = ? WHERE id = ?', t - 3600_000, adminId, g4);
  db.run('UPDATE messages SET pinned = 1, pinned_at = ?, pinned_by = ? WHERE id = ?', t - 3000_000, botId, g6);
  world.messages.general = g4; world.messages.pollMsg = g5; world.messages.mentionMsg = g6;
  db.run('INSERT INTO message_mentions (message_id, mention_type, target_id) VALUES (?, ?, ?)', g4, 'user', botId);
  db.run('INSERT INTO message_mentions (message_id, mention_type, target_id) VALUES (?, ?, ?)', g6, 'user', adminId);
  db.run('INSERT INTO notifications (id, user_id, type, title, body, server_id, channel_id, message_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('n'), adminId, 'mention', `${users.memelord!} mentioned you`, '@admin the soundboard is broken again.', world.serverId, channels.general!, g6, users.memelord!, t - 2.2 * 3600_000);
  db.run('INSERT INTO notifications (id, user_id, type, title, body, server_id, channel_id, message_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('n'), adminId, 'system', 'Welcome to The Slop Pit', 'You are the Slop Overlord. Use this power irresponsibly.', world.serverId, channels.welcome!, welcome1, botId, t - 40 * 3600_000);

  // Read state: leave the latest general chatter unread; counts derive from messages after the marker.
  db.run('INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?)', adminId, channels.welcome!, welcome2, t - 3600_000);
  db.run('INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 1, ?)', adminId, channels.general!, g5, t - 3600_000);
  db.run('INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?)', adminId, channels.shitpost!, '', t - 3600_000);
  void g8;
}

function seedShitpostsAndHotTakes(db: DatabaseWrapper, world: SeedWorld) {
  const { botId, adminId, users, channels } = world;
  const t = Date.now();
  const s1 = insertMessage(db, world, channels.shitpost!, users.memelord!, `no thoughts. head empty. only slop.\n\n![](/static/assets/memes/brain-empty.svg)`, t - 5.5 * 3600_000);
  const s2 = insertMessage(db, world, channels.shitpost!, users.slopgoblin!, `${COPYPASTAS[0]}\n\n${COPYPASTAS[11]} <:slop:em_seed_slop> <:goblin:em_seed_goblin>`, t - 4.7 * 3600_000);
  const s3 = insertMessage(db, world, channels.shitpost!, users.chungus!, `CERTIFIED BANGER ALERT ${''}\n\n![](/static/assets/memes/ceo-slop.svg)\n\n<:banger:em_seed_banger> <:based:em_seed_based>`, t - 2.5 * 3600_000, { replyToId: s2 });
  const s4 = insertMessage(db, world, channels.shitpost!, users.ratio!, `ratio + didn't ask + L + fell off + no bitches + go outside`, t - 1.4 * 3600_000);
  reactions(db, s1, '💀', [users.chungus!, users.ratio!, users.slopgoblin!]); reactions(db, s1, '🟢', [users.memelord!]);
  reactions(db, s2, '💩', [users.memelord!, users.chungus!, users.grass!]); reactions(db, s2, '🙏', [users.ratio!]);
  reactions(db, s3, '🔥', [users.memelord!, users.slopgoblin!, users.grass!, adminId]); reactions(db, s3, '🐐', [users.chungus!]);
  votes(db, s1, [[users.chungus!, 1], [users.grass!, 1], [users.ratio!, 1]]);
  votes(db, s2, [[users.memelord!, 1], [users.chungus!, 1]]);
  votes(db, s3, [[users.memelord!, 1], [users.grass!, 1], [users.ratio!, 1], [users.slopgoblin!, 1]]);
  votes(db, s4, [[users.memelord!, -1], [users.chungus!, -1], [users.grass!, -1]]);
  for (const [msgId, key, count] of [[s3, 'banger', 2], [s1, 'cursed', 1], [s2, 'copium', 1]] as [string, string, number][]) {
    for (let i = 0; i < count; i++) db.run('INSERT INTO awards (id, message_id, user_id, award, created_at) VALUES (?, ?, ?, ?, ?)', newId('aw'), msgId, [users.memelord!, users.grass!, users.chungus!][i % 3]!, key, t - 1000000);
  }
  db.run('INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id', adminId, channels.shitpost!, s1, t - 3600_000);

  const h1 = insertMessage(db, world, channels.hot!, users.grass!, `Pineapple on pizza is **actually good**. The acidity cuts through the cheese. This is a hill I will die on and I have the hydration levels to do it.`, t - 9 * 3600_000);
  const h2 = insertMessage(db, world, channels.hot!, users.memelord!, `L + ratio + your taste buds are in witness protection + Italian nonnas are loading their shotguns`, t - 8.7 * 3600_000, { replyToId: h1 });
  const h3 = insertMessage(db, world, channels.hot!, users.chungus!, `I agree with both of you. I am Switzerland.`, t - 8.4 * 3600_000);
  const h4 = insertMessage(db, world, channels.hot!, adminId, `Hot take: this server peaked before any of us arrived.`, t - 3 * 3600_000);
  reactions(db, h1, '🍍', [users.memelord!]); reactions(db, h1, '🫠', [users.chungus!, users.ratio!]);
  reactions(db, h2, '🔥', [users.grass!, users.chungus!, users.slopgoblin!]);
  votes(db, h1, [[users.memelord!, -1], [users.chungus!, -1], [users.ratio!, -1], [users.slopgoblin!, -1], [adminId, -1], [botId, -1]]);
  votes(db, h2, [[users.grass!, 1], [users.chungus!, 1], [adminId, 1], [users.slopgoblin!, 1]]);
  votes(db, h3, [[users.memelord!, 1], [users.grass!, 1]]);
  votes(db, h4, [[users.memelord!, 1]]);

  const reportId = newId('r');
  db.run(`INSERT INTO reports (id, server_id, reporter_id, target_user_id, message_id, reason, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`, reportId, world.serverId, users.ratio!, users.grass!, h1,
    'Harmful misinformation: claims pineapple belongs on pizza. This is a culinary war crime. Please send the council.', t - 8.5 * 3600_000);
  db.run('INSERT INTO audit_logs (id, server_id, actor_id, action, target_type, target_id, reason, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('a'), world.serverId, adminId, 'SERVER_CREATE', 'server', world.serverId, null, JSON.stringify({ name: 'The Slop Pit', seeded: true }), t - 40 * 86400_000);
  db.run('INSERT INTO audit_logs (id, server_id, actor_id, action, target_type, target_id, reason, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('a'), world.serverId, botId, 'CHANNEL_CREATE', 'channel', channels.shitpost!, 'seeded channel', JSON.stringify({ name: 'shitpost', type: 'text' }), t - 39 * 86400_000);
  db.run('INSERT INTO audit_logs (id, server_id, actor_id, action, target_type, target_id, reason, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('a'), world.serverId, users.memelord!, 'MEMBER_JOIN', 'user', users.memelord!, null, null, t - 20 * 86400_000);
  world.messages.shitpost = s1; world.messages.hotTake = h1;
}

function seedBoardAndDms(db: DatabaseWrapper, world: SeedWorld) {
  const { botId, adminId, users, channels, roles } = world;
  const t = Date.now();
  const createThread = (title: string, tags: string[], authorId: string, createdAt: number, body: string) => {
    const id = newId('ch');
    const pos = (db.get<{ p: number | null }>('SELECT MAX(position) AS p FROM channels WHERE server_id = ?', world.serverId)?.p ?? 100) + 1;
    db.run(`INSERT INTO channels (id, server_id, type, name, topic, nsfw, slowmode, position, parent_id, locked, archived, last_message_id, tags, icon, default_sort, voting_enabled, origin_message_id, created_at)
            VALUES (?, ?, 'thread', ?, NULL, 0, 0, ?, ?, 0, 0, NULL, ?, NULL, NULL, 1, NULL, ?)`,
      id, world.serverId, title, pos, channels.board!, JSON.stringify(tags), createdAt);
    const first = insertMessage(db, world, id, authorId, body, createdAt);
    db.run('UPDATE channels SET origin_message_id = ? WHERE id = ?', first, id);
    db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', first, channels.board!);
    return { id, first };
  };
  const p1 = createThread('AI slop is the highest form of art (essay)', ['hot-take'], users.memelord!, t - 3 * 86400_000,
    `Hot take: **AI-generated slop is the highest form of art.** It is the only art form that admits it has no soul. A human painting lies about its suffering; an AI-generated anime girl with six fingers tells the truth about our civilization.\n\nI will not be taking questions. The council may now ratio me.\n\n![](/static/assets/memes/this-is-slop.svg)`);
  const r1 = insertMessage(db, world, p1.id, users.chungus!, `I read 20% of that and I already know you're right.`, t - 2.9 * 86400_000, { replyToId: p1.first });
  const r1b = insertMessage(db, world, p1.id, users.grass!, `This is a Wendy's.`, t - 2.8 * 86400_000, { replyToId: r1 });
  const r1c = insertMessage(db, world, p1.id, adminId, `Mods, he's got a point but he's also too proud of it.`, t - 2.7 * 86400_000);
  const p2 = createThread('My landlord is a goblin and he ate my security deposit [HELP]', ['help'], users.slopgoblin!, t - 30 * 3600_000,
    `So I moved into this apartment and it turns out the landlord is a **literal goblin**. Not a metaphor. He has a crown. He ate my security deposit, then my couch cushion, then half of my dignity.\n\nHe left a note: "SLOP NOW, RENT LATER." What are my options? I have 3 slop points and a plunger.`);
  insertMessage(db, world, p2.id, users.memelord!, `Have you tried touching grass? It won't fix the goblin but it might improve your mood.`, t - 29 * 3600_000);
  insertMessage(db, world, p2.id, botId, `Have you considered paying rent in *memes*? Legally binding in at least one jurisdiction (probably).`, t - 28 * 3600_000);
  insertMessage(db, world, p2.id, adminId, `Send me the goblin's discord. I just want to talk.`, t - 27 * 3600_000);
  const p3 = createThread('Certified banger meme dump (NSFW-free)', ['meme', 'copypasta'], users.chungus!, t - 7 * 3600_000,
    `Dumping only the finest slop. Touch grass if you disagree.\n\n![](/static/assets/memes/ceo-slop.svg)\n\n![](/static/assets/memes/ratio.svg)\n\n${COPYPASTAS[21]}`);
  insertMessage(db, world, p3.id, users.memelord!, `The CEO of Slop one goes hard. I'm framing it.`, t - 6.5 * 3600_000);
  insertMessage(db, world, p3.id, users.ratio!, `ratio`, t - 6 * 3600_000);
  insertMessage(db, world, p3.id, users.grass!, `I came here to laugh at memes and chew bubblegum.`, t - 5.5 * 3600_000);
  votes(db, p1.first, [[users.chungus!, 1], [users.grass!, 1], [adminId, 1], [users.ratio!, -1]]);
  votes(db, p2.first, [[users.memelord!, 1], [users.chungus!, 1], [adminId, 1], [users.grass!, 1]]);
  votes(db, p3.first, [[users.memelord!, 1], [users.slopgoblin!, 1], [adminId, 1]]);
  reactions(db, p1.first, '🔥', [users.chungus!, adminId]); reactions(db, p3.first, '🐐', [users.memelord!, users.grass!]);

  // DMs
  const dm1 = newId('ch');
  db.run("INSERT INTO channels (id, server_id, type, name, topic, nsfw, slowmode, position, parent_id, locked, archived, last_message_id, tags, icon, default_sort, voting_enabled, origin_message_id, created_at) VALUES (?, NULL, 'dm', '', NULL, 0, 0, 0, NULL, 0, 0, NULL, '[]', NULL, NULL, 1, NULL, ?)", dm1, t - 2 * 86400_000);
  for (const uid of [adminId, users.memelord!]) db.run('INSERT INTO dm_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)', dm1, uid, t - 2 * 86400_000);
  const dm1a = insertMessage(db, world, dm1, users.memelord!, `yo admin, the new soundboard is unhinged. I played the fart at max volume during a job interview.`, t - 30 * 60_000);
  const dm1b = insertMessage(db, world, dm1, adminId, `That's a you problem. But also based.`, t - 28 * 60_000);
  const dm1c = insertMessage(db, world, dm1, users.memelord!, `Also I made you a meme.\n\n![](/static/assets/memes/brain-empty.svg)`, t - 4 * 60_000);
  db.run('INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?)', adminId, dm1, dm1a, t - 20 * 60_000);
  db.run('UPDATE dm_members SET last_read_id = ? WHERE channel_id = ? AND user_id = ?', dm1a, dm1, adminId);
  db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', dm1c, dm1);

  const dm2 = newId('ch');
  db.run("INSERT INTO channels (id, server_id, type, name, topic, nsfw, slowmode, position, parent_id, locked, archived, last_message_id, tags, icon, default_sort, voting_enabled, origin_message_id, created_at) VALUES (?, NULL, 'group_dm', 'The Council of Slop', NULL, 0, 0, 0, NULL, 0, 0, NULL, '[]', NULL, NULL, 1, NULL, ?)", dm2, t - 4 * 86400_000);
  for (const uid of [adminId, botId, users.chungus!]) db.run('INSERT INTO dm_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)', dm2, uid, t - 4 * 86400_000);
  const dm2a = insertMessage(db, world, dm2, botId, `Council convened. Agenda: the goblin situation, the pizza incident, and whether we should add a 14th soundboard sound.`, t - 3 * 3600_000);
  const dm2b = insertMessage(db, world, dm2, users.chungus!, `I vote for more fart sounds.`, t - 2.8 * 3600_000);
  const dm2c = insertMessage(db, world, dm2, adminId, `Motion to adjourn. Meeting dismissed.`, t - 2.5 * 3600_000);
  db.run('INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count, updated_at) VALUES (?, ?, ?, 0, ?)', adminId, dm2, dm2b, t - 1000);
  db.run('UPDATE dm_members SET last_read_id = ? WHERE channel_id = ? AND user_id = ?', dm2b, dm2, adminId);
  db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', dm2c, dm2);

  // Friendships: accepted friends + one incoming request from ratiofan.
  const now = Date.now();
  for (const friend of [users.memelord!, users.chungus!, users.grass!, users.slopgoblin!]) {
    db.run('INSERT OR IGNORE INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId('f'), adminId, friend, 'accepted', now - 10 * 86400_000, now - 10 * 86400_000);
  }
  db.run('INSERT OR IGNORE INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', newId('f'), users.ratio!, adminId, 'pending', now - 2 * 3600_000, now - 2 * 3600_000);
  db.run('INSERT INTO notifications (id, user_id, type, title, body, server_id, channel_id, message_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)',
    newId('n'), adminId, 'friend_request', `${users.ratio!} wants to be your friend`, 'Ratio Fan sent you a friend request. Accept at your own risk.', users.ratio!, now - 2 * 3600_000);

  // Events
  const ev1 = newId('ev');
  db.run('INSERT INTO server_events (id, server_id, channel_id, name, description, starts_at, ends_at, creator_id, cover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ev1, world.serverId, channels.vc!, 'Slop Movie Night: The Emoji Movie (ironic)', 'We watch it ironically. Then unironically. Then we cry. Bring snacks and low expectations.', now + 26 * 3600_000, now + 29 * 3600_000, botId, `${STATIC}/memes/this-is-slop.svg`, now - 86400_000);
  db.run('INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)', ev1, users.memelord!, 'going');
  db.run('INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)', ev1, users.chungus!, 'interested');
  db.run('INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)', ev1, adminId, 'interested');
  db.run('INSERT INTO server_events (id, server_id, channel_id, name, description, starts_at, ends_at, creator_id, cover, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?)',
    newId('ev'), world.serverId, 'Touch Grass Speedrun (Any%)', 'Go outside, touch one (1) blade of grass, return. Leaderboard in #general. No cheating.', now + 3 * 86400_000, now + 3 * 86400_000 + 3600_000, users.grass!, now);

  // Invite, rules, achievements, settings
  db.run('INSERT OR IGNORE INTO invites (code, server_id, channel_id, creator_id, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, 0, 0, NULL, ?)', 'slop-pit', world.serverId, channels.general!, adminId, now);
  db.run('INSERT INTO moderation_rules (id, server_id, pattern, action, enabled, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)', newId('mr'), world.serverId, '(?i)\\b(slur|dox|kys)\\b', 'flag', adminId, now);
  db.run('UPDATE servers SET member_count = 7 WHERE id = ?', world.serverId);
  for (const key of ['founder', 'server_owner']) db.run('INSERT OR IGNORE INTO achievements (user_id, key, earned_at) VALUES (?, ?, ?)', adminId, key, now);
  for (const [uid, keys] of [[users.memelord!, ['reaction_goblin', 'copypasta']], [users.chungus!, ['based']], [users.grass!, ['night_owl']], [botId, ['shitposter']]] as [string, string[]][]) {
    for (const key of keys) db.run('INSERT OR IGNORE INTO achievements (user_id, key, earned_at) VALUES (?, ?, ?)', uid, key, now);
  }
  db.run("INSERT INTO settings (key, value) VALUES ('slop_of_the_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(COPYPASTAS[24]));
  db.run("INSERT INTO settings (key, value) VALUES ('demo_seeded', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  // Compute score + karma from votes, then pin pinned scores.
  db.run('UPDATE messages SET score = COALESCE((SELECT SUM(value) FROM votes WHERE votes.message_id = messages.id), 0) WHERE deleted_at IS NULL');
  db.run('UPDATE users SET karma = COALESCE((SELECT SUM(score) FROM messages WHERE messages.author_id = users.id AND deleted_at IS NULL), 0)');
  void roles; void dm2a;
}

/** Create the complete first-run demo world for a freshly registered instance owner. */
export function seedDemoForAdmin(db: DatabaseWrapper, adminId: string): SeedWorld | null {
  const world = seedStarterWorkspace(db, adminId);
  if (!world) return null;
  addEmojiAssets(db, world);
  seedWelcomeAndGeneral(db, world);
  seedShitpostsAndHotTakes(db, world);
  seedBoardAndDms(db, world);
  return world;
}
