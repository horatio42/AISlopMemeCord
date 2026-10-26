import type { ServerWebSocket } from 'bun';
import type { DatabaseWrapper } from '../db';
import type { Config } from '../config';
import { canViewChannel, type ChannelRow } from '../services/permissions';
import { toUser } from '../repos/users';
import type { GatewayEventName } from '../../shared/events';

export interface WsData {
  connId: string;
  userId: string;
  username: string;
  sessionId: string;
  alive: boolean;
  ip: string;
}

interface Conn {
  ws: ServerWebSocket<WsData>;
  userId: string;
  status: string;
  connectedAt: number;
  lastActivity: number;
}

interface VoiceParticipant {
  userId: string;
  channelId: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  joinedAt: number;
}

export class Hub {
  private conns = new Map<string, Conn>();
  private byUser = new Map<string, Set<string>>();
  private voice = new Map<string, Map<string, VoiceParticipant>>();
  private channelAudience = new Map<string, { ids: Set<string>; expires: number }>();
  constructor(private db: DatabaseWrapper, private config: Config) {}

  track(ws: ServerWebSocket<WsData>, status: string) {
    this.conns.set(ws.data.connId, { ws, userId: ws.data.userId, status, connectedAt: Date.now(), lastActivity: Date.now() });
    let set = this.byUser.get(ws.data.userId);
    if (!set) { set = new Set(); this.byUser.set(ws.data.userId, set); }
    set.add(ws.data.connId);
  }

  untrack(connId: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.conns.delete(connId);
    const set = this.byUser.get(conn.userId);
    set?.delete(connId);
    if (set && set.size === 0) this.byUser.delete(conn.userId);
    this.leaveVoice(conn.userId);
  }

  connectionCount() { return this.conns.size; }
  touch(connId: string) { const c = this.conns.get(connId); if (c) c.lastActivity = Date.now(); }
  hasConnections(userId: string): boolean { return (this.byUser.get(userId)?.size ?? 0) > 0; }
  sweep() {
    const now = Date.now();
    for (const [id, c] of this.conns) {
      if (now - c.lastActivity > 75_000) {
        try { c.ws.close(4000, 'heartbeat timeout'); } catch { /* already dead */ }
        this.untrack(id);
      }
    }
  }
  onlineCount(): number {
    const users = new Set<string>();
    for (const c of this.conns.values()) {
      const u = this.db.get<{ status: string }>('SELECT status FROM users WHERE id = ?', c.userId);
      if (u && u.status !== 'invisible' && u.status !== 'offline') users.add(c.userId);
    }
    return users.size;
  }
  isOnline(userId: string): boolean {
    if (!this.byUser.has(userId)) return false;
    const u = this.db.get<{ status: string }>('SELECT status FROM users WHERE id = ?', userId);
    return !!u && u.status !== 'invisible' && u.status !== 'offline';
  }
  visibleStatus(userId: string): string {
    if (!this.byUser.has(userId)) return 'offline';
    const u = this.db.get<{ status: string }>('SELECT status FROM users WHERE id = ?', userId);
    if (!u) return 'offline';
    if (u.status === 'invisible') return 'offline';
    return u.status;
  }

  send(userId: string, t: GatewayEventName | string, d: unknown) {
    const set = this.byUser.get(userId);
    if (!set) return;
    const payload = JSON.stringify({ op: 'dispatch', t, d });
    for (const id of set) {
      const c = this.conns.get(id);
      if (c) { try { c.ws.send(payload); } catch { /* dead */ } }
    }
  }
  sendToConn(connId: string, op: string, t: string | undefined, d: unknown) {
    const c = this.conns.get(connId);
    if (!c) return;
    try { c.ws.send(JSON.stringify({ op, t, d })); } catch { /* dead */ }
  }

  broadcastServer(serverId: string, t: GatewayEventName, d: unknown, excludeUserId?: string) {
    const members = this.db.all<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = ?', serverId);
    const sent = new Set<string>();
    for (const m of members) {
      if (m.user_id === excludeUserId || sent.has(m.user_id)) continue;
      sent.add(m.user_id);
      this.send(m.user_id, t, d);
    }
  }

  broadcastChannel(channelId: string, t: GatewayEventName, d: unknown, excludeUserId?: string) {
    for (const userId of this.channelViewers(channelId)) {
      if (userId !== excludeUserId) this.send(userId, t, d);
    }
  }

