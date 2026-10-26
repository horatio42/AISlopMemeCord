import type { Router, Ctx, UserRow } from '../http';
import { ApiError, json, readJson } from '../http';
import { ValidationError, bool } from '../util/validate';
import { newId } from '../util/ids';
import { notify, markNotificationsRead } from '../services/notifications';
import {
  DM_MAX_MEMBERS, buildDmChannel, listDmChannels, requireDmMembership, dmChannelRow, dmMembership,
  dmMemberIds, isGroupOwner, findDirectDm, insertDmChannel, broadcastDmCreate,
  broadcastDmUpdate, broadcastDmGone, dmNotFound, type DmChannelRow,
} from '../services/dms_channels';
import {
  friendshipDirections, friendshipBetween, blockedEither, friendFor, friendLists,
  broadcastFriendUpdate, friendAchievements, type FriendshipRow,
} from '../services/dms_friends';
import { toNotification, unreadNotificationCount, listNotifications } from '../services/dms_notifications';

/** Uploaded image assets a caller may use as a group DM icon. */
const ICON_PURPOSES: Record<string, true> = {
  avatar: true, banner: true, server_icon: true, server_banner: true, webhook_avatar: true,
  emoji: true, sticker: true, event_cover: true, dm_icon: true,
};
const UPLOAD_PATH_RE = /^\/api\/media\/uploads\/([A-Za-z0-9_-]+)$/;

function getEnabledUser(ctx: Ctx, id: string): UserRow {
  const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ? AND disabled = 0', id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'No such user. They may have ascended beyond the slop.');
  return user;
}

function assertNotBlocked(ctx: Ctx, otherId: string): void {
  if (blockedEither(ctx.db, ctx.user!.id, otherId)) {
    throw new ApiError(403, 'BLOCKED', 'One of you blocked the other. This conversation is embargoed until the beef is squashed.');
  }
}

