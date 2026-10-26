import { useEffect, useState } from 'preact/hooks';
import { store } from '../../../lib/use-store';
import { Toggle } from '../../Ui';
import { Icon } from '../../Icons';

export function NotificationsTab() {
  const [permission, setPermission] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const [sound, setSound] = useState(localStorage.getItem('slop-notify-sound') !== '0');
  const [mentionsOnly, setMentionsOnly] = useState(localStorage.getItem('slop-notify-mentions') !== '0');
  const [enabled, setEnabled] = useState(localStorage.getItem('slop-notify') === '1');
  useEffect(() => { if (typeof Notification !== 'undefined') setPermission(Notification.permission); }, []);
  const request = async () => {
    if (typeof Notification === 'undefined') { store.toast('Browser notifications are unavailable here.', 'error'); return; }
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') { setEnabled(true); localStorage.setItem('slop-notify', '1'); store.toast('Notifications enabled. You will regret this.', 'success', '🔔'); }
    else store.toast('Permission denied. The browser has boundaries.', 'error');
  };
  const testSound = () => { const a = new Audio('/static/assets/sounds/pog.wav'); a.volume = .6; void a.play().catch(() => {}); };
  return <div>
    <h3>Notifications</h3>
    <p class="settings-desc">Entirely local. No push service, no Firebase, no email you to death. The browser only knows what this tab tells it.</p>
    <div class="card flat" style={{ padding: 16 }}>
      <div class="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
        <div><div style={{ fontWeight: 650 }}>Desktop notifications</div><div class="faint" style={{ fontSize: 11 }}>Status: <strong>{permission}</strong>. Used for mentions, replies and friend requests while the tab is hidden.</div></div>
        <button class="btn btn-sm" onClick={request} disabled={permission === 'granted'}>{permission === 'granted' ? 'Granted' : 'Enable'}</button>
      </div>
      <div class="row-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border-soft)' }}>
        <div><div style={{ fontWeight: 650 }}>Notification sound</div><div class="faint" style={{ fontSize: 11 }}>A tasteful 8-bit pog. Bundled, not streamed.</div></div>
        <div class="row gap-8"><button class="btn btn-xs" onClick={testSound}><Icon name="volumeLow" size={12} /> Test</button><Toggle checked={sound} onChange={(v) => { setSound(v); localStorage.setItem('slop-notify-sound', v ? '1' : '0'); }} /></div>
      </div>
      <div class="row-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border-soft)' }}>
        <div><div style={{ fontWeight: 650 }}>Only notify for mentions</div><div class="faint" style={{ fontSize: 11 }}>Otherwise all unread messages can trigger a toast while the tab is hidden.</div></div>
        <Toggle checked={mentionsOnly} onChange={(v) => { setMentionsOnly(v); localStorage.setItem('slop-notify-mentions', v ? '1' : '0'); }} />
      </div>
      <div class="row-between" style={{ padding: '12px 0' }}>
        <div><div style={{ fontWeight: 650 }}>Toast notifications inside the app</div><div class="faint" style={{ fontSize: 11 }}>The little bottom-center slop alerts.</div></div>
        <Toggle checked={enabled} onChange={(v) => { setEnabled(v); localStorage.setItem('slop-notify', v ? '1' : '0'); }} />
      </div>
    </div>
    <div class="auth-notice mt-16">This settings page does not store notification preferences on the server. They live in this browser only, because your preferences are not our data.</div>
  </div>;
}
