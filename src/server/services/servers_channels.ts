import type { Ctx } from '../http';
import { ApiError } from '../http';
import { ValidationError, bool, int, optText } from '../util/validate';
import { Perm, has } from '../../shared/permissions';
import type { ChannelOverride } from '../../shared/types';
import { parseJson } from '../repos/users';
import { computeBasePermissions, type ChannelRow } from './permissions';
import { logAudit } from './audit';
import {
  assertChannelManager, categoryParent, channelDto, channelName, channelType, clearChannelRefs,
  defaultSort, getChannelOr404, insertChannel, optionalUpload, permissionMask, slowmode, stringList,
} from './servers_common';

const CHANNEL_ICON_PURPOSES = ['emoji', 'server_icon'];

export function createChannel(ctx: Ctx, serverId: string, body: Record<string, unknown>): ChannelRow {
  const type = channelType(body.type);
  const name = channelName(body.name);
  const parentId = categoryParent(ctx, serverId, body.parentId);
  if (type === 'category' && parentId) {
    throw new ValidationError({ parentId: 'Categories cannot be nested inside another category.' });
  }
  const sort = defaultSort(body.defaultSort);
  if (sort && type !== 'forum') throw new ValidationError({ defaultSort: 'Only forum channels have a default sort.' });
  const channel = insertChannel(ctx, serverId, {
    name,
    type,
    parentId,
    topic: optText(body.topic, 'topic', 1024),
    nsfw: bool(body.nsfw),
    slowmode: body.slowmode === undefined ? 0 : slowmode(body.slowmode),
    votingEnabled: body.votingEnabled === undefined ? true : bool(body.votingEnabled),
    defaultSort: sort,
  });
  ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'CHANNEL_CREATE', channelDto(ctx.db, channel));
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'channel.create', targetType: 'channel',
    targetId: channel.id, changes: { name, type, parentId },
  });
  return channel;
}

export function updateChannel(ctx: Ctx, channelId: string, body: Record<string, unknown>): ChannelRow {
  const channel = getChannelOr404(ctx, channelId);
  assertChannelManager(ctx, channel);
  const serverId = channel.server_id!;

  const name = 'name' in body ? channelName(body.name) : channel.name;
  const topic = 'topic' in body ? optText(body.topic, 'topic', 1024) : channel.topic;
  const nsfw = 'nsfw' in body ? bool(body.nsfw) : !!channel.nsfw;
  const slow = 'slowmode' in body ? slowmode(body.slowmode) : channel.slowmode;
  const locked = 'locked' in body ? bool(body.locked) : !!channel.locked;
  const archived = 'archived' in body ? bool(body.archived) : !!channel.archived;
  const votingEnabled = 'votingEnabled' in body ? bool(body.votingEnabled) : !!channel.voting_enabled;
  const tags = 'tags' in body ? stringList(body.tags, 'tags', 10, 32) : parseJson<string[]>(channel.tags, []);
  const sort = 'defaultSort' in body ? defaultSort(body.defaultSort) : (channel.default_sort as 'hot' | 'new' | 'top' | null);
  const icon = optionalUpload(ctx, body, 'icon', { purposes: CHANNEL_ICON_PURPOSES, kind: 'image' });

  let parentId = channel.parent_id;
  if ('parentId' in body) {
    parentId = categoryParent(ctx, serverId, body.parentId, channel.id, 'parentId', channel.type);
    if (channel.type === 'category' && parentId) {
      throw new ValidationError({ parentId: 'Categories cannot be nested inside another category.' });
    }
  }
  if (sort && channel.type !== 'forum') throw new ValidationError({ defaultSort: 'Only forum channels have a default sort.' });

  ctx.db.run(
    `UPDATE channels SET name = ?, topic = ?, nsfw = ?, slowmode = ?, parent_id = ?, locked = ?, archived = ?,
       tags = ?, icon = ?, default_sort = ?, voting_enabled = ? WHERE id = ?`,
    name, topic, nsfw ? 1 : 0, slow, parentId, locked ? 1 : 0, archived ? 1 : 0,
    JSON.stringify(tags), icon === undefined ? channel.icon : icon, sort, votingEnabled ? 1 : 0, channel.id,
  );
  const updated = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channel.id)!;
  ctx.hub.invalidateChannel(channel.id);
  if (parentId !== channel.parent_id) ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'CHANNEL_UPDATE', channelDto(ctx.db, updated));
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'channel.update', targetType: 'channel', targetId: channel.id,
    changes: {
      name: name !== channel.name ? name : undefined,
      topic: topic !== channel.topic ? topic : undefined,
      parentId: parentId !== channel.parent_id ? parentId : undefined,
      locked: locked !== !!channel.locked ? locked : undefined,
      archived: archived !== !!channel.archived ? archived : undefined,
    },
  });
  return updated;
}

