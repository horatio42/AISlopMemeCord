import { useApp, store } from '../lib/use-store';
import { Avatar } from './Avatar';
import { Icon } from './Icons';
import { api, errorMessage } from '../lib/api';
import { gateway } from '../lib/gateway';

export function UserPanel() {
  const state = useApp();
  const user = state.user;
  if (!user) return null;
  const voice = state.voice;
  const toggleMute = () => {
    const muted = !voice.muted;
    store.updateVoice({ muted, deafened: muted ? voice.deafened : voice.deafened });
    if (voice.channelId) gateway.voiceState(voice.channelId, { muted });
    store.toast(muted ? 'Mic muted. Silence is golden.' : 'Mic live. Say something unhinged.', 'info', muted ? '🔇' : '🎙️');
  };
  const toggleDeafen = () => {
    const deafened = !voice.deafened;
    store.updateVoice({ deafened, muted: deafened ? true : voice.muted });
    if (voice.channelId) gateway.voiceState(voice.channelId, { deafened, muted: deafened ? true : voice.muted });
  };
  const menu = (e: MouseEvent) => {
    store.openMenu(e, [
      { label: 'My profile', icon: 'user', action: () => void store.showProfile(user.id) },
      { label: 'User settings', icon: 'settings', action: () => store.updateUi({ userSettingsOpen: true }) },
      { separator: true, label: '' },
      { label: 'Change theme', icon: 'sparkles', action: () => {
        const order = ['slop', 'corporate', 'deepfried', 'terminal', 'light'] as const;
        store.applyTheme(order[(order.indexOf(state.theme as any) + 1) % order.length]!);
      } },
      { separator: true, label: '' },
      { label: 'Log out', icon: 'logout', danger: true, action: async () => {
        try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
        gateway.disconnect();
        location.assign('/');
      } },
    ], `${user.displayName} · ${user.username}`);
  };
  return (
    <div class="user-panel">
      <button class="avatar-wrap" onClick={(e) => void store.showProfile(user.id)} style={{ background: 'none', padding: 0 }} title="Your profile">
        <Avatar user={user} size={32} />
      </button>
      <div class="up-info" onClick={menu}>
        <div class="up-name">{user.displayName}</div>
        <div class="up-status">{user.customStatus || (user.status === 'invisible' ? 'invisible' : user.status)}</div>
      </div>
      <div class="up-controls">
        <button class={`btn-icon ${voice.muted ? 'danger' : ''}`} title={voice.muted ? 'Unmute mic' : 'Mute mic'} onClick={toggleMute}><Icon name={voice.muted ? 'micOff' : 'mic'} size={17} /></button>
        <button class={`btn-icon ${voice.deafened ? 'danger' : ''}`} title={voice.deafened ? 'Undeafen' : 'Deafen'} onClick={toggleDeafen}><Icon name={voice.deafened ? 'headphoneOff' : 'headphones'} size={17} /></button>
        <button class="btn-icon" title="User settings" onClick={() => store.updateUi({ userSettingsOpen: true })}><Icon name="settings" size={17} /></button>
      </div>
    </div>
  );
}
