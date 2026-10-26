type Listener = (t: string, d: any) => void;
type StatusListener = (status: GatewayStatus) => void;
export type GatewayStatus = 'disconnected' | 'connecting' | 'connected';

class GatewayClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private heartbeat: number | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private stopped = true;
  status: GatewayStatus = 'disconnected';
  sessionId = '';
  userId = '';

  connect() {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.heartbeat !== null) { clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.ws) { try { this.ws.close(1000, 'bye'); } catch { /* ignore */ } this.ws = null; }
    this.setStatus('disconnected');
  }

  private setStatus(s: GatewayStatus) { this.status = s; for (const l of this.statusListeners) l(s); }
  private open() {
    if (this.stopped) return;
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/gateway`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.attempts = 0;
      this.setStatus('connected');
      this.startHeartbeat();
    });
    ws.addEventListener('message', (ev) => {
      let payload: any;
      try { payload = JSON.parse(String(ev.data)); } catch { return; }
      if (payload.op === 'hello') { this.startHeartbeat(payload.d?.heartbeatInterval); return; }
      if (payload.op === 'pong') return;
      if (payload.op === 'dispatch') {
        const t = String(payload.t ?? '');
        if (t === 'READY') { this.sessionId = payload.d?.sessionId ?? ''; this.userId = payload.d?.user?.id ?? ''; }
        for (const l of this.listeners) { try { l(t, payload.d); } catch (e) { console.error('gateway handler error', e); } }
      }
    });
    ws.addEventListener('close', (ev) => {
      if (this.heartbeat !== null) { clearInterval(this.heartbeat); this.heartbeat = null; }
      this.ws = null;
      this.setStatus('disconnected');
      if (!this.stopped && ev.code !== 1000) this.scheduleReconnect();
      else if (!this.stopped && ev.code === 4000) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => { /* close handles retries */ });
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.attempts++;
    const delay = Math.min(30_000, 700 * 2 ** Math.min(this.attempts, 5)) + Math.random() * 500;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private startHeartbeat(interval = 25_000) {
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = window.setInterval(() => this.send('heartbeat', {}), interval);
    this.send('heartbeat', {});
  }

  send(op: string, d: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }
  type(channelId: string) { this.send('typing', { channelId }); }
  voiceSignal(channelId: string, target: string, kind: 'offer' | 'answer' | 'ice', payload: unknown) {
    this.send('voice_signal', { channelId, target, kind, payload });
  }
  voiceState(channelId: string, state: { muted?: boolean; deafened?: boolean; speaking?: boolean }) {
    this.send('voice_state', { channelId, ...state });
  }
  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onStatus(fn: StatusListener): () => void { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }
}

export const gateway = new GatewayClient();
