import type { Ctx } from '../http';
import { ApiError } from '../http';
import { ValidationError, bool, color, optText } from '../util/validate';
import { parseJson } from '../repos/users';
import { newId } from '../util/ids';
import { DEFAULT_EVERYONE, Perm } from '../../shared/permissions';
import type { Channel, Emoji, Role, Server, ServerMember, Sound, Sticker } from '../../shared/types';
import {
  channelsForServer, getMemberRow, incrementMemberCount, toMember, toServer, type ServerRow,
} from '../repos/servers';
import type { ChannelRow } from './permissions';
import { assertServerPermission } from './permissions';
import { logAudit } from './audit';
import { grantAchievement } from './achievements';
import {
  UPLOAD_PURPOSES, assertOwnerOrAdmin, broadcastServerUpdate, channelDtos, emojiDtos, getChannelInServer,
  insertChannel, insertSystemMessage, isChannelManager, memberDto, optionalUpload, requireServer, roleDtos,
  serverName, soundDtos, stickerDtos, stringList,
} from './servers_common';

export interface ServerDetail {
  server: Server;
  channels: Channel[];
  roles: Role[];
  member: ServerMember | null;
  emojis: Emoji[];
  stickers: Sticker[];
  sounds: Sound[];
}

export function serverDetail(ctx: Ctx, serverId: string): ServerDetail {
  const row = requireServer(ctx, serverId);
  const roles = roleDtos(ctx.db, row.id, row.member_count);
  const includeAll = isChannelManager(ctx, row.id, ctx.user!.id);
  return {
    server: { ...toServer(row), roles },
    channels: channelDtos(ctx, row.id, ctx.user!.id, includeAll),
    roles,
    member: memberDto(ctx.db, row.id, ctx.user!.id),
    emojis: emojiDtos(ctx.db, row.id),
    stickers: stickerDtos(ctx.db, row.id),
    sounds: soundDtos(ctx.db, row.id),
  };
}

export interface CreateServerResult {
  server: ServerRow;
  channels: ChannelRow[];
  roles: Role[];
  member: ServerMember;
}

const FOUNDER_PERMISSIONS = Perm.ADMINISTRATOR;