  channelViewers(channelId: string): Set<string> {
    const cached = this.channelAudience.get(channelId);
    if (cached && cached.expires > Date.now()) return cached.ids;
    const ids = new Set<string>();
    const channel = this.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channelId);
    if (!channel) return ids;
    if (channel.type === 'dm' || channel.type === 'group_dm') {
      for (const m of this.db.all<{ user_id: string }>('SELECT user_id FROM dm_members WHERE channel_id = ?', channelId)) {
        if (this.byUser.has(m.user_id)) ids.add(m.user_id);
      }
    } else if (channel.server_id) {
      for (const m of this.db.all<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = ?', channel.server_id)) {
        if (!this.byUser.has(m.user_id)) continue;
        if (channel.archived && channel.type === 'thread') continue;
        if (canViewChannel(this.db, m.user_id, channel)) ids.add(m.user_id);
      }
    }
    this.channelAudience.set(channelId, { ids, expires: Date.now() + 5000 });
    return ids;
  }

  invalidateChannel(channelId: string) { this.channelAudience.delete(channelId); }
  invalidateServer(serverId: string) {
    for (const [id, entry] of this.channelAudience) {
      if (id === serverId) entry.expires = 0;
    }
    this.channelAudience.clear();
  }

  broadcastPresence(userId: string, status: string, customStatus: string | null) {
    const servers = this.db.all<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = ?', userId);
    const payload = { userId, status, customStatus };
    for (const s of servers) this.broadcastServer(s.server_id, 'PRESENCE_UPDATE', payload, userId);
    // Friends who share a DM should also see presence; concise: send to DM peers.
    const dms = this.db.all<{ channel_id: string }>('SELECT channel_id FROM dm_members WHERE user_id = ?', userId);
    const notified = new Set<string>();
    for (const dm of dms) {
      for (const m of this.db.all<{ user_id: string }>('SELECT user_id FROM dm_members WHERE channel_id = ?', dm.channel_id)) {
        if (m.user_id !== userId && !notified.has(m.user_id)) { notified.add(m.user_id); this.send(m.user_id, 'PRESENCE_UPDATE', payload); }
      }
    }
  }

  // ---- Voice ----
  joinVoice(channelId: string, userId: string, state: { muted?: boolean; deafened?: boolean } = {}) {
    for (const [cid, participants] of this.voice) {
      if (participants.has(userId)) this.leaveVoiceFrom(cid, userId);
    }
    let participants = this.voice.get(channelId);
    if (!participants) { participants = new Map(); this.voice.set(channelId, participants); }
    participants.set(userId, { userId, channelId, muted: !!state.muted, deafened: !!state.deafened, speaking: false, joinedAt: Date.now() });
    const user = this.db.get('SELECT * FROM users WHERE id = ?', userId);
    this.broadcastChannel(channelId, 'VOICE_STATE', { channelId, userId, action: 'join', muted: !!state.muted, deafened: !!state.deafened, user: user ? toUser(user as never) : null });
  }
  leaveVoice(userId: string) {
    for (const [channelId, participants] of this.voice) {
      if (participants.has(userId)) this.leaveVoiceFrom(channelId, userId);
    }
  }
  private leaveVoiceFrom(channelId: string, userId: string) {
    const participants = this.voice.get(channelId);
    if (!participants?.has(userId)) return;
    participants.delete(userId);
    if (participants.size === 0) this.voice.delete(channelId);
    this.broadcastChannel(channelId, 'VOICE_STATE', { channelId, userId, action: 'leave' });
  }
  setVoiceState(channelId: string, userId: string, state: { muted?: boolean; deafened?: boolean; speaking?: boolean }) {
    const p = this.voice.get(channelId)?.get(userId);
    if (!p) return;
    if (state.muted !== undefined) p.muted = state.muted;
    if (state.deafened !== undefined) p.deafened = state.deafened;
    if (state.speaking !== undefined) p.speaking = state.speaking;
    const event = state.speaking !== undefined && state.muted === undefined && state.deafened === undefined ? 'VOICE_SPEAKING' : 'VOICE_STATE';
    this.broadcastChannel(channelId, event, { channelId, userId, action: 'state', muted: p.muted, deafened: p.deafened, speaking: p.speaking });
  }
  voiceParticipants(channelId: string): VoiceParticipant[] {
    return [...(this.voice.get(channelId)?.values() ?? [])];
  }
  voiceChannelOf(userId: string): string | null {
    for (const [cid, participants] of this.voice) if (participants.has(userId)) return cid;
    return null;
  }
  relayVoiceSignal(channelId: string, fromUserId: string, targetUserId: string, kind: string, payload: unknown) {
    if (!this.voice.get(channelId)?.has(fromUserId) || !this.voice.get(channelId)?.has(targetUserId)) return;
    this.send(targetUserId, 'VOICE_SIGNAL', { channelId, from: fromUserId, target: targetUserId, kind, payload });
  }
  relaySound(channelId: string, userId: string, soundId: string, name: string, url: string) {
    this.broadcastChannel(channelId, 'VOICE_SOUND', { channelId, userId, soundId, name, url });
  }
}
