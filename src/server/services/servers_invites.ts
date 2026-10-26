import type { Ctx, UserRow } from '../http';
import { ApiError } from '../http';
import { int } from '../util/validate';
import { Perm, has } from '../../shared/permissions';
import { newId, shortCode } from '../util/ids';
import { getMemberRow, incrementMemberCount, toChannel, toMember, toServer, type ServerRow } from '../repos/servers';
import { toUser } from '../repos/users';
import { computeBasePermissions, computeChannelPermissions, isServerMember, type ChannelRow } from './permissions';
import { logAudit } from './audit';
import { getChannelOr404, insertSystemMessage, requireServer } from './servers_common';
import type { Channel, Invite, Server } from '../../shared/types';

export interface InviteRow {
  code: string;
  server_id: string;
  channel_id: string | null;
  creator_id: string;
  max_uses: number;
  uses: number;
  expires_at: number | null;
  created_at: number;
}

export function toInviteDto(ctx: Ctx, row: InviteRow): Invite {
  const creator = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.creator_id);
  if (!creator) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite lost its creator to the void.');
  return {
    code: row.code,
    serverId: row.server_id,
    channelId: row.channel_id,
    creator: toUser(creator),
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export function inviteRows(ctx: Ctx, serverId: string): InviteRow[] {
  return ctx.db.all<InviteRow>('SELECT * FROM invites WHERE server_id = ? ORDER BY created_at DESC', serverId);
}

function inviteExpired(row: InviteRow): boolean {
  return row.expires_at !== null && row.expires_at <= Date.now();
}

function inviteExhausted(row: InviteRow): boolean {
  return row.max_uses > 0 && row.uses >= row.max_uses;
}

export function assertInviteUsable(row: InviteRow): void {
  if (inviteExpired(row)) throw new ApiError(410, 'INVITE_EXPIRED', 'This invite expired. Even the slop has standards.');
  if (inviteExhausted(row)) throw new ApiError(410, 'INVITE_MAX_USES', 'This invite hit its use limit. Find another slop dealer.');
}

export function createInvite(ctx: Ctx, channelId: string, body: Record<string, unknown>): InviteRow {
  const channel = getChannelOr404(ctx, channelId);
  if (!channel.server_id) throw new ApiError(400, 'NOT_A_SERVER_CHANNEL', 'You cannot invite people to a DM. Just ask them out.');
  if (!ctx.user!.is_admin) {
    const perms = computeChannelPermissions(ctx.db, ctx.user!.id, channel);
    if (!has(perms, Perm.VIEW_CHANNEL) || !has(perms, Perm.CREATE_INVITES)) {
      throw new ApiError(403, 'MISSING_PERMISSIONS', 'You cannot create invites here. The audacity.');
    }
  }
  const maxUses = body.maxUses === undefined ? 0 : int(body.maxUses, 'maxUses', 0, 1000);
  const expiresInHours = body.expiresInHours === undefined ? null : int(body.expiresInHours, 'expiresInHours', 0, 8760) || null;
  let code = '';
  for (let i = 0; i < 6 && !code; i++) {
    const candidate = shortCode(10);
    if (!ctx.db.get('SELECT 1 FROM invites WHERE code = ?', candidate)) code = candidate;
  }
  if (!code) code = newId('inv');
  const now = Date.now();
  ctx.db.run(
    'INSERT INTO invites (code, server_id, channel_id, creator_id, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    code, channel.server_id, channel.id, ctx.user!.id, maxUses, expiresInHours ? now + expiresInHours * 3_600_000 : null, now,
  );
  logAudit(ctx.db, {
    serverId: channel.server_id, actorId: ctx.user!.id, action: 'invite.create', targetType: 'invite',
    targetId: code, changes: { channelId: channel.id, maxUses, expiresInHours },
  });
  return ctx.db.get<InviteRow>('SELECT * FROM invites WHERE code = ?', code)!;
}

export function assertInviteManage(ctx: Ctx, serverId: string): void {
  requireServer(ctx, serverId);
  if (ctx.user!.is_admin) return;
  const base = computeBasePermissions(ctx.db, serverId, ctx.user!.id);
  if (!has(base.permissions, Perm.MANAGE_SERVER) && !has(base.permissions, Perm.CREATE_INVITES)) {
    throw new ApiError(403, 'MISSING_PERMISSIONS', 'Managing invites needs Manage Server or Create Invites.');
  }
}

export function deleteInvite(ctx: Ctx, code: string): InviteRow {
  const row = ctx.db.get<InviteRow>('SELECT * FROM invites WHERE code = ?', code);
  if (!row) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite never existed or already died.');
  if (row.creator_id !== ctx.user!.id) {
    requireServer(ctx, row.server_id);
    if (!ctx.user!.is_admin) {
      const base = computeBasePermissions(ctx.db, row.server_id, ctx.user!.id);
      if (!has(base.permissions, Perm.MANAGE_SERVER)) {
        throw new ApiError(403, 'MISSING_PERMISSIONS', 'Only the creator or a server manager can revoke this invite.');
      }
    }
  }
  ctx.db.run('DELETE FROM invites WHERE code = ?', code);
  logAudit(ctx.db, {
    serverId: row.server_id, actorId: ctx.user!.id, action: 'invite.delete', targetType: 'invite', targetId: code,
  });
  return row;
}

export interface InvitePreview {
  invite: { code: string; serverId: string; channelId: string | null; uses: number; maxUses: number; expiresAt: number | null; createdAt: number };
  server: { id: string; name: string; icon: string | null; description: string | null; memberCount: number; onlineCount: number };
  channel: { id: string; name: string } | null;
  inviter: { id: string; displayName: string };
}

export function invitePreview(ctx: Ctx, code: string): InvitePreview {
  const row = ctx.db.get<InviteRow>('SELECT * FROM invites WHERE code = ?', code);
  if (!row) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite never existed or already died.');
  assertInviteUsable(row);
  const server = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', row.server_id);
  if (!server) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite points at a server that no longer exists.');
  const channel = row.channel_id
    ? ctx.db.get<{ id: string; name: string }>('SELECT id, name FROM channels WHERE id = ?', row.channel_id)
    : null;
  const inviter = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.creator_id);
  if (!inviter) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite lost its creator to the void.');
  const onlineCount = ctx.db.all<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = ?', server.id)
    .filter((m) => ctx.hub.isOnline(m.user_id)).length;
  return {
    invite: {
      code: row.code, serverId: row.server_id, channelId: row.channel_id, uses: row.uses,
      maxUses: row.max_uses, expiresAt: row.expires_at, createdAt: row.created_at,
    },
    server: {
      id: server.id, name: server.name, icon: server.icon, description: server.description,
      memberCount: server.member_count, onlineCount,
    },
    channel: channel ? { id: channel.id, name: channel.name } : null,
    inviter: { id: inviter.id, displayName: inviter.display_name },
  };
}