export function createServer(ctx: Ctx, body: Record<string, unknown>): CreateServerResult {
  const name = serverName(body.name);
  const description = optText(body.description, 'description', 500);
  const icon = optionalUpload(ctx, body, 'icon', { purposes: UPLOAD_PURPOSES.icon, kind: 'image' }) ?? null;
  if (body.template !== undefined && body.template !== null) {
    const template = String(body.template);
    if (template.length < 1 || template.length > 32) {
      throw new ValidationError({ template: 'Template name must be 1-32 characters.' });
    }
  }
  const ownerId = ctx.user!.id;
  const id = newId('s');
  const now = Date.now();
  let welcomeId: string | undefined;

  ctx.db.transaction(() => {
    ctx.db.run(
      `INSERT INTO servers (id, name, icon, description, owner_id, member_count, is_public, nsfw, traits, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, 0, '[]', ?)`,
      id, name, icon, description, ownerId, now,
    );
    ctx.db.run('INSERT INTO members (server_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?)', id, ownerId, now);
    const everyoneId = newId('r');
    ctx.db.run(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
       VALUES (?, ?, '@everyone', '#99aab5', 0, ?, 0, 0, 1, ?)`,
      everyoneId, id, DEFAULT_EVERYONE, now,
    );
    const founderId = newId('r');
    ctx.db.run(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, mentionable, hoist, is_default, created_at)
       VALUES (?, ?, 'Founder', '#e3b341', 1, ?, 1, 1, 0, ?)`,
      founderId, id, FOUNDER_PERMISSIONS, now,
    );
    ctx.db.run('INSERT INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', id, ownerId, founderId);

    const info = insertChannel(ctx, id, {
      name: 'Information', type: 'category', parentId: null, topic: null, nsfw: false,
      slowmode: 0, votingEnabled: true, defaultSort: null,
    });
    const welcome = insertChannel(ctx, id, {
      name: 'welcome', type: 'text', parentId: info.id,
      topic: 'Read this before you post. Or don\'t.', nsfw: false, slowmode: 0, votingEnabled: true, defaultSort: null,
    });
    const slop = insertChannel(ctx, id, {
      name: 'The Slop', type: 'category', parentId: null, topic: null, nsfw: false,
      slowmode: 0, votingEnabled: true, defaultSort: null,
    });
    const general = insertChannel(ctx, id, {
      name: 'general', type: 'text', parentId: slop.id,
      topic: 'Chat about anything. Preferably slop.', nsfw: false, slowmode: 0, votingEnabled: true, defaultSort: null,
    });
    insertChannel(ctx, id, {
      name: 'shitpost', type: 'text', parentId: slop.id,
      topic: 'Post your worst takes. No thoughts, just vibes.', nsfw: false, slowmode: 0, votingEnabled: true, defaultSort: null,
    });
    insertChannel(ctx, id, {
      name: 'board', type: 'forum', parentId: slop.id,
      topic: 'Forum posts, sorted by vibes.', nsfw: false, slowmode: 0, votingEnabled: true, defaultSort: 'new',
    });
    insertChannel(ctx, id, {
      name: 'voice', type: 'voice', parentId: slop.id, topic: null, nsfw: false,
      slowmode: 0, votingEnabled: false, defaultSort: null,
    });
    ctx.db.run('UPDATE servers SET welcome_channel_id = ?, system_channel_id = ? WHERE id = ?', welcome.id, general.id, id);
    welcomeId = welcome.id;
  });

  if (welcomeId) {
    insertSystemMessage(ctx, {
      channelId: welcomeId, serverId: id, authorId: ownerId,
      content: `Welcome to ${name}! This server was forged from pure slop. Be nice, shitpost responsibly, and read the rules (if anyone remembered to write them).`,
    });
  }
  logAudit(ctx.db, {
    serverId: id, actorId: ownerId, action: 'server.create', targetType: 'server', targetId: id, changes: { name },
  });
  grantAchievement(ctx.db, ctx.hub, ownerId, 'server_owner');

  const server = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', id)!;
  const memberRow = getMemberRow(ctx.db, id, ownerId)!;
  return {
    server,
    channels: channelsForServer(ctx.db, id),
    roles: roleDtos(ctx.db, id, server.member_count),
    member: toMember(ctx.db, memberRow, ctx.user!),
  };
}

function messageChannelRef(ctx: Ctx, serverId: string, value: unknown, field: string): string | null {
  if (value === null || value === '' || value === undefined) return null;
  const channel = getChannelInServer(ctx, serverId, String(value), field);
  if (channel.type !== 'text' && channel.type !== 'announcement') {
    throw new ValidationError({ [field]: 'Pick a text or announcement channel.' });
  }
  return channel.id;
}

export function updateServer(ctx: Ctx, serverId: string, body: Record<string, unknown>): Server {
  assertServerPermission(ctx, serverId, Perm.MANAGE_SERVER);
  const row = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', serverId)!;
  const name = 'name' in body ? serverName(body.name) : row.name;
  const description = 'description' in body ? optText(body.description, 'description', 500) : row.description;
  const icon = optionalUpload(ctx, body, 'icon', { purposes: UPLOAD_PURPOSES.icon, kind: 'image' });
  const banner = optionalUpload(ctx, body, 'banner', { purposes: UPLOAD_PURPOSES.banner, kind: 'image' });
  let bannerColor = row.banner_color;
  if ('bannerColor' in body) bannerColor = body.bannerColor === null || body.bannerColor === '' ? null : color(body.bannerColor);
  const nsfw = 'nsfw' in body ? bool(body.nsfw) : !!row.nsfw;
  const isPublic = 'isPublic' in body ? bool(body.isPublic) : !!row.is_public;
  const motd = 'motd' in body ? optText(body.motd, 'motd', 500) : row.motd;
  const welcomeChannelId = 'welcomeChannelId' in body
    ? messageChannelRef(ctx, serverId, body.welcomeChannelId, 'welcomeChannelId')
    : row.welcome_channel_id;
  const systemChannelId = 'systemChannelId' in body
    ? messageChannelRef(ctx, serverId, body.systemChannelId, 'systemChannelId')
    : row.system_channel_id;
  const traits = 'traits' in body ? stringList(body.traits, 'traits', 20, 32) : parseJson<string[]>(row.traits, []);

  ctx.db.run(
    `UPDATE servers SET name = ?, description = ?, icon = ?, banner = ?, banner_color = ?, nsfw = ?, is_public = ?,
       motd = ?, welcome_channel_id = ?, system_channel_id = ?, traits = ? WHERE id = ?`,
    name, description, icon === undefined ? row.icon : icon, banner === undefined ? row.banner : banner,
    bannerColor, nsfw ? 1 : 0, isPublic ? 1 : 0, motd, welcomeChannelId, systemChannelId,
    JSON.stringify(traits), serverId,
  );
  const updated = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', serverId)!;
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'server.update', targetType: 'server', targetId: serverId,
    changes: {
      name: name !== row.name ? name : undefined,
      description: description !== row.description ? description : undefined,
      isPublic: isPublic !== !!row.is_public ? isPublic : undefined,
      nsfw: nsfw !== !!row.nsfw ? nsfw : undefined,
    },
  });
  return broadcastServerUpdate(ctx, updated);
}

