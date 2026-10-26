import type { ServerWebSocket } from 'bun';
import type { Ctx } from '../http';
import type { WsData } from '../realtime/hub';
import { instanceInfo } from '../services/instance';
import { unreadCounts } from '../repos/servers';
import { toUser } from '../repos/users';
import { computeChannelPermissions } from '../services/permissions';
import { Perm } from '../../shared/permissions';

export async function handleUpgrade(ctx: Ctx, server: { upgrade(req: Request, opts: { data: WsData }): boolean }): Promise<Response | undefined> {
  if (ctx.req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }
  if (!ctx.user) return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const data: WsData = {
    connId: `${ctx.user.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    userId: ctx.user.id,
    username: ctx.user.username,
    sessionId: ctx.session!.id,
    alive: true,
    ip: ctx.ip,
  };
  const ok = server.upgrade(ctx.req, { data });
  if (!ok) return new Response('Upgrade failed', { status: 500 });
  return undefined;
}

export const websocketHandlers = (runtime: { db: Ctx['db']; hub: Ctx['hub']; config: Ctx['config'] }) => ({
  open(ws: ServerWebSocket<WsData>) {
    const { db, hub } = runtime;
    hub.track(ws, 'online');
    const user = db.get<{ status: string }>('SELECT status FROM users WHERE id = ?', ws.data.userId);
    if (user && (user.status === 'offline' || !user.status)) {
      db.run("UPDATE users SET status = 'online', last_seen_at = ? WHERE id = ?", Date.now(), ws.data.userId);
    }
    const row = db.get('SELECT * FROM users WHERE id = ?', ws.data.userId) as never;
    const servers = db.all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ?', ws.data.userId).map((s) => s.server_id);
    const unread = unreadCounts(db, ws.data.userId);
    const info = instanceInfo(db, hub, runtime.config.registration, runtime.config.version);
    ws.send(JSON.stringify({ op: 'hello', d: { heartbeatInterval: 25_000 } }));
    ws.send(JSON.stringify({
      op: 'dispatch',
      t: 'READY',
      d: {
        user: toUser(row),
        sessionId: ws.data.sessionId,
        servers,
        unread,
        heartbeatInterval: 25_000,
        instance: { name: info.name, version: info.version, motd: info.motd, e2eeEnabled: info.e2eeEnabled },
      },
    }));
    const status = hub.visibleStatus(ws.data.userId);
    hub.broadcastPresence(ws.data.userId, status, db.get<{ custom_status: string | null }>('SELECT custom_status FROM users WHERE id = ?', ws.data.userId)?.custom_status ?? null);
  },
  message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
    const { db, hub } = runtime;
    hub.touch(ws.data.connId);
    let payload: { op?: string; d?: Record<string, unknown> };
    try {
      payload = JSON.parse(typeof message === 'string' ? message : message.toString());
    } catch { return; }
    if (payload.op === 'heartbeat') {
      ws.send(JSON.stringify({ op: 'pong', d: { at: Date.now() } }));
      return;
    }
    if (payload.op === 'typing') {
      const channelId = String(payload.d?.channelId ?? '');
      const channel = db.get<Parameters<typeof computeChannelPermissions>[2]>('SELECT * FROM channels WHERE id = ?', channelId);
      if (!channel) return;
      let allowed = false;
      try {
        if (channel.server_id) {
          const perms = computeChannelPermissions(db, ws.data.userId, channel);
          allowed = (perms & Perm.VIEW_CHANNEL) === Perm.VIEW_CHANNEL;
        } else {
          allowed = !!db.get('SELECT 1 FROM dm_members WHERE channel_id = ? AND user_id = ?', channelId, ws.data.userId);
        }
      } catch { allowed = false; }
      if (!allowed) return;
      const user = db.get('SELECT * FROM users WHERE id = ?', ws.data.userId) as never;
      hub.broadcastChannel(channelId, 'TYPING_START', {
        channelId,
        user: { id: ws.data.userId, displayName: (user as unknown as { display_name: string }).display_name, avatar: (user as unknown as { avatar: string | null }).avatar },
        at: Date.now(),
      }, ws.data.userId);
      return;
    }
    if (payload.op === 'voice_signal') {
      const channelId = String(payload.d?.channelId ?? '');
      const target = String(payload.d?.target ?? '');
      const kind = String(payload.d?.kind ?? 'ice');
      if (!channelId || !target || !['offer', 'answer', 'ice'].includes(kind)) return;
      if (db.get('SELECT 1 FROM channels WHERE id = ?', channelId)) hub.relayVoiceSignal(channelId, ws.data.userId, target, kind, payload.d?.payload);
      return;
    }
    if (payload.op === 'voice_state') {
      const channelId = String(payload.d?.channelId ?? '');
      if (hub.voiceChannelOf(ws.data.userId) !== channelId) return;
      hub.setVoiceState(channelId, ws.data.userId, {
        muted: payload.d?.muted === undefined ? undefined : !!payload.d.muted,
        deafened: payload.d?.deafened === undefined ? undefined : !!payload.d.deafened,
        speaking: payload.d?.speaking === undefined ? undefined : !!payload.d.speaking,
      });
      return;
    }
  },
  close(ws: ServerWebSocket<WsData>) {
    const { db, hub } = runtime;
    hub.untrack(ws.data.connId);
    if (!hub.hasConnections(ws.data.userId)) {
      db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', Date.now(), ws.data.userId);
      const custom = db.get<{ custom_status: string | null }>('SELECT custom_status FROM users WHERE id = ?', ws.data.userId)?.custom_status ?? null;
      hub.broadcastPresence(ws.data.userId, 'offline', custom);
    }
    logger?.info?.(`gateway closed ${ws.data.username}`);
  },
});

let logger: { info?: (s: string) => void } | undefined;
export function setGatewayLogger(l: { info?: (s: string) => void }) { logger = l; }