export function deleteChannel(ctx: Ctx, channelId: string): ChannelRow {
  const channel = getChannelOr404(ctx, channelId);
  assertChannelManager(ctx, channel);
  const serverId = channel.server_id!;
  let deletedChildren = 0;
  if (channel.type === 'category') {
    // Keep ordinary channels alive; they just float to the top level.
    ctx.db.run('UPDATE channels SET parent_id = NULL WHERE parent_id = ?', channel.id);
  } else {
    // Threads have no FK to their parent, so reap them explicitly to avoid orphans.
    const children = ctx.db.all<ChannelRow>('SELECT * FROM channels WHERE parent_id = ? AND server_id = ?', channel.id, serverId);
    for (const child of children) {
      ctx.db.run('DELETE FROM channels WHERE id = ?', child.id);
      clearChannelRefs(ctx.db, serverId, child.id);
      ctx.hub.broadcastServer(serverId, 'CHANNEL_DELETE', {
        channelId: child.id, serverId, parentId: channel.id, type: child.type,
      });
      deletedChildren++;
    }
  }
  ctx.db.run('DELETE FROM channels WHERE id = ?', channel.id);
  clearChannelRefs(ctx.db, serverId, channel.id);
  ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'CHANNEL_DELETE', {
    channelId: channel.id, serverId, parentId: channel.parent_id, type: channel.type,
  });
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'channel.delete', targetType: 'channel', targetId: channel.id,
    changes: { name: channel.name, type: channel.type, deletedChildren },
  });
  return channel;
}

export interface PositionInput { id: string; position: number; parentId: string | null }

export function setChannelPositions(ctx: Ctx, serverId: string, raw: unknown): PositionInput[] {
  if (!Array.isArray(raw)) throw new ValidationError({ positions: 'Expected an array of channel positions.' });
  if (raw.length > 300) throw new ValidationError({ positions: 'Too many positions (max 300).' });
  const cleaned: PositionInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new ValidationError({ positions: 'Each position must be an object.' });
    const entry = item as Record<string, unknown>;
    const id = String(entry.id ?? '');
    if (!id) throw new ValidationError({ positions: 'Each position needs a channel id.' });
    if (seen.has(id)) throw new ValidationError({ positions: 'Duplicate channel id in positions.' });
    seen.add(id);
    const existing = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', id);
    if (!existing || existing.server_id !== serverId) {
      throw new ValidationError({ positions: `Channel ${id} does not belong to this server.` });
    }
    const position = int(entry.position, 'positions.position', 0, 100_000);
    const parentId = 'parentId' in entry
      ? categoryParent(ctx, serverId, entry.parentId, undefined, 'positions.parentId', existing.type)
      : existing.parent_id;
    if (existing.type === 'category' && parentId) {
      throw new ValidationError({ positions: 'Categories cannot be nested inside another category.' });
    }
    cleaned.push({ id, position, parentId });
  }
  ctx.db.transaction(() => {
    for (const p of cleaned) {
      ctx.db.run('UPDATE channels SET position = ?, parent_id = ? WHERE id = ?', p.position, p.parentId, p.id);
    }
  });
  ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'CHANNELS_REORDER', { serverId, positions: cleaned });
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'channel.reorder', targetType: 'server', targetId: serverId,
    changes: { positions: cleaned },
  });
  return cleaned;
}

export function replaceChannelOverrides(ctx: Ctx, channelId: string, raw: unknown): ChannelOverride[] {
  const channel = getChannelOr404(ctx, channelId);
  assertChannelManager(ctx, channel);
  const serverId = channel.server_id!;
  if (!Array.isArray(raw)) throw new ValidationError({ overrides: 'Expected an array of overrides.' });
  if (raw.length > 200) throw new ValidationError({ overrides: 'Too many overrides (max 200).' });

  const base = computeBasePermissions(ctx.db, serverId, ctx.user!.id);
  const canGrantEverything = ctx.user!.is_admin || has(base.permissions, Perm.ADMINISTRATOR);
  const overrides: ChannelOverride[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new ValidationError({ overrides: 'Each override must be an object.' });
    const entry = item as Record<string, unknown>;
    const targetType = String(entry.targetType ?? '');
    if (targetType !== 'role' && targetType !== 'user') {
      throw new ValidationError({ overrides: 'targetType must be role or user.' });
    }
    const targetId = String(entry.targetId ?? '');
    if (!targetId) throw new ValidationError({ overrides: 'Override is missing a targetId.' });
    const key = `${targetType}:${targetId}`;
    if (seen.has(key)) throw new ValidationError({ overrides: 'Duplicate override target.' });
    seen.add(key);
    if (targetType === 'role') {
      const role = ctx.db.get<{ id: string }>('SELECT id FROM roles WHERE id = ? AND server_id = ?', targetId, serverId);
      if (!role) throw new ValidationError({ overrides: 'Override role must belong to this server.' });
    } else {
      const member = ctx.db.get('SELECT 1 FROM members WHERE server_id = ? AND user_id = ?', serverId, targetId);
      if (!member) throw new ValidationError({ overrides: 'Override user must be a member of this server.' });
    }
    const allow = permissionMask(entry.allow ?? 0, 'overrides.allow');
    const deny = permissionMask(entry.deny ?? 0, 'overrides.deny');
    if (!canGrantEverything && (allow & ~base.permissions) !== 0) {
      throw new ApiError(403, 'CANNOT_GRANT_PERMISSIONS', 'You cannot grant permissions you do not have. Sneaky.');
    }
    overrides.push({ targetType, targetId, allow, deny });
  }

  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM channel_overrides WHERE channel_id = ?', channel.id);
    for (const o of overrides) {
      ctx.db.run(
        'INSERT INTO channel_overrides (channel_id, target_type, target_id, allow, deny) VALUES (?, ?, ?, ?, ?)',
        channel.id, o.targetType, o.targetId, o.allow, o.deny,
      );
    }
  });
  ctx.hub.invalidateServer(serverId);
  ctx.hub.broadcastServer(serverId, 'CHANNEL_UPDATE', channelDto(ctx.db, channel));
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'channel.overrides', targetType: 'channel', targetId: channel.id,
    changes: { overrides },
  });
  return overrides;
}
