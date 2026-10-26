import { useState } from 'preact/hooks';
import { Modal } from '../Ui';
import { Icon } from '../Icons';
import { Avatar } from '../Avatar';
import { store, useApp } from '../../lib/use-store';
import { AccountTab } from './settings/AccountTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { SecurityTab } from './settings/SecurityTab';
import { SessionsTab } from './settings/SessionsTab';
import { PrivacyTab } from './settings/PrivacyTab';
import { NotificationsTab } from './settings/NotificationsTab';
import { AboutTab } from './settings/AboutTab';

const GROUPS: { title: string; items: { id: string; label: string; icon: string }[] }[] = [
  { title: 'User settings', items: [
    { id: 'account', label: 'My account', icon: 'user' },
    { id: 'appearance', label: 'Appearance', icon: 'sparkles' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
  ] },
  { title: 'Security', items: [
    { id: 'security', label: 'Password & 2FA', icon: 'lock' },
    { id: 'sessions', label: 'Sessions', icon: 'shield' },
    { id: 'privacy', label: 'Privacy & data', icon: 'eyeOff' },
  ] },
  { title: 'About', items: [{ id: 'about', label: 'About the slop', icon: 'info' }] },
];

export function UserSettingsModal({ onClose }: { onClose: () => void }) {
  const state = useApp();
  const [tab, setTab] = useState('account');
  return <Modal open onClose={onClose} xwide title={<span class="row gap-8"><Icon name="settings" size={20} /> User settings</span>} closeOnBackdrop>
    <div class="settings-shell" style={{ minHeight: 0, flex: 1 }}>
      <nav class="settings-nav">
        {GROUPS.map((g) => <div key={g.title}>
          <div class="settings-group">{g.title}</div>
          {g.items.map((it) => <button key={it.id} class={tab === it.id ? 'active' : ''} onClick={() => setTab(it.id)}><Icon name={it.icon} size={15} /> {it.label}</button>)}
        </div>)}
        <div class="settings-nav" style={{ padding: '16px 0 0', background: 'transparent', border: 0 }}>
          <button style={{ color: 'var(--danger)' }} onClick={async () => {
            if (!confirm('Log out of this session?')) return;
            try { await apiLogout(); } catch { /* ignore */ }
            location.assign('/');
          }}><Icon name="logout" size={15} /> Log out</button>
        </div>
      </nav>
      <div class="settings-content">
        <div class="row" style={{ marginBottom: 20, gap: 12 }}>
          <Avatar user={state.user} size={52} />
          <div><div class="profile-name" style={{ fontSize: 22 }}>{state.user?.displayName}</div><div class="muted">@{state.user?.username}</div></div>
        </div>
        {tab === 'account' ? <AccountTab onClose={onClose} /> : tab === 'appearance' ? <AppearanceTab /> : tab === 'notifications' ? <NotificationsTab /> : tab === 'security' ? <SecurityTab /> : tab === 'sessions' ? <SessionsTab /> : tab === 'privacy' ? <PrivacyTab /> : <AboutTab />}
      </div>
    </div>
  </Modal>;
}

async function apiLogout() {
  const { api } = await import('../../lib/api');
  await api.post('/api/auth/logout');
}
void store;