export function assertNotBanned(ctx: Ctx, serverId: string, userId: string): void {
  const ban = ctx.db.get<{ reason: string | null }>('SELECT reason FROM bans WHERE server_id = ? AND user_id = ?', serverId, userId);
  if (ban) {
    const reason = ban.reason ? ` Reason: ${ban.reason}` : '';
    throw new ApiError(403, 'BANNED_FROM_SERVER', `You are banned from this server.${reason}`);
  }
}

export function joinChannelFor(db: Ctx['db'], server: ServerRow, userId: string): ChannelRow | null {
  const preferred = [server.welcome_channel_id, server.system_channel_id].filter((id): id is string => !!id);
  for (const id of preferred) {
    const row = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ? AND server_id = ?', id, server.id);
    if (row && has(computeChannelPermissions(db, userId, row), Perm.VIEW_CHANNEL)) return row;
  }
  const rows = db.all<ChannelRow>('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC', server.id);
  for (const row of rows) {
    if (has(computeChannelPermissions(db, userId, row), Perm.VIEW_CHANNEL)) return row;
  }
  return rows[0] ?? null;
}

export interface JoinResult { joined: boolean; channel: ChannelRow | null }

export function joinServer(ctx: Ctx, server: ServerRow, opts: { invite?: InviteRow; via: 'invite' | 'discover' }): JoinResult {
  const userId = ctx.user!.id;
  if (isServerMember(ctx.db, server.id, userId)) {
    return { joined: false, channel: joinChannelFor(ctx.db, server, userId) };
  }
  assertNotBanned(ctx, server.id, userId);
  const now = Date.now();
  ctx.db.transaction(() => {
    if (opts.invite) {
      const claimed = ctx.db.run(
        'UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses = 0 OR uses < max_uses)', opts.invite.code,
      );
      if (claimed.changes === 0) throw new ApiError(410, 'INVITE_MAX_USES', 'This invite hit its use limit. Find another slop dealer.');
    }
    ctx.db.run('INSERT INTO members (server_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?)', server.id, userId, now);
    incrementMemberCount(ctx.db, server.id, 1);
  });
  const memberRow = getMemberRow(ctx.db, server.id, userId);
  if (memberRow) {
    ctx.hub.broadcastServer(server.id, 'MEMBER_ADD', { serverId: server.id, member: toMember(ctx.db, memberRow) });
  }
  const fresh = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', server.id)!;
  ctx.hub.send(userId, 'SERVER_JOIN', { server: toServer(fresh) });
  if (fresh.welcome_channel_id) {
    const welcome = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', fresh.welcome_channel_id);
    if (welcome) {
      insertSystemMessage(ctx, {
        channelId: welcome.id, serverId: fresh.id, authorId: fresh.owner_id,
        content: `${ctx.user!.display_name} just joined the server. Say hi or don't, we won't judge.`,
      });
    }
  }
  logAudit(ctx.db, {
    serverId: fresh.id, actorId: userId, action: 'member.join', targetType: 'member', targetId: userId,
    changes: { via: opts.via, invite: opts.invite?.code ?? null },
  });
  return { joined: true, channel: joinChannelFor(ctx.db, fresh, userId) };
}