function parseRecipientIds(value: unknown, callerId: string): string[] {
  if (!Array.isArray(value)) throw new ValidationError({ recipientIds: 'recipientIds must be an array of user IDs.' });
  const ids = [...new Set(value.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (!ids.length) throw new ValidationError({ recipientIds: 'Pick at least one person to DM.' });
  if (ids.includes(callerId)) throw new ValidationError({ recipientIds: "You can't DM yourself. Therapy is cheaper." });
  if (ids.length + 1 > DM_MAX_MEMBERS) {
    throw new ValidationError({ recipientIds: `A DM holds at most ${DM_MAX_MEMBERS} people, including you.` });
  }
  return ids;
}

function resolveGroupIcon(ctx: Ctx, value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError({ icon: 'Icon must be an upload URL.' });
  const trimmed = value.trim();
  const match = UPLOAD_PATH_RE.exec(trimmed);
  if (!match) {
    throw new ValidationError({ icon: 'Group icons must come from your own uploads, not random corners of the internet.' });
  }
  const upload = ctx.db.get<{ owner_id: string; purpose: string }>(
    'SELECT owner_id, purpose FROM uploads WHERE id = ?', match[1]!,
  );
  if (!upload || upload.owner_id !== ctx.user!.id) {
    throw new ApiError(403, 'UPLOAD_NOT_YOURS', 'That upload belongs to someone else. Use your own slop.');
  }
  if (!ICON_PURPOSES[upload.purpose]) throw new ValidationError({ icon: 'That upload is not an image asset.' });
  return trimmed;
}

function closeDmFor(ctx: Ctx, channel: DmChannelRow): Response {
  const me = ctx.user!;
  ctx.db.run('UPDATE dm_members SET closed = 1 WHERE channel_id = ? AND user_id = ?', channel.id, me.id);
  broadcastDmGone(ctx.hub, channel.id, [me.id]);
  return json({ ok: true });
}

function leaveGroupDm(ctx: Ctx, channel: DmChannelRow): Response {
  const me = ctx.user!;
  ctx.db.run('DELETE FROM dm_members WHERE channel_id = ? AND user_id = ?', channel.id, me.id);
  broadcastDmGone(ctx.hub, channel.id, [me.id]);
  const remaining = dmMemberIds(ctx.db, channel.id);
  if (!remaining.length) {
    ctx.db.run('DELETE FROM channels WHERE id = ?', channel.id);
    ctx.hub.invalidateChannel(channel.id);
  } else {
    broadcastDmUpdate(ctx.db, ctx.hub, channel.id, remaining);
  }
  return json({ ok: true });
}

function deleteGroupDm(ctx: Ctx, channel: DmChannelRow): Response {
  const members = dmMemberIds(ctx.db, channel.id);
  ctx.db.run('DELETE FROM channels WHERE id = ?', channel.id);
  ctx.hub.invalidateChannel(channel.id);
  broadcastDmGone(ctx.hub, channel.id, members);
  return json({ ok: true });
}

export function register(router: Router) {
  router.get('/api/dms', (ctx) => {
    return json({ channels: listDmChannels(ctx.db, ctx.user!.id) });
  });

  router.post('/api/dms', async (ctx) => {
    const me = ctx.user!;
    const body = await readJson(ctx.req);
    const recipientIds = parseRecipientIds(body.recipientIds, me.id);
    const recipients = recipientIds.map((id) => {
      const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ? AND disabled = 0', id);
      if (!user) throw new ValidationError({ recipientIds: `Unknown or disabled user: ${id}` });
      return user;
    });
    for (const recipient of recipients) assertNotBlocked(ctx, recipient.id);

    if (recipientIds.length === 1) {
      const otherId = recipientIds[0]!;
      let channel = findDirectDm(ctx.db, me.id, otherId);
      if (channel) {
        // Reopening a closed 1:1 resurrects it for both sides rather than spawning a duplicate.
        ctx.db.run('UPDATE dm_members SET closed = 0 WHERE channel_id = ?', channel.id);
      } else {
        channel = ctx.db.transaction(() => insertDmChannel(ctx.db, {
          type: 'dm', name: '', memberIds: [me.id, otherId],
        }));
      }
      const built = buildDmChannel(ctx.db, channel, me.id);
      broadcastDmCreate(ctx.db, ctx.hub, channel.id);
      return json({ channel: built });
    }

    const rawName = body.name;
    const name = rawName === undefined || rawName === null ? '' : String(rawName).trim();
    if (!name || name.length > 100) throw new ValidationError({ name: 'Group DMs need a name of 1-100 characters.' });
    const channel = ctx.db.transaction(() => insertDmChannel(ctx.db, {
      type: 'group_dm', name, memberIds: [me.id, ...recipientIds],
    }));
    const built = buildDmChannel(ctx.db, channel, me.id);
    for (const recipient of recipients) {
      notify(ctx.db, ctx.hub, {
        userId: recipient.id,
        type: 'system',
        title: 'Pulled into a group DM',
        body: `${me.display_name || me.username} dragged you into "${name}". Blink twice if you need extraction.`,
        channelId: channel.id,
        actorId: me.id,
      });
    }
    broadcastDmCreate(ctx.db, ctx.hub, channel.id);
    return json({ channel: built });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.get('/api/dms/:id', (ctx) => {
    const { channel } = requireDmMembership(ctx.db, ctx.params.id!, ctx.user!.id);
    return json({ channel: buildDmChannel(ctx.db, channel, ctx.user!.id) });
  });

  router.patch('/api/dms/:id', async (ctx) => {
    const me = ctx.user!;
    const { channel } = requireDmMembership(ctx.db, ctx.params.id!, me.id);
    if (channel.type !== 'group_dm') {
      throw new ApiError(403, 'NOT_GROUP_DM', '1:1 DMs are named after the other person. Your branding ideas are not welcome here.');
    }
    if (!isGroupOwner(ctx.db, channel.id, me.id)) {
      throw new ApiError(403, 'NOT_OWNER', 'Only the group owner can redecorate. Democracy was never an option.');
    }
    const body = await readJson(ctx.req);
    let name = channel.name;
    let icon = channel.icon;
    if (body.name !== undefined) {
      const trimmed = String(body.name ?? '').trim();
      if (!trimmed || trimmed.length > 100) throw new ValidationError({ name: 'Group name must be 1-100 characters.' });
      name = trimmed;
    }
    if (body.icon !== undefined) icon = resolveGroupIcon(ctx, body.icon);
    if (body.name === undefined && body.icon === undefined) {
      throw new ValidationError({ _: 'Send name or icon to update. Empty patches are for ghosts.' });
    }
    ctx.db.run('UPDATE channels SET name = ?, icon = ? WHERE id = ?', name, icon, channel.id);
    broadcastDmUpdate(ctx.db, ctx.hub, channel.id);
    return json({ channel: buildDmChannel(ctx.db, dmChannelRow(ctx.db, channel.id)!, me.id) });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.delete('/api/dms/:id', (ctx) => {
    const me = ctx.user!;
    const { channel } = requireDmMembership(ctx.db, ctx.params.id!, me.id);
    if (channel.type === 'dm') return closeDmFor(ctx, channel);
    if (isGroupOwner(ctx.db, channel.id, me.id)) return deleteGroupDm(ctx, channel);
    return leaveGroupDm(ctx, channel);
  });

  router.post('/api/dms/:id/members', async (ctx) => {
    const me = ctx.user!;
    const { channel } = requireDmMembership(ctx.db, ctx.params.id!, me.id);
    if (channel.type !== 'group_dm') {
      throw new ApiError(400, 'NOT_GROUP_DM', '1:1 DMs are sacred pairs. Make a group DM if you want a crowd.');
    }
    if (!isGroupOwner(ctx.db, channel.id, me.id)) {
      throw new ApiError(403, 'NOT_OWNER', 'Only the group owner can summon more victims.');
    }
    const body = await readJson(ctx.req);
    const userId = String(body.userId ?? '').trim();
    if (!userId) throw new ValidationError({ userId: 'Provide a userId to add.' });
    if (userId === me.id) throw new ValidationError({ userId: 'You are already here. Self-invites are for philosophers.' });
    getEnabledUser(ctx, userId);
    const memberIds = dmMemberIds(ctx.db, channel.id);
    if (memberIds.includes(userId)) throw new ApiError(409, 'ALREADY_MEMBER', 'They are already in this group DM. Count again.');
    if (memberIds.length >= DM_MAX_MEMBERS) {
      throw new ValidationError({ userId: `Group DMs cap at ${DM_MAX_MEMBERS} members. Slop must be rationed.` });
    }
    assertNotBlocked(ctx, userId);
    ctx.db.run(
      'INSERT INTO dm_members (channel_id, user_id, joined_at, closed) VALUES (?, ?, ?, 0)',
      channel.id, userId, Date.now(),
    );
    notify(ctx.db, ctx.hub, {
      userId,
      type: 'system',
      title: 'Pulled into a group DM',
      body: `${me.display_name || me.username} added you to "${channel.name}". Resistance is futile.`,
      channelId: channel.id,
      actorId: me.id,
    });
    broadcastDmCreate(ctx.db, ctx.hub, channel.id, [userId]);
    broadcastDmUpdate(ctx.db, ctx.hub, channel.id, memberIds.filter((id) => id !== userId));
    return json({ channel: buildDmChannel(ctx.db, channel, me.id) });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.delete('/api/dms/:id/members/:userId', (ctx) => {
    const me = ctx.user!;
    const { channel } = requireDmMembership(ctx.db, ctx.params.id!, me.id);
    const targetId = ctx.params.userId!;
    if (targetId === me.id) {
      if (channel.type === 'dm') return closeDmFor(ctx, channel);
      return leaveGroupDm(ctx, channel);
    }
    if (channel.type !== 'group_dm') {
      throw new ApiError(403, 'NOT_ALLOWED', "You can't remove the other person from a 1:1 DM. Close it instead.");
    }
    if (!isGroupOwner(ctx.db, channel.id, me.id)) {
      throw new ApiError(403, 'NOT_OWNER', 'Only the group owner can evict people.');
    }
    if (!dmMembership(ctx.db, channel.id, targetId)) throw dmNotFound();
    ctx.db.run('DELETE FROM dm_members WHERE channel_id = ? AND user_id = ?', channel.id, targetId);
    broadcastDmGone(ctx.hub, channel.id, [targetId]);
    const remaining = dmMemberIds(ctx.db, channel.id);
    if (!remaining.length) {
      ctx.db.run('DELETE FROM channels WHERE id = ?', channel.id);
      ctx.hub.invalidateChannel(channel.id);
      return json({ ok: true });
    }
    notify(ctx.db, ctx.hub, {
      userId: targetId,
      type: 'system',
      title: 'Evicted from a group DM',
      body: `${me.display_name || me.username} removed you from "${channel.name}". The door hit you on the way out.`,
      channelId: channel.id,
      actorId: me.id,
    });
    broadcastDmUpdate(ctx.db, ctx.hub, channel.id, remaining);
    return json({ ok: true, channel: buildDmChannel(ctx.db, dmChannelRow(ctx.db, channel.id)!, me.id) });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });
  router.get('/api/users/@me/friends', (ctx) => {
    return json(friendLists(ctx.db, ctx.user!.id));
  });

  router.post('/api/friends/:userId', async (ctx) => {
    const me = ctx.user!;
    const targetId = ctx.params.userId!;
    if (targetId === me.id) {
      throw new ValidationError({ userId: "You can't befriend yourself. You already have to live with you." });
    }
    const target = getEnabledUser(ctx, targetId);
    assertNotBlocked(ctx, targetId);
    const { outgoing, incoming } = friendshipDirections(ctx.db, me.id, targetId);
    if (outgoing?.status === 'accepted' || incoming?.status === 'accepted') {
      throw new ApiError(409, 'ALREADY_FRIENDS', 'You are already friends. Stop hoarding relationships.');
    }
    if (outgoing) throw new ApiError(409, 'REQUEST_PENDING', 'Friend request already sent. Patience, goblin.');
    const now = Date.now();
    if (incoming?.status === 'pending') {
      // They asked first: asking back auto-accepts, because emotional efficiency.
      ctx.db.run("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?", now, incoming.id);
      friendAchievements(ctx.db, ctx.hub, me.id, targetId);
      notify(ctx.db, ctx.hub, {
        userId: targetId,
        type: 'friend_request',
        title: 'Friend request accepted',
        body: `${me.display_name || me.username} accepted your friend request. Touch grass together soon.`,
        actorId: me.id,
      });
    } else {
      if (incoming) ctx.db.run('DELETE FROM friendships WHERE id = ?', incoming.id);
      ctx.db.run(
        `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
        newId('f'), me.id, targetId, now, now,
      );
      notify(ctx.db, ctx.hub, {
        userId: targetId,
        type: 'friend_request',
        title: 'New friend request',
        body: `${me.display_name || me.username} wants to be friends. Act surprised.`,
        actorId: me.id,
      });
    }
    broadcastFriendUpdate(ctx.db, ctx.hub, me.id, targetId);
    return json({ friend: friendFor(ctx.db, me.id, target) });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.post('/api/friends/:userId/accept', (ctx) => {
    const me = ctx.user!;
    const targetId = ctx.params.userId!;
    const incoming = ctx.db.get<FriendshipRow>(
      "SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
      targetId, me.id,
    );
    if (!incoming) {
      throw new ApiError(404, 'NO_REQUEST', 'No pending friend request from that user. Imaginary friends are free, though.');
    }
    assertNotBlocked(ctx, targetId);
    const target = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', targetId);
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'That requester has been raptured. The request is cursed.');
    ctx.db.run("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?", Date.now(), incoming.id);
    friendAchievements(ctx.db, ctx.hub, me.id, targetId);
    notify(ctx.db, ctx.hub, {
      userId: targetId,
      type: 'friend_request',
      title: 'Friend request accepted',
      body: `${me.display_name || me.username} accepted your friend request. The slop alliance grows.`,
      actorId: me.id,
    });
    broadcastFriendUpdate(ctx.db, ctx.hub, me.id, targetId);
    return json({ friend: friendFor(ctx.db, me.id, target) });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.post('/api/friends/:userId/decline', (ctx) => {
    const me = ctx.user!;
    const targetId = ctx.params.userId!;
    const incoming = ctx.db.get<FriendshipRow>(
      "SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'",
      targetId, me.id,
    );
    if (!incoming) throw new ApiError(404, 'NO_REQUEST', 'Nothing to decline. You cannot reject a void.');
    ctx.db.run('DELETE FROM friendships WHERE id = ?', incoming.id);
    broadcastFriendUpdate(ctx.db, ctx.hub, me.id, targetId);
    return json({ ok: true });
  });

  router.delete('/api/friends/:userId', (ctx) => {
    const me = ctx.user!;
    const targetId = ctx.params.userId!;
    const friendship = friendshipBetween(ctx.db, me.id, targetId);
    if (!friendship) throw new ApiError(404, 'NOT_FRIENDS', 'Nothing to remove. That friendship was a hallucination.');
    ctx.db.run('DELETE FROM friendships WHERE id = ?', friendship.id);
    broadcastFriendUpdate(ctx.db, ctx.hub, me.id, targetId);
    return json({ ok: true });
  });

  router.post('/api/users/:id/block', (ctx) => {
    const me = ctx.user!;
    const targetId = ctx.params.id!;
    if (targetId === me.id) {
      throw new ValidationError({ userId: 'Blocking yourself is redundant. You are already stuck with you.' });
    }
    const target = getEnabledUser(ctx, targetId);
    ctx.db.run(
      'INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT(blocker_id, blocked_id) DO NOTHING',
      me.id, targetId, Date.now(),
    );
    ctx.db.run(
      'DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
      me.id, targetId, targetId, me.id,
    );
    broadcastFriendUpdate(ctx.db, ctx.hub, me.id, targetId);
    return json({ friend: friendFor(ctx.db, me.id, target), blocked: true });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.delete('/api/users/:id/block', (ctx) => {
    const me = ctx.user!;
    const targetId = ctx.params.id!;
    ctx.db.run('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', me.id, targetId);
    broadcastFriendUpdate(ctx.db, ctx.hub, me.id, targetId);
    return json({ ok: true, blocked: false });
  });
  router.get('/api/notifications', (ctx) => {
    const me = ctx.user!;
    const params = ctx.url.searchParams;
    const unreadOnly = bool(params.get('unread'));
    const rawLimit = params.get('limit');
    let limit = 50;
    if (rawLimit !== null) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed < 1) throw new ValidationError({ limit: 'limit must be 1-100.' });
      limit = Math.min(100, Math.floor(parsed));
    }
    const before = params.get('before')?.trim() ?? '';
    const rows = listNotifications(ctx.db, me.id, {
      unreadOnly,
      beforeId: before && !/^\d+$/.test(before) ? before : undefined,
      beforeCreatedAt: /^\d+$/.test(before) ? Number(before) : undefined,
      limit,
    });
    return json({
      notifications: rows.map((row) => toNotification(ctx.db, row)),
      unreadCount: unreadNotificationCount(ctx.db, me.id),
    });
  });

  router.post('/api/notifications/read', async (ctx) => {
    const me = ctx.user!;
    const body = await readJson(ctx.req);
    if (bool(body.all)) {
      const unreadCount = markNotificationsRead(ctx.db, me.id);
      ctx.hub.send(me.id, 'READ_STATE_UPDATE', { scope: 'notifications', unreadCount });
      return json({ unreadCount, readIds: null });
    }
    if (!Array.isArray(body.ids)) {
      throw new ValidationError({ ids: 'Provide notification ids or set all=true.' });
    }
    if (body.ids.length > 200) throw new ValidationError({ ids: 'Too many ids at once (max 200).' });
    const ids = [...new Set(body.ids.map((value) => String(value ?? '').trim()).filter(Boolean))];
    if (!ids.length) throw new ValidationError({ ids: 'Provide notification ids or set all=true.' });
    const unreadCount = markNotificationsRead(ctx.db, me.id, ids);
    ctx.hub.send(me.id, 'READ_STATE_UPDATE', { scope: 'notifications', unreadCount });
    return json({ unreadCount, readIds: ids });
  });

  router.delete('/api/notifications/all', (ctx) => {
    const me = ctx.user!;
    const result = ctx.db.run('DELETE FROM notifications WHERE user_id = ?', me.id);
    return json({ ok: true, deleted: result.changes });
  });

  router.delete('/api/notifications/:id', (ctx) => {
    const result = ctx.db.run(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?', ctx.params.id!, ctx.user!.id,
    );
    if (!result.changes) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'That notification never existed, or was already yeeted.');
    return json({ ok: true });
  });
}
