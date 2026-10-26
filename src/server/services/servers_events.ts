import type { Ctx } from '../http';
import { ApiError } from '../http';
import { ValidationError, bool, int, optText } from '../util/validate';
import { Perm } from '../../shared/permissions';
import { newId } from '../util/ids';
import type { ServerEvent } from '../../shared/types';
import { logAudit } from './audit';
import { assertServerPermission } from './permissions';
import {
  UPLOAD_PURPOSES, eventDtos, getChannelInServer, optionalUpload, requireServer, toEventDto, type EventRow,
} from './servers_common';

function eventName(value: unknown): string {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 1 || s.length > 100) throw new ValidationError({ name: 'Event name must be 1-100 characters.' });
  return s;
}

function timestamp(value: unknown, field: string): number {
  const n = int(value, field, 0, 9_007_199_254_740_991);
  if (n <= 0) throw new ValidationError({ [field]: 'Expected an epoch-milliseconds timestamp.' });
  return n;
}

export function createEvent(ctx: Ctx, serverId: string, body: Record<string, unknown>): ServerEvent {
  assertServerPermission(ctx, serverId, Perm.CREATE_EVENTS);
  const startsAt = timestamp(body.startsAt, 'startsAt');
  const endsAt = body.endsAt === undefined || body.endsAt === null ? null : timestamp(body.endsAt, 'endsAt');
  if (endsAt !== null && endsAt < startsAt) throw new ValidationError({ endsAt: 'Events cannot end before they start. Time travel is out of scope.' });
  const channelId = body.channelId === undefined || body.channelId === null
    ? null
    : getChannelInServer(ctx, serverId, String(body.channelId), 'channelId').id;
  const cover = optionalUpload(ctx, body, 'cover', { purposes: UPLOAD_PURPOSES.cover, kind: 'image' });
  const id = newId('ev');
  ctx.db.run(
    `INSERT INTO server_events (id, server_id, channel_id, name, description, starts_at, ends_at, creator_id, cover, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, serverId, channelId, eventName(body.name), optText(body.description, 'description', 1000),
    startsAt, endsAt, ctx.user!.id, cover ?? null, Date.now(),
  );
  const row = ctx.db.get<EventRow>('SELECT * FROM server_events WHERE id = ?', id)!;
  const event = toEventDto(ctx.db, row, ctx.user!.id);
  ctx.hub.broadcastServer(serverId, 'SERVER_EVENT_UPDATE', { event });
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'event.create', targetType: 'event', targetId: id, changes: { name: event.name },
  });
  return event;
}

export function listEvents(ctx: Ctx, serverId: string): ServerEvent[] {
  requireServer(ctx, serverId);
  return eventDtos(ctx.db, serverId, ctx.user!.id);
}

function assertEventManage(ctx: Ctx, row: EventRow): void {
  requireServer(ctx, row.server_id);
  if (row.creator_id === ctx.user!.id || ctx.user!.is_admin) return;
  assertServerPermission(ctx, row.server_id, Perm.MANAGE_SERVER);
}

export function updateEvent(ctx: Ctx, eventId: string, body: Record<string, unknown>): ServerEvent {
  const row = ctx.db.get<EventRow>('SELECT * FROM server_events WHERE id = ?', eventId);
  if (!row) throw new ApiError(404, 'EVENT_NOT_FOUND', 'That event got cancelled by reality.');
  assertEventManage(ctx, row);
  const name = 'name' in body ? eventName(body.name) : row.name;
  const description = 'description' in body ? optText(body.description, 'description', 1000) : row.description;
  const startsAt = 'startsAt' in body ? timestamp(body.startsAt, 'startsAt') : row.starts_at;
  const endsAt = 'endsAt' in body
    ? (body.endsAt === null ? null : timestamp(body.endsAt, 'endsAt'))
    : row.ends_at;
  if (endsAt !== null && endsAt < startsAt) throw new ValidationError({ endsAt: 'Events cannot end before they start.' });
  let channelId = row.channel_id;
  if ('channelId' in body) {
    channelId = body.channelId === null ? null : getChannelInServer(ctx, row.server_id, String(body.channelId), 'channelId').id;
  }
  const cover = optionalUpload(ctx, body, 'cover', { purposes: UPLOAD_PURPOSES.cover, kind: 'image' });
  ctx.db.run(
    'UPDATE server_events SET name = ?, description = ?, starts_at = ?, ends_at = ?, channel_id = ?, cover = ? WHERE id = ?',
    name, description, startsAt, endsAt, channelId, cover === undefined ? row.cover : cover, row.id,
  );
  const updated = ctx.db.get<EventRow>('SELECT * FROM server_events WHERE id = ?', row.id)!;
  const event = toEventDto(ctx.db, updated, ctx.user!.id);
  ctx.hub.broadcastServer(row.server_id, 'SERVER_EVENT_UPDATE', { event });
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'event.update', targetType: 'event', targetId: row.id,
    changes: { name, startsAt, endsAt },
  });
  return event;
}

export function deleteEvent(ctx: Ctx, eventId: string): void {
  const row = ctx.db.get<EventRow>('SELECT * FROM server_events WHERE id = ?', eventId);
  if (!row) throw new ApiError(404, 'EVENT_NOT_FOUND', 'That event got cancelled by reality.');
  assertEventManage(ctx, row);
  ctx.db.run('DELETE FROM server_events WHERE id = ?', row.id);
  ctx.hub.broadcastServer(row.server_id, 'SERVER_EVENT_UPDATE', { eventId: row.id, deleted: true });
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'event.delete', targetType: 'event', targetId: row.id,
    changes: { name: row.name },
  });
}

export function rsvpEvent(ctx: Ctx, eventId: string, body: Record<string, unknown>): ServerEvent {
  const row = ctx.db.get<EventRow>('SELECT * FROM server_events WHERE id = ?', eventId);
  if (!row) throw new ApiError(404, 'EVENT_NOT_FOUND', 'That event got cancelled by reality.');
  requireServer(ctx, row.server_id);
  if (!('status' in body)) throw new ValidationError({ status: 'RSVP status is required (interested, going or null).' });
  const status = body.status;
  if (status !== null && status !== 'interested' && status !== 'going') {
    throw new ValidationError({ status: 'RSVP status must be interested, going or null.' });
  }
  if (status === null) {
    ctx.db.run('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?', row.id, ctx.user!.id);
  } else {
    ctx.db.run(
      `INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status`,
      row.id, ctx.user!.id, status,
    );
  }
  const event = toEventDto(ctx.db, row, ctx.user!.id);
  ctx.hub.broadcastServer(row.server_id, 'SERVER_EVENT_UPDATE', { event });
  return event;
}

export interface RuleRow {
  id: string; server_id: string | null; pattern: string; action: string; enabled: number;
  created_by: string | null; created_at: number;
}

export interface RuleDto {
  id: string; serverId: string | null; pattern: string; action: string; enabled: boolean;
  createdBy: string | null; createdAt: number;
}

function toRuleDto(row: RuleRow): RuleDto {
  return {
    id: row.id, serverId: row.server_id, pattern: row.pattern, action: row.action,
    enabled: !!row.enabled, createdBy: row.created_by, createdAt: row.created_at,
  };
}

const RULE_ACTIONS = ['flag', 'delete', 'warn', 'timeout', 'ban'];

export function listRules(ctx: Ctx, serverId: string): RuleDto[] {
  requireServer(ctx, serverId);
  return ctx.db.all<RuleRow>('SELECT * FROM moderation_rules WHERE server_id = ? ORDER BY created_at ASC', serverId)
    .map(toRuleDto);
}

export function createRule(ctx: Ctx, serverId: string, body: Record<string, unknown>): RuleDto {
  assertServerPermission(ctx, serverId, Perm.MANAGE_SERVER);
  const pattern = String(body.pattern ?? '').trim();
  if (pattern.length < 1 || pattern.length > 500) {
    throw new ValidationError({ pattern: 'Rule pattern must be 1-500 characters.' });
  }
  const action = body.action === undefined ? 'flag' : String(body.action);
  if (!RULE_ACTIONS.includes(action)) {
    throw new ValidationError({ action: `Rule action must be one of: ${RULE_ACTIONS.join(', ')}.` });
  }
  const enabled = body.enabled === undefined ? true : bool(body.enabled);
  const id = newId('rule');
  ctx.db.run(
    'INSERT INTO moderation_rules (id, server_id, pattern, action, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, serverId, pattern, action, enabled ? 1 : 0, ctx.user!.id, Date.now(),
  );
  const row = ctx.db.get<RuleRow>('SELECT * FROM moderation_rules WHERE id = ?', id)!;
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'rule.create', targetType: 'rule', targetId: id, changes: { pattern, action },
  });
  return toRuleDto(row);
}

export function deleteRule(ctx: Ctx, id: string): void {
  const row = ctx.db.get<RuleRow>('SELECT * FROM moderation_rules WHERE id = ?', id);
  if (!row) throw new ApiError(404, 'RULE_NOT_FOUND', 'That rule was already fed to the shredder.');
  if (!row.server_id) {
    if (!ctx.user!.is_admin) throw new ApiError(403, 'ADMIN_ONLY', 'Global rules are instance-admin only.');
  } else {
    assertServerPermission(ctx, row.server_id, Perm.MANAGE_SERVER);
  }
  ctx.db.run('DELETE FROM moderation_rules WHERE id = ?', id);
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'rule.delete', targetType: 'rule', targetId: id,
    changes: { pattern: row.pattern },
  });
}
