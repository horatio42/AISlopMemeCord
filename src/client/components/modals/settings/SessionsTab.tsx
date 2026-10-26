import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../../lib/api';
import { store } from '../../../lib/use-store';
import { Icon } from '../../Icons';
import { Spinner } from '../../Ui';
import { fmtRelative } from '../../../lib/format';

export function SessionsTab() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { const res = await api.get<any>('/api/auth/sessions'); setSessions(res.sessions ?? []); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const revoke = async (id: string, current: boolean) => {
    if (!confirm(current ? 'Log out this session? You will need to log in again.' : 'Revoke this session? That device will be logged out.')) return;
    try {
      await api.del(`/api/auth/sessions/${id}`);
      if (current) { location.assign('/'); return; }
      setSessions((s) => s.filter((x) => x.id !== id));
      store.toast('Session revoked.', 'success');
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const revokeAll = async () => {
    if (!confirm('Revoke every other session? All other devices will be logged out.')) return;
    try { await api.post('/api/auth/sessions/revoke-all'); await load(); store.toast('All other sessions revoked. Paranoid and valid.', 'success', '🛡️'); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  return <div>
    <h3>Active sessions</h3>
    <p class="settings-desc">Every login creates an opaque session token stored hashed. Sessions expire after 30 days and slide on activity. Revoke anything that isn't yours.</p>
    <div class="row-between mb-16"><span class="badge">{sessions.length} active</span><button class="btn btn-sm" onClick={revokeAll} disabled={sessions.length < 2}><Icon name="shield" size={14} /> Revoke all other sessions</button></div>
    {loading ? <div class="empty"><Spinner /></div> : <div class="list-card">{sessions.map((s) => <div class="friend-row" key={s.id}>
      <div class="avatar center" style={{ width: 34, height: 34, background: 'var(--bg-active)', borderRadius: 8 }}><Icon name={s.current ? 'check' : 'shield'} size={16} class={s.current ? 'text-success' : 'text-accent'} /></div>
      <div class="fr-info">
        <div class="fr-name">{s.current ? 'This device' : (s.userAgent || 'Unknown goblin device')}</div>
        <div class="fr-status">Created {fmtRelative(s.createdAt)} · last used {fmtRelative(s.lastUsedAt)}</div>
        {s.userAgent ? <div class="faint" style={{ fontSize: 10, marginTop: 2, maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userAgent}</div> : null}
      </div>
      <button class="btn btn-sm" style={s.current ? { color: 'var(--danger)' } : undefined} onClick={() => revoke(s.id, s.current)}>{s.current ? 'Log out' : 'Revoke'}</button>
    </div>)}</div>}
  </div>;
}
