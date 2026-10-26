import { ApiError, json, readJson, type Ctx, type Router } from '../http';
import { Perm } from '../../shared/permissions';
import { assertChannelPermission, channelForUser } from '../services/permissions';
import { assertServerPermission } from '../services/permissions';
import { toUser } from '../repos/users';
import { grantAchievement } from '../services/achievements';
import { bool } from '../util/validate';

function voiceChannel(ctx: Ctx) {
  const channel = channelForUser(ctx, ctx.params.id!);
  if (channel.type !== 'voice') throw new ApiError(400, 'NOT_VOICE_CHANNEL', 'That channel is not a voice channel. The audacity.');
  if (channel.locked) throw new ApiError(403, 'CHANNEL_LOCKED', 'This voice channel is locked. The adults are talking.');
  assertChannelPermission(ctx, channel, Perm.CONNECT);
  return channel;
}

function participantDto(db: Ctx['db'], hub: Ctx['hub'], channelId: string) {
  return hub.voiceParticipants(channelId).map((p) => {
    const row = db.get('SELECT * FROM users WHERE id = ?', p.userId);
    return { userId: p.userId, user: row ? toUser(row as never) : null, muted: p.muted, deafened: p.deafened, speaking: p.speaking, joinedAt: p.joinedAt };
  });
}

export function register(router: Router) {
  router.get('/api/channels/:id/voice', (ctx) => {
    const channel = voiceChannel(ctx);
    return json({ channelId: channel.id, participants: participantDto(ctx.db, ctx.hub, channel.id), iceServers: iceServers(), maxParticipants: 12 });
  });

  router.post('/api/channels/:id/voice/join', async (ctx) => {
    const channel = voiceChannel(ctx);
    assertChannelPermission(ctx, channel, Perm.SPEAK);
    const body: Record<string, unknown> = await readJson(ctx.req).catch(() => ({}));
    if (ctx.hub.voiceParticipants(channel.id).length >= 12) throw new ApiError(409, 'VOICE_FULL', 'This voice channel is full. Start your own sad little call.');
    ctx.hub.joinVoice(channel.id, ctx.user!.id, { muted: bool(body.muted), deafened: bool(body.deafened) });
    grantAchievement(ctx.db, ctx.hub, ctx.user!.id, 'voice');
    return json({ channelId: channel.id, participants: participantDto(ctx.db, ctx.hub, channel.id), iceServers: iceServers(), maxParticipants: 12 });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.post('/api/channels/:id/voice/leave', (ctx) => {
    const channel = channelForUser(ctx, ctx.params.id!);
    ctx.hub.leaveVoice(ctx.user!.id);
    return json({ ok: true, channelId: channel.id });
  });

  router.patch('/api/channels/:id/voice/state', async (ctx) => {
    const channel = voiceChannel(ctx);
    if (ctx.hub.voiceChannelOf(ctx.user!.id) !== channel.id) throw new ApiError(409, 'NOT_IN_VOICE', 'Join the voice channel first, goblin.');
    const body = await readJson(ctx.req);
    const state: { muted?: boolean; deafened?: boolean; speaking?: boolean } = {};
    if (body.muted !== undefined) state.muted = bool(body.muted);
    if (body.deafened !== undefined) state.deafened = bool(body.deafened);
    if (body.speaking !== undefined) {
      assertChannelPermission(ctx, channel, Perm.SPEAK);
      state.speaking = bool(body.speaking);
    }
    ctx.hub.setVoiceState(channel.id, ctx.user!.id, state);
    return json({ ok: true });
  });

  router.get('/api/channels/:id/soundboard', (ctx) => {
    const channel = voiceChannel(ctx);
    assertChannelPermission(ctx, channel, Perm.USE_SOUNDBOARD);
    const sounds = ctx.db.all<{ id: string; name: string; path: string; emoji: string }>(
      'SELECT id, name, path, emoji FROM sounds WHERE server_id IS NULL OR server_id = ? ORDER BY name ASC', channel.server_id,
    ).map((s) => ({ id: s.id, name: s.name, url: s.path.startsWith('/') ? s.path : `/api/media/uploads/${s.path}`, emoji: s.emoji, serverId: channel.server_id }));
    return json({ sounds });
  });

  router.post('/api/channels/:id/soundboard/:soundId/play', (ctx) => {
    const channel = voiceChannel(ctx);
    assertChannelPermission(ctx, channel, Perm.USE_SOUNDBOARD);
    if (ctx.hub.voiceChannelOf(ctx.user!.id) !== channel.id) throw new ApiError(409, 'NOT_IN_VOICE', 'Join voice before deploying the airhorn.');
    const sound = ctx.db.get<{ id: string; name: string; path: string }>(
      'SELECT id, name, path FROM sounds WHERE id = ? AND (server_id IS NULL OR server_id = ?)', ctx.params.soundId, channel.server_id,
    );
    if (!sound) throw new ApiError(404, 'SOUND_NOT_FOUND', 'That sound does not exist in this server.');
    const url = sound.path.startsWith('/') ? sound.path : `/api/media/uploads/${sound.path}`;
    ctx.hub.relaySound(channel.id, ctx.user!.id, sound.id, sound.name, url);
    return json({ ok: true, soundId: sound.id, url });
  }, { rateLimit: { windowMs: 10_000, max: 8 } });

  router.get('/api/sounds/global', (ctx) => {
    const sounds = ctx.db.all<{ id: string; name: string; path: string; emoji: string }>('SELECT id, name, path, emoji FROM sounds WHERE server_id IS NULL ORDER BY name').map((s) => ({ id: s.id, name: s.name, url: s.path.startsWith('/') ? s.path : `/api/media/uploads/${s.path}`, emoji: s.emoji }));
    return json({ sounds });
  });

  // Server-level voice overview for member/channel badges.
  router.get('/api/servers/:id/voice-states', (ctx) => {
    assertServerPermission(ctx, ctx.params.id!, Perm.VIEW_CHANNEL);
    const channels = ctx.db.all<{ id: string; name: string }>("SELECT id, name FROM channels WHERE server_id = ? AND type = 'voice'", ctx.params.id!);
    return json({ channels: channels.map((c) => ({ channelId: c.id, name: c.name, participants: participantDto(ctx.db, ctx.hub, c.id) })) });
  });
}

function iceServers(): RTCIceServer[] {
  const raw = process.env.SLOP_STUN_URLS?.trim();
  if (!raw) return [];
  return [{ urls: raw.split(',').map((s) => s.trim()).filter(Boolean) }];
}
