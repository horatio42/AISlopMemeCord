import { gateway } from './gateway';
import { store, useApp } from './use-store';
import { api, errorMessage } from './api';

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  audio: HTMLAudioElement | null;
  pendingIce: RTCIceCandidateInit[];
  polite: boolean;
}

class VoiceManager {
  private peers = new Map<string, Peer>();
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private speakTimer: number | null = null;
  private speaking = false;
  private attached = false;
  private iceServers: RTCIceServer[] = [];
  private channelId: string | null = null;
  private joining = false;

  attach() {
    if (this.attached) return;
    this.attached = true;
    gateway.on((t, d) => {
      if (!this.channelId) return;
      if (t === 'VOICE_SIGNAL' && d?.channelId === this.channelId && d.target === store.state.user?.id) void this.handleSignal(d);
      if (t === 'VOICE_STATE' && d?.channelId === this.channelId && d.userId !== store.state.user?.id) {
        if (d.action === 'join') {
          // The new participant initiates offers to existing peers.
          store.toast(`${d.user?.displayName ?? 'Someone'} joined voice.`, 'info', '🎙️');
        }
        if (d.action === 'leave') { this.closePeer(d.userId); }
      }
    });
  }

  async join(channelId: string) {
    if (this.joining) return;
    this.attach();
    if (this.channelId === channelId) return;
    if (this.channelId) await this.leave();
    this.joining = true;
    store.updateVoice({ channelId, connecting: true, error: null, participants: [] });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.localStream = stream;
      const res = await api.post<any>(`/api/channels/${channelId}/voice/join`, { muted: store.state.voice.muted, deafened: store.state.voice.deafened });
      this.channelId = channelId;
      this.iceServers = res.iceServers ?? [];
      const participants = (res.participants ?? []).filter((p: any) => p.userId !== store.state.user?.id);
      store.updateVoice({ channelId, connecting: false, participants: (res.participants ?? []).map(normalizeParticipant) });
      for (const p of participants) await this.createOffer(p.userId);
      this.startSpeakingDetection();
      store.toast('Voice connected. Your mic is live. Good luck.', 'success', '🎧');
    } catch (e: any) {
      const message = e?.name === 'NotAllowedError' ? 'Microphone permission denied. The slop goblin cannot hear you.' : errorMessage(e);
      store.updateVoice({ channelId: null, connecting: false, error: message, participants: [] });
      store.toast(message, 'error', '🎤');
      this.cleanupMedia();
      this.channelId = null;
    } finally { this.joining = false; }
  }

  async leave() {
    const channelId = this.channelId;
    if (!channelId) return;
    this.channelId = null;
    this.stopSpeakingDetection();
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.cleanupMedia();
    store.updateVoice({ channelId: null, participants: [], connecting: false, error: null });
    try { await api.post(`/api/channels/${channelId}/voice/leave`); } catch { /* connection may already be gone */ }
    store.toast('Left voice. Silence restored.', 'info', '🔇');
  }

  toggleMute(): boolean {
    const muted = !store.state.voice.muted;
    store.updateVoice({ muted });
    if (this.localStream) for (const track of this.localStream.getAudioTracks()) track.enabled = !muted;
    if (this.channelId) gateway.voiceState(this.channelId, { muted });
    return muted;
  }
  toggleDeafen(): boolean {
    const deafened = !store.state.voice.deafened;
    const muted = deafened ? true : store.state.voice.muted;
    store.updateVoice({ deafened, muted });
    if (this.localStream) for (const track of this.localStream.getAudioTracks()) track.enabled = !muted;
    for (const peer of this.peers.values()) if (peer.audio) peer.audio.muted = deafened;
    if (this.channelId) gateway.voiceState(this.channelId, { deafened, muted });
    return deafened;
  }

  private async createPeer(remoteId: string): Promise<Peer> {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, stream: null, audio: null, pendingIce: [], polite: true };
    if (this.localStream) for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => { if (e.candidate && this.channelId) gateway.voiceSignal(this.channelId, remoteId, 'ice', e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      peer.stream = stream;
      if (!peer.audio) { peer.audio = new Audio(); peer.audio.autoplay = true; peer.audio.muted = store.state.voice.deafened; }
      peer.audio.srcObject = stream;
      void peer.audio.play().catch(() => { /* autoplay may need another gesture */ });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch { /* ignore */ } }
      if (pc.connectionState === 'closed') this.closePeer(remoteId);
    };
    this.peers.set(remoteId, peer);
    return peer;
  }

  private async createOffer(remoteId: string) {
    const peer = (await this.createPeer(remoteId));
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      if (this.channelId) gateway.voiceSignal(this.channelId, remoteId, 'offer', offer);
    } catch (e) { console.warn('voice offer failed', e); }
  }

  private async handleSignal(d: any) {
    if (!this.channelId || !d.from) return;
    let peer = this.peers.get(d.from);
    if (!peer) peer = await this.createPeer(d.from);
    try {
      if (d.kind === 'offer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(d.payload));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        gateway.voiceSignal(this.channelId, d.from, 'answer', answer);
        for (const ice of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(ice).catch(() => {});
      } else if (d.kind === 'answer') {
        if (peer.pc.signalingState !== 'stable') await peer.pc.setRemoteDescription(new RTCSessionDescription(d.payload));
        for (const ice of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(ice).catch(() => {});
      } else if (d.kind === 'ice') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(d.payload).catch(() => {});
        else peer.pendingIce.push(d.payload);
      }
    } catch (e) { console.warn('voice signal failed', e); }
  }

  private closePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* ignore */ }
    if (peer.audio) { peer.audio.pause(); peer.audio.srcObject = null; }
    this.peers.delete(userId);
  }

  private startSpeakingDetection() {
    if (!this.localStream) return;
    try {
      const ctx = new AudioContext();
      this.audioCtx = ctx;
      const source = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.analyser = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSent = 0;
      this.speakTimer = window.setInterval(() => {
        if (!this.analyser || !this.channelId) return;
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        const level = sum / data.length;
        const speaking = level > 14 && !store.state.voice.muted;
        if (speaking !== this.speaking && Date.now() - lastSent > 350) {
          this.speaking = speaking; lastSent = Date.now();
          gateway.voiceState(this.channelId, { speaking });
        }
      }, 200);
    } catch (e) { console.warn('speaking detection unavailable', e); }
  }
  private stopSpeakingDetection() {
    if (this.speakTimer !== null) { clearInterval(this.speakTimer); this.speakTimer = null; }
    if (this.audioCtx) { void this.audioCtx.close().catch(() => {}); this.audioCtx = null; this.analyser = null; }
    this.speaking = false;
  }
  private cleanupMedia() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }
}

function normalizeParticipant(p: any) {
  return { userId: p.userId, user: p.user, muted: !!p.muted, deafened: !!p.deafened, speaking: !!p.speaking };
}

export const voice = new VoiceManager();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (voice) { gateway.send('voice_state', {}); } });
}
void useApp;
