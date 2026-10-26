import { useEffect, useState } from 'preact/hooks';
import type { Channel } from '../../shared/types';
import { useApp, store } from '../lib/use-store';
import { voice } from '../lib/voice';
import { api, errorMessage } from '../lib/api';
import { Icon } from './Icons';
import { Avatar, EmptyState } from './Avatar';

export function VoiceRoom({ channel }: { channel: Channel }) {
  const state = useApp();
  const joined = state.voice.channelId === channel.id;
  const [preview, setPreview] = useState<any[]>([]);
  const [soundOpen, setSoundOpen] = useState(false);
  const bundle = channel.serverId ? state.servers[channel.serverId] : null;
  const sounds = bundle?.sounds ?? [];
  useEffect(() => {
    if (joined) return;
    let alive = true;
    const load = async () => { try { const res = await api.get<any>(`/api/channels/${channel.id}/voice`); if (alive) setPreview(res.participants ?? []); } catch { /* ignore */ } };
    void load();
    const timer = setInterval(load, 8000);
    return () => { alive = false; clearInterval(timer); };
  }, [channel.id, joined]);
  const participants = joined ? state.voice.participants : preview.map((p: any) => ({ userId: p.userId, user: p.user, muted: p.muted, deafened: p.deafened, speaking: p.speaking }));
  const join = () => voice.join(channel.id);
  const play = async (soundId: string) => {
    try { await api.post(`/api/channels/${channel.id}/soundboard/${soundId}/play`); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  return <div style={{ flex: 1, overflowY: 'auto', padding: '30px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
    <div class="home-hero" style={{ margin: 0, alignItems: 'center', background: 'radial-gradient(circle at 20% 20%, rgba(87,217,138,.13), transparent 60%), var(--bg-raised)' }}>
      <div class="intro-icon" style={{ color: 'var(--success)' }}><Icon name="volume" size={30} /></div>
      <div class="grow">
        <h1 style={{ fontSize: 26 }}>{channel.name}</h1>
        <p>{channel.topic || 'A voice channel. Say words with your mouth.'} {participants.length ? `${participants.length} goblin${participants.length === 1 ? '' : 's'} inside.` : 'Currently empty and echoing.'}</p>
      </div>
      {joined ? <button class="btn btn-danger" onClick={() => voice.leave()}><Icon name="phone" size={16} /> Leave</button> : <button class="btn btn-primary btn-lg" disabled={state.voice.connecting} onClick={join}><Icon name="volume" size={17} /> {state.voice.connecting ? 'Connecting…' : 'Join voice'}</button>}
    </div>
    <div class="voice-stage">
      {participants.length ? <div class="voice-grid">{participants.map((p: any) => {
        const u = p.user ?? { id: p.userId, displayName: 'Goblin', avatar: null };
        return <div class={`voice-tile ${p.speaking ? 'speaking' : ''} ${p.muted ? 'muted' : ''}`} key={p.userId}>
          <Avatar user={u} size={72} status={false} />
          <div class="vt-name">{u.displayName}{p.userId === state.user?.id ? ' (you)' : ''}</div>
          <div class="vt-icons">
            {p.muted ? <span title="Muted"><Icon name="micOff" size={14} /></span> : null}
            {p.deafened ? <span title="Deafened"><Icon name="headphoneOff" size={14} /></span> : null}
            {p.speaking ? <span class="badge accent" style={{ fontSize: 9 }}>speaking</span> : null}
          </div>
        </div>;
      })}</div> : <EmptyState emoji="🦗" title="Nobody is here">The silence is deafening. Join and make it weird.</EmptyState>}
    </div>
    {state.voice.error ? <div class="auth-error">{state.voice.error}</div> : null}
    {joined ? <div class="voice-controls">
      <button class={`btn ${state.voice.muted ? 'btn-danger' : ''}`} onClick={() => voice.toggleMute()}><Icon name={state.voice.muted ? 'micOff' : 'mic'} size={16} /> {state.voice.muted ? 'Unmute' : 'Mute'}</button>
      <button class={`btn ${state.voice.deafened ? 'btn-danger' : ''}`} onClick={() => voice.toggleDeafen()}><Icon name={state.voice.deafened ? 'headphoneOff' : 'headphones'} size={16} /> {state.voice.deafened ? 'Undeafen' : 'Deafen'}</button>
      <button class="btn" onClick={() => setSoundOpen(!soundOpen)}><Icon name="sparkles" size={16} /> Soundboard</button>
      <span class="badge">{state.voice.connecting ? 'connecting…' : 'connected via WebRTC mesh'}</span>
    </div> : null}
    {joined && soundOpen ? <div class="panel"><div class="panel-head"><h3><Icon name="sparkles" size={16} /> Soundboard</h3><span class="badge">{sounds.length} sounds</span></div><div class="panel-body"><div class="soundboard-grid">
      {sounds.map((s) => <button class="sound-btn" key={s.id} onClick={() => play(s.id)}><span style={{ fontSize: 22 }}>{s.emoji}</span><span>{s.name}</span></button>)}
      {!sounds.length ? <p class="muted">No sounds uploaded. Fill the void in server settings → Soundboard.</p> : null}
    </div></div></div> : null}
    {!joined && participants.length ? <div class="panel"><div class="panel-head"><h3>Lurkers currently in call</h3></div><div class="panel-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{participants.map((p: any) => <div class="row gap-8" key={p.userId}><Avatar user={p.user ?? { id: p.userId, displayName: 'Goblin' }} size={28} /><span style={{ fontSize: 13 }}>{p.user?.displayName ?? 'Goblin'}</span>{p.muted ? <Icon name="micOff" size={13} class="text-danger" /> : null}</div>)}</div></div> : null}
    <div class="card flat" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
      <strong style={{ color: 'var(--text)' }}>Privacy note:</strong> Voice is peer-to-peer WebRTC. Audio never touches the server; it only relays signaling blobs. No TURN/STUN is configured by default, so this works best on a LAN or directly reachable host. Set <span class="mono">SLOP_STUN_URLS</span> if you need NAT traversal.
    </div>
  </div>;
}
