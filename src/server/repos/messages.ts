import type { DatabaseWrapper } from '../db';
import { toUser, parseJson } from './users';
import type { UserRow } from '../http';
import type { Message, Attachment, Reaction, Poll, Message as MessageDto } from '../../shared/types';

export interface MessageRow {
  id: string; channel_id: string; server_id: string | null; author_id: string; content: string;
  type: string; reply_to_id: string | null; pinned: number; pinned_at: number | null; pinned_by: string | null;
  edited_at: number | null; deleted_at: number | null; deleted_by: string | null; tts: number;
  encrypted: number; crypto_meta: string | null; score: number; flags: string; created_at: number;
}

const EMPTY_REACTIONS: Reaction[] = [];

export function serializeMessages(db: DatabaseWrapper, rows: MessageRow[], viewerId: string): MessageDto[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const users = new Map<string, UserRow>();
  for (const id of authorIds) {
    const u = db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    if (u) users.set(id, u);
  }
  const attachments = db.all<{ id: string; message_id: string; filename: string; content_type: string; size: number; width: number | null; height: number | null; spoiler: number; alt: string | null }>(
    `SELECT id, message_id, filename, content_type, size, width, height, spoiler, alt FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`, ...ids,
  );
  const attachmentsByMessage = new Map<string, Attachment[]>();
  for (const a of attachments) {
    const arr = attachmentsByMessage.get(a.message_id) ?? [];
    arr.push({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, url: `/api/attachments/${a.id}`, width: a.width, height: a.height, spoiler: !!a.spoiler, alt: a.alt });
    attachmentsByMessage.set(a.message_id, arr);
  }
  const reactions = db.all<{ message_id: string; emoji: string; user_id: string }>(
    `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`, ...ids,
  );
  const reactionMap = new Map<string, Map<string, { count: number; me: boolean; userIds: string[] }>>();
  for (const r of reactions) {
    let byEmoji = reactionMap.get(r.message_id);
    if (!byEmoji) { byEmoji = new Map(); reactionMap.set(r.message_id, byEmoji); }
    let entry = byEmoji.get(r.emoji);
    if (!entry) { entry = { count: 0, me: false, userIds: [] }; byEmoji.set(r.emoji, entry); }
    entry.count++;
    if (r.user_id === viewerId) entry.me = true;
    if (entry.userIds.length < 20) entry.userIds.push(r.user_id);
  }
  const voteRows = db.all<{ message_id: string; value: number }>(
    `SELECT message_id, value FROM votes WHERE user_id = ? AND message_id IN (${placeholders})`, viewerId, ...ids,
  );
  const myVotes = new Map(voteRows.map((v) => [v.message_id, v.value]));
  const awardRows = db.all<{ message_id: string; award: string; n: number }>(
    `SELECT message_id, award, COUNT(*) AS n FROM awards WHERE message_id IN (${placeholders}) GROUP BY message_id, award`, ...ids,
  );
  const awardsMap = new Map<string, { key: string; count: number }[]>();
  for (const a of awardRows) {
    const arr = awardsMap.get(a.message_id) ?? [];
    arr.push({ key: a.award, count: a.n });
    awardsMap.set(a.message_id, arr);
  }
  const saved = new Set(db.all<{ message_id: string }>(
    `SELECT message_id FROM saved_messages WHERE user_id = ? AND message_id IN (${placeholders})`, viewerId, ...ids,
  ).map((r) => r.message_id));
  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter((x): x is string => !!x))];
  const replies = new Map<string, MessageRow>();
  if (replyIds.length) {
    const ph = replyIds.map(() => '?').join(',');
    for (const r of db.all<MessageRow>(`SELECT * FROM messages WHERE id IN (${ph})`, ...replyIds)) replies.set(r.id, r);
  }
  const mentionRows = db.all<{ message_id: string; mention_type: string; target_id: string | null }>(
    `SELECT message_id, mention_type, target_id FROM message_mentions WHERE message_id IN (${placeholders})`, ...ids,
  );
  const mentionsMap = new Map<string, MessageDto['mentions']>();
  for (const m of mentionRows) {
    let entry = mentionsMap.get(m.message_id);
    if (!entry) { entry = { users: [], roles: [], everyone: false, channels: [] }; mentionsMap.set(m.message_id, entry); }
    if (m.mention_type === 'user' && m.target_id) entry.users.push(m.target_id);
    else if (m.mention_type === 'role' && m.target_id) entry.roles.push(m.target_id);
    else if (m.mention_type === 'channel' && m.target_id) entry.channels.push(m.target_id);
    else if (m.mention_type === 'everyone') entry.everyone = true;
  }
  const stickerRows = db.all<{ id: string; name: string; path: string }>('SELECT id, name, path FROM stickers').map((s) => ({ ...s }));
  const stickers = new Map(stickerRows.map((s) => [s.id, { id: s.id, name: s.name, url: s.path.startsWith('/') ? s.path : `/api/media/uploads/${s.path}` }]));
  const polls = db.all<{ id: string; message_id: string; question: string; multiple: number; closes_at: number | null }>(
    `SELECT * FROM polls WHERE message_id IN (${placeholders})`, ...ids,
  );
  const pollsByMessage = new Map<string, Poll>();
  for (const p of polls) {
    const opts = db.all<{ id: string; label: string; votes: number }>(
      `SELECT o.id, o.label, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
       FROM poll_options o WHERE o.poll_id = ? ORDER BY o.position`, p.id,
    );
    const my = db.all<{ option_id: string }>('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?', p.id, viewerId).map((r) => r.option_id);
    const total = opts.reduce((s, o) => s + o.votes, 0);
    pollsByMessage.set(p.message_id, { id: p.id, question: p.question, multiple: !!p.multiple, closesAt: p.closes_at, options: opts, totalVotes: total, myVotes: my });
  }
  return rows.map((row) => {
    const author = users.get(row.author_id);
    if (!author) throw new Error('Message author missing: ' + row.author_id);
    const reply = row.reply_to_id ? replies.get(row.reply_to_id) : null;
    const replyAuthor = reply ? users.get(reply.author_id) ?? db.get<UserRow>('SELECT * FROM users WHERE id = ?', reply.author_id) : null;
    const mention = mentionsMap.get(row.id) ?? { users: [], roles: [], everyone: false, channels: [] };
    return {
      id: row.id,
      channelId: row.channel_id,
      serverId: row.server_id,
      author: toUser(author),
      content: row.content,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      replyTo: reply ? { id: reply.id, authorName: replyAuthor?.display_name ?? 'Deleted User', content: reply.deleted_at ? 'message deleted' : reply.content.slice(0, 140), deleted: !!reply.deleted_at } : null,
      threadId: null,
      pinned: !!row.pinned,
      pinnedAt: row.pinned_at,
      tts: !!row.tts,
      encrypted: !!row.encrypted,
      cryptoMeta: row.crypto_meta,
      attachments: attachmentsByMessage.get(row.id) ?? [],
      reactions: [...(reactionMap.get(row.id)?.entries() ?? [])].map(([emoji, e]) => ({ emoji, count: e.count, me: e.me, userIds: e.userIds })),
      mentions: mention,
      poll: pollsByMessage.get(row.id) ?? null,
      sticker: (() => { const id = parseJson<Record<string, unknown>>(row.flags, {}).stickerId; return typeof id === 'string' ? stickers.get(id) ?? null : null; })(),
      score: row.score,
      myVote: (myVotes.get(row.id) ?? 0) as -1 | 0 | 1,
      awards: awardsMap.get(row.id) ?? [],
      saved: saved.has(row.id),
      system: row.type !== 'default',
    };
  });
}

export function getMessageRow(db: DatabaseWrapper, id: string): MessageRow | null {
  return db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
}
