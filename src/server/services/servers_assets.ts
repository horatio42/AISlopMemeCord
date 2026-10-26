import type { Ctx } from '../http';
import { ApiError } from '../http';
import { ValidationError, optText, text } from '../util/validate';
import { Perm } from '../../shared/permissions';
import { newId } from '../util/ids';
import type { Emoji, Sound, Sticker } from '../../shared/types';
import { logAudit } from './audit';
import { grantAchievement } from './achievements';
import { assertServerPermission } from './permissions';
import { UPLOAD_PURPOSES, resolveUpload, stringList, type EmojiRow, type SoundRow, type StickerRow, type UploadRow } from './servers_common';

const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;

function uploadAsset(ctx: Ctx, value: unknown, field: string, rules: { purposes: readonly string[]; kind: 'image' | 'audio' }): { upload: UploadRow; url: string } {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError({ [field]: 'An upload id is required.' });
  }
  return resolveUpload(ctx, value, field, { purposes: [...rules.purposes], kind: rules.kind });
}

export function createEmoji(ctx: Ctx, serverId: string, body: Record<string, unknown>): Emoji {
  const name = String(body.name ?? '').trim();
  if (!EMOJI_NAME_RE.test(name)) {
    throw new ValidationError({ name: 'Emoji name must be 2-32 characters: letters, numbers and underscores.' });
  }
  const { upload, url } = uploadAsset(ctx, body.uploadId, 'uploadId', { purposes: UPLOAD_PURPOSES.emoji, kind: 'image' });
  if (ctx.db.get('SELECT 1 FROM emojis WHERE server_id = ? AND name = ?', serverId, name)) {
    throw new ApiError(409, 'EMOJI_EXISTS', 'This server already has an emoji with that name. Be more original.');
  }
  const id = newId('e');
  ctx.db.run(
    'INSERT INTO emojis (id, server_id, name, path, animated, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, serverId, name, url, upload.content_type === 'image/gif' ? 1 : 0, ctx.user!.id, Date.now(),
  );
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'emoji.create', targetType: 'emoji', targetId: id, changes: { name },
  });
  const uploaded = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM emojis WHERE uploader_id = ?', ctx.user!.id)?.n ?? 0;
  if (uploaded >= 10) grantAchievement(ctx.db, ctx.hub, ctx.user!.id, 'emoji_hoarder');
  return { id, serverId, name, url, animated: upload.content_type === 'image/gif' };
}

export function createSticker(ctx: Ctx, serverId: string, body: Record<string, unknown>): Sticker {
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 32) throw new ValidationError({ name: 'Sticker name must be 1-32 characters.' });
  const { url } = uploadAsset(ctx, body.uploadId, 'uploadId', { purposes: UPLOAD_PURPOSES.sticker, kind: 'image' });
  const description = optText(body.description, 'description', 200);
  const tags = body.tags === undefined ? [] : stringList(body.tags, 'tags', 5, 20);
  const id = newId('st');
  ctx.db.run(
    'INSERT INTO stickers (id, server_id, name, path, description, tags, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, serverId, name, url, description, JSON.stringify(tags), ctx.user!.id, Date.now(),
  );
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'sticker.create', targetType: 'sticker', targetId: id, changes: { name },
  });
  return { id, serverId, name, url, description, tags };
}

export function createSound(ctx: Ctx, serverId: string, body: Record<string, unknown>): Sound {
  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 32) throw new ValidationError({ name: 'Sound name must be 1-32 characters.' });
  const emoji = body.emoji === undefined || body.emoji === null || body.emoji === ''
    ? '🔊'
    : text(body.emoji, 'emoji', 1, 16);
  const { url } = uploadAsset(ctx, body.uploadId, 'uploadId', { purposes: UPLOAD_PURPOSES.sound, kind: 'audio' });
  const id = newId('snd');
  ctx.db.run(
    'INSERT INTO sounds (id, server_id, name, path, emoji, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, serverId, name, url, emoji, ctx.user!.id, Date.now(),
  );
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'sound.create', targetType: 'sound', targetId: id, changes: { name },
  });
  return { id, serverId, name, url, emoji };
}

function assertAssetManage(ctx: Ctx, serverId: string | null): void {
  if (!serverId) {
    if (!ctx.user!.is_admin) throw new ApiError(403, 'ADMIN_ONLY', 'Global assets are instance-admin only.');
    return;
  }
  assertServerPermission(ctx, serverId, Perm.MANAGE_EMOJIS);
}

export function deleteEmoji(ctx: Ctx, id: string): EmojiRow {
  const row = ctx.db.get<EmojiRow>('SELECT * FROM emojis WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'EMOJI_NOT_FOUND', 'That emoji escaped into the void.');
  assertAssetManage(ctx, row.server_id);
  ctx.db.run('DELETE FROM emojis WHERE id = ?', id);
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'emoji.delete', targetType: 'emoji', targetId: id,
    changes: { name: row.name },
  });
  return row;
}

export function deleteSticker(ctx: Ctx, id: string): StickerRow {
  const row = ctx.db.get<StickerRow>('SELECT * FROM stickers WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'STICKER_NOT_FOUND', 'That sticker peeled off and vanished.');
  assertAssetManage(ctx, row.server_id);
  ctx.db.run('DELETE FROM stickers WHERE id = ?', id);
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'sticker.delete', targetType: 'sticker', targetId: id,
    changes: { name: row.name },
  });
  return row;
}

export function deleteSound(ctx: Ctx, id: string): SoundRow {
  const row = ctx.db.get<SoundRow>('SELECT * FROM sounds WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'SOUND_NOT_FOUND', 'That sound was swallowed by the soundboard goblin.');
  assertAssetManage(ctx, row.server_id);
  ctx.db.run('DELETE FROM sounds WHERE id = ?', id);
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'sound.delete', targetType: 'sound', targetId: id,
    changes: { name: row.name },
  });
  return row;
}