export function deleteServer(ctx: Ctx, serverId: string, body: Record<string, unknown>): void {
  const server = requireServer(ctx, serverId, { member: false });
  assertOwnerOrAdmin(ctx, server);
  const confirmName = String(body.confirmName ?? '');
  if (confirmName !== server.name) {
    throw new ValidationError({ confirmName: 'Type the exact server name to confirm deletion.' });
  }
  ctx.hub.broadcastServer(serverId, 'SERVER_LEAVE', { serverId, name: server.name });
  ctx.db.run('DELETE FROM servers WHERE id = ?', serverId);
  logAudit(ctx.db, {
    serverId: null, actorId: ctx.user!.id, action: 'server.delete', targetType: 'server', targetId: serverId,
    changes: { name: server.name },
  });
}

export function leaveServer(ctx: Ctx, serverId: string): void {
  const server = requireServer(ctx, serverId);
  if (server.owner_id === ctx.user!.id) {
    throw new ApiError(409, 'OWNER_CANNOT_LEAVE', 'Transfer ownership before leaving. The throne needs a warm body.');
  }
  ctx.db.transaction(() => {
    ctx.db.run('DELETE FROM members WHERE server_id = ? AND user_id = ?', serverId, ctx.user!.id);
    ctx.db.run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ?', serverId, ctx.user!.id);
    incrementMemberCount(ctx.db, serverId, -1);
  });
  ctx.hub.broadcastServer(serverId, 'MEMBER_REMOVE', { serverId, userId: ctx.user!.id });
  ctx.hub.send(ctx.user!.id, 'SERVER_LEAVE', { serverId });
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'member.leave', targetType: 'member', targetId: ctx.user!.id,
  });
}

export function transferServer(ctx: Ctx, serverId: string, body: Record<string, unknown>): Server {
  const server = requireServer(ctx, serverId, { member: false });
  if (server.owner_id !== ctx.user!.id) {
    throw new ApiError(403, 'OWNER_ONLY', 'Only the current owner can transfer this server.');
  }
  const targetId = String(body.userId ?? '');
  if (!targetId) throw new ValidationError({ userId: 'Pick the member who should take the throne.' });
  if (targetId === ctx.user!.id) throw new ValidationError({ userId: 'You already own this server.' });
  if (!getMemberRow(ctx.db, serverId, targetId)) {
    throw new ValidationError({ userId: 'That user is not a member of this server.' });
  }
  ctx.db.transaction(() => {
    ctx.db.run('UPDATE servers SET owner_id = ? WHERE id = ?', targetId, serverId);
    const founder = ctx.db.get<{ id: string }>(
      "SELECT id FROM roles WHERE server_id = ? AND name = 'Founder' AND is_default = 0 LIMIT 1", serverId,
    );
    if (founder) {
      ctx.db.run('DELETE FROM member_roles WHERE server_id = ? AND user_id = ? AND role_id = ?', serverId, ctx.user!.id, founder.id);
      ctx.db.run(
        'INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)', serverId, targetId, founder.id,
      );
    }
  });
  const updated = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', serverId)!;
  logAudit(ctx.db, {
    serverId, actorId: ctx.user!.id, action: 'server.transfer', targetType: 'user', targetId,
    changes: { from: ctx.user!.id, to: targetId },
  });
  return broadcastServerUpdate(ctx, updated);
}
