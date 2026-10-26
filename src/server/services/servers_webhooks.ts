import type { Ctx } from '../http';
import { ApiError } from '../http';
import { ValidationError } from '../util/validate';
import { Perm } from '../../shared/permissions';
import { newId, token } from '../util/ids';
import { safeEqual, sha256 } from '../util/crypto';
import type { Message, Webhook } from '../../shared/types';
import { serializeMessages, type MessageRow } from '../repos/messages';
import { logAudit } from './audit';
import { assertServerPermission } from './permissions';
import {
  UPLOAD_PURPOSES, getChannelInServer, getChannelOr404, optionalUpload, requireServer, toWebhookDto, type WebhookRow,
} from './servers_common';

const WEBHOOK_POST_TYPES = ['text', 'announcement'];

function webhookName(value: unknown): string {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 80) throw new ValidationError({ name: 'Webhook name must be 1-80 characters.' });
  return s;
}

export function createWebhook(ctx: Ctx, serverId: string, body: Record<string, unknown>): Webhook {
  assertServerPermission(ctx, serverId, Perm.MANAGE_SERVER);
  const channelId = String(body.channelId ?? '');
  if (!channelId) throw new ValidationError({ channelId: 'Pick a channel for this webhook.' });
  const channel = getChannelInServer(ctx, serverId, channelId, 'channelId');
  if (!WEBHOOK_POST_TYPES.includes(channel.type)) {
    throw new ValidationError({ channelId: 'Webhooks can only post in text or announcement channels.' });
  }
  const avatar = optionalUpload(ctx, body, 'avatar', { purposes: UPLOAD_PURPOSES.webhookAvatar, kind: 'image' });
  const rawToken = token(32);
  const id = newId('wh');
  ctx.db.run(
    `INSERT INTO webhooks (id, server_id, channel_id, name, avatar, token_hash, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, serverId, channel.id, webhookName(body.name), avatar ?? null, sha256(rawToken), ctx.user!.id, Date.now(),
  );
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'webhook.create', targetType: 'webhook', targetId: id,
    changes: { name: webhookName(body.name), channelId: channel.id },
  });
  const row = ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id)!;
  return toWebhookDto(row, rawToken);
}

export function listWebhooks(ctx: Ctx, serverId: string): Webhook[] {
  assertServerPermission(ctx, serverId, Perm.MANAGE_SERVER);
  return ctx.db.all<WebhookRow>('SELECT * FROM webhooks WHERE server_id = ? ORDER BY created_at ASC', serverId)
    .map((row) => toWebhookDto(row));
}

export function deleteWebhook(ctx: Ctx, id: string): void {
  const row = ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'WEBHOOK_NOT_FOUND', 'That webhook crawled back into the sewer.');
  assertServerPermission(ctx, row.server_id, Perm.MANAGE_SERVER);
  ctx.db.run('DELETE FROM webhooks WHERE id = ?', id);
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'webhook.delete', targetType: 'webhook', targetId: id,
    changes: { name: row.name },
  });
}

export function executeWebhook(ctx: Ctx, id: string, rawToken: string, body: Record<string, unknown>): Message {
  const row = ctx.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id);
  if (!row) throw new ApiError(401, 'INVALID_WEBHOOK_TOKEN', 'That webhook is not valid.');
  if (!safeEqual(sha256(rawToken), row.token_hash)) {
    throw new ApiError(401, 'INVALID_WEBHOOK_TOKEN', 'That webhook token is not valid.');
  }
  const channel = getChannelOr404(ctx, row.channel_id);
  if (!WEBHOOK_POST_TYPES.includes(channel.type)) {
    throw new ApiError(400, 'WEBHOOK_CHANNEL_INVALID', 'This webhook points at a channel that cannot take messages.');
  }
  if (typeof body.content !== 'string') {
    throw new ValidationError({ content: 'Webhook content must be a string.' });
  }
  const content = body.content.trim();
  if (content.length < 1 || content.length > 2000) {
    throw new ValidationError({ content: 'Webhook content must be 1-2000 characters.' });
  }
  let username: string | null = null;
  if (body.username !== undefined && body.username !== null && body.username !== '') {
    if (typeof body.username !== 'string') throw new ValidationError({ username: 'Webhook username must be a string.' });
    username = body.username.trim().replace(/\s+/g, ' ');
    if (username.length < 1 || username.length > 80) {
      throw new ValidationError({ username: 'Webhook username must be 1-80 characters.' });
    }
  }
  const server = requireServer(ctx, row.server_id, { member: false });
  const messageId = newId('m');
  const now = Date.now();
  const flags = JSON.stringify({ webhook: row.id, webhookName: row.name, username: username ?? row.name });
  ctx.db.run(
    `INSERT INTO messages (id, channel_id, server_id, author_id, content, type, flags, created_at)
     VALUES (?, ?, ?, ?, ?, 'default', ?, ?)`,
    messageId, channel.id, row.server_id, server.owner_id, content, flags, now,
  );
  ctx.db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', messageId, channel.id);
  ctx.db.run('UPDATE webhooks SET last_used_at = ? WHERE id = ?', now, row.id);
  const messageRow = ctx.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId)!;
  const message = serializeMessages(ctx.db, [messageRow], ctx.user?.id ?? '')[0];
  if (!message) throw new ApiError(500, 'WEBHOOK_MESSAGE_LOST', 'The webhook message vanished into the slop.');
  ctx.hub.invalidateChannel(channel.id);
  ctx.hub.broadcastChannel(channel.id, 'MESSAGE_CREATE', { message });
  return message;
}
