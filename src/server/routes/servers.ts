import type { Router } from '../http';
import { json, readJson } from '../http';
import { Perm } from '../../shared/permissions';
import { assertServerPermission } from '../services/permissions';
import { channelsForServer, toChannel, toServer, type ServerRow } from '../repos/servers';
import {
  assertInviteManage, acceptInvite, createInvite, deleteInvite, discoverServers, invitePreview, inviteRows,
  joinDiscovery, toInviteDto,
} from '../services/servers_invites';
import { channelDto, emojiDtos, requireServer, soundDtos, stickerDtos } from '../services/servers_common';
import {
  createChannel, deleteChannel, replaceChannelOverrides, setChannelPositions, updateChannel,
} from '../services/servers_channels';
import { createEmoji, createSound, createSticker, deleteEmoji, deleteSound, deleteSticker } from '../services/servers_assets';
import { createEvent, createRule, deleteEvent, deleteRule, listEvents, listRules, rsvpEvent, updateEvent } from '../services/servers_events';
import { createWebhook, deleteWebhook, executeWebhook, listWebhooks } from '../services/servers_webhooks';
import {
  createServer, deleteServer, leaveServer, serverDetail, transferServer, updateServer,
} from '../services/servers_lifecycle';

export function register(router: Router) {
  router.get('/api/servers', (ctx) => {
    const rows = ctx.db.all<ServerRow>(
      `SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id
       WHERE m.user_id = ? ORDER BY m.joined_at ASC, s.created_at ASC`,
      ctx.user!.id,
    );
    return json({ servers: rows.map((row) => toServer(row)) });
  });

  router.post('/api/servers', async (ctx) => {
    const body = await readJson(ctx.req);
    const result = createServer(ctx, body);
    return json({
      server: { ...toServer(result.server), roles: result.roles },
      channels: result.channels.map((row) => toChannel(row)),
      roles: result.roles,
      member: result.member,
    });
  }, { rateLimit: { windowMs: 60_000, max: 10 } });

  router.get('/api/servers/:id', (ctx) => json(serverDetail(ctx, ctx.params.id!)));

  router.patch('/api/servers/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ server: updateServer(ctx, ctx.params.id!, body) });
  });

  router.delete('/api/servers/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    deleteServer(ctx, ctx.params.id!, body);
    return json({ ok: true });
  });

  router.post('/api/servers/:id/leave', (ctx) => {
    leaveServer(ctx, ctx.params.id!);
    return json({ ok: true });
  });

  router.post('/api/servers/:id/transfer', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ server: transferServer(ctx, ctx.params.id!, body) });
  });

  // ---- Channels ----
  router.post('/api/servers/:id/channels', async (ctx) => {
    const body = await readJson(ctx.req);
    const serverId = ctx.params.id!;
    assertServerPermission(ctx, serverId, Perm.MANAGE_CHANNELS);
    const channel = createChannel(ctx, serverId, body);
    return json({ channel: channelDto(ctx.db, channel) }, 201);
  });

  router.patch('/api/channels/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    const channel = updateChannel(ctx, ctx.params.id!, body);
    return json({ channel: channelDto(ctx.db, channel) });
  });

  router.delete('/api/channels/:id', (ctx) => {
    const channel = deleteChannel(ctx, ctx.params.id!);
    return json({ ok: true, channelId: channel.id });
  });

  router.patch('/api/servers/:id/channels/positions', async (ctx) => {
    const serverId = ctx.params.id!;
    const body = await readJson(ctx.req);
    assertServerPermission(ctx, serverId, Perm.MANAGE_CHANNELS);
    setChannelPositions(ctx, serverId, body.positions);
    return json({ channels: channelsForServer(ctx.db, serverId).map((row) => toChannel(row)) });
  });

  router.put('/api/channels/:id/overrides', async (ctx) => {
    const body = await readJson(ctx.req);
    const overrides = replaceChannelOverrides(ctx, ctx.params.id!, body.overrides);
    return json({ overrides });
  });

  // ---- Invites ----
  router.post('/api/channels/:id/invites', async (ctx) => {
    const body = await readJson(ctx.req);
    const invite = createInvite(ctx, ctx.params.id!, body);
    return json({ invite: toInviteDto(ctx, invite) }, 201);
  }, { rateLimit: { windowMs: 60_000, max: 20 } });

  router.get('/api/servers/:id/invites', (ctx) => {
    const serverId = ctx.params.id!;
    assertInviteManage(ctx, serverId);
    return json({ invites: inviteRows(ctx, serverId).map((row) => toInviteDto(ctx, row)) });
  });

  router.delete('/api/invites/:code', (ctx) => {
    deleteInvite(ctx, ctx.params.code!);
    return json({ ok: true });
  });

  router.get('/api/invites/:code', (ctx) => json(invitePreview(ctx, ctx.params.code!)), { auth: false });

  router.post('/api/invites/:code', async (ctx) => {
    const result = acceptInvite(ctx, ctx.params.code!);
    return json(result);
  });

  // ---- Discovery ----
  router.get('/api/discover', (ctx) => json({ servers: discoverServers(ctx) }), { auth: false });

  router.post('/api/discover/:id/join', (ctx) => json(joinDiscovery(ctx, ctx.params.id!)));

  // ---- Emojis ----
  router.post('/api/servers/:id/emojis', async (ctx) => {
    const serverId = ctx.params.id!;
    assertServerPermission(ctx, serverId, Perm.MANAGE_EMOJIS);
    const body = await readJson(ctx.req);
    return json({ emoji: createEmoji(ctx, serverId, body) }, 201);
  });

  router.get('/api/servers/:id/emojis', (ctx) => {
    const server = requireServer(ctx, ctx.params.id!);
    return json({ emojis: emojiDtos(ctx.db, server.id) });
  });

  router.delete('/api/emojis/:id', (ctx) => {
    deleteEmoji(ctx, ctx.params.id!);
    return json({ ok: true });
  });

  // ---- Stickers ----
  router.post('/api/servers/:id/stickers', async (ctx) => {
    const serverId = ctx.params.id!;
    assertServerPermission(ctx, serverId, Perm.MANAGE_EMOJIS);
    const body = await readJson(ctx.req);
    return json({ sticker: createSticker(ctx, serverId, body) }, 201);
  });

  router.get('/api/servers/:id/stickers', (ctx) => {
    const server = requireServer(ctx, ctx.params.id!);
    return json({ stickers: stickerDtos(ctx.db, server.id) });
  });

  router.delete('/api/stickers/:id', (ctx) => {
    deleteSticker(ctx, ctx.params.id!);
    return json({ ok: true });
  });

  // ---- Sounds ----
  router.post('/api/servers/:id/sounds', async (ctx) => {
    const serverId = ctx.params.id!;
    assertServerPermission(ctx, serverId, Perm.MANAGE_EMOJIS);
    const body = await readJson(ctx.req);
    return json({ sound: createSound(ctx, serverId, body) }, 201);
  });

  router.get('/api/servers/:id/sounds', (ctx) => {
    const server = requireServer(ctx, ctx.params.id!);
    return json({ sounds: soundDtos(ctx.db, server.id) });
  });

  router.delete('/api/sounds/:id', (ctx) => {
    deleteSound(ctx, ctx.params.id!);
    return json({ ok: true });
  });

  // ---- Events ----
  router.post('/api/servers/:id/events', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ event: createEvent(ctx, ctx.params.id!, body) }, 201);
  });

  router.get('/api/servers/:id/events', (ctx) => json({ events: listEvents(ctx, ctx.params.id!) }));

  router.patch('/api/events/:id', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ event: updateEvent(ctx, ctx.params.id!, body) });
  });

  router.delete('/api/events/:id', (ctx) => {
    deleteEvent(ctx, ctx.params.id!);
    return json({ ok: true });
  });

  router.post('/api/events/:id/rsvp', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ event: rsvpEvent(ctx, ctx.params.id!, body) });
  });

  // ---- Webhooks ----
  router.post('/api/servers/:id/webhooks', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ webhook: createWebhook(ctx, ctx.params.id!, body) }, 201);
  });

  router.get('/api/servers/:id/webhooks', (ctx) => json({ webhooks: listWebhooks(ctx, ctx.params.id!) }));

  router.delete('/api/webhooks/:id', (ctx) => {
    deleteWebhook(ctx, ctx.params.id!);
    return json({ ok: true });
  });

  router.post('/api/webhooks/:id/:token', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ message: executeWebhook(ctx, ctx.params.id!, ctx.params.token!, body) });
  }, { auth: false, csrf: false, rateLimit: { windowMs: 60_000, max: 30 } });

  // ---- Server rules ----
  router.get('/api/servers/:id/rules', (ctx) => json({ rules: listRules(ctx, ctx.params.id!) }));

  router.post('/api/servers/:id/rules', async (ctx) => {
    const body = await readJson(ctx.req);
    return json({ rule: createRule(ctx, ctx.params.id!, body) }, 201);
  });

  router.delete('/api/rules/:id', (ctx) => {
    deleteRule(ctx, ctx.params.id!);
    return json({ ok: true });
  });
}