export interface AcceptInviteResult { server: Server; channel: Channel | null }

export function acceptInvite(ctx: Ctx, code: string): AcceptInviteResult {
  const row = ctx.db.get<InviteRow>('SELECT * FROM invites WHERE code = ?', code);
  if (!row) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite never existed or already died.');
  assertInviteUsable(row);
  const server = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', row.server_id);
  if (!server) throw new ApiError(404, 'INVITE_NOT_FOUND', 'That invite points at a server that no longer exists.');
  assertNotBanned(ctx, server.id, ctx.user!.id);
  const result = joinServer(ctx, server, { invite: row, via: 'invite' });
  const current = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', server.id)!;
  let channel = result.channel;
  if (row.channel_id) {
    const invited = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ? AND server_id = ?', row.channel_id, server.id);
    if (invited && has(computeChannelPermissions(ctx.db, ctx.user!.id, invited), Perm.VIEW_CHANNEL)) channel = invited;
  }
  return { server: toServer(current), channel: channel ? toChannel(channel) : null };
}

export interface DiscoverServer extends Server { onlineCount: number }

export function discoverServers(ctx: Ctx): DiscoverServer[] {
  const rows = ctx.db.all<ServerRow>('SELECT * FROM servers WHERE is_public = 1 ORDER BY member_count DESC, created_at ASC LIMIT 100');
  return rows.map((row) => ({
    ...toServer(row),
    onlineCount: ctx.db.all<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = ?', row.id)
      .filter((m) => ctx.hub.isOnline(m.user_id)).length,
  }));
}

export function joinDiscovery(ctx: Ctx, serverId: string): AcceptInviteResult {
  const server = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ? AND is_public = 1', serverId);
  if (!server) throw new ApiError(404, 'SERVER_NOT_FOUND', 'No public server here. The discovery goblin shrugs.');
  assertNotBanned(ctx, server.id, ctx.user!.id);
  const result = joinServer(ctx, server, { via: 'discover' });
  const current = ctx.db.get<ServerRow>('SELECT * FROM servers WHERE id = ?', server.id)!;
  return { server: toServer(current), channel: result.channel ? toChannel(result.channel) : null };
}
