import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../lib/api';
import { store, useApp } from '../../lib/use-store';
import { Modal, Spinner } from '../Ui';
import { Avatar } from '../Avatar';
import { Icon } from '../Icons';

export function AddFriendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setQuery(''); setResults([]); setError(''); } }, [open]);
  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      api.get<any>(`/api/users/search?q=${encodeURIComponent(query.trim())}&limit=15`)
        .then((r) => { if (!cancelled) setResults(r.users ?? []); })
        .catch((e) => { if (!cancelled) setError(errorMessage(e)); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);
  const friendIds = new Set([...state.friends.friends, ...state.friends.incoming, ...state.friends.outgoing, ...state.friends.blocked].map((f) => f.user.id));
  const add = async (u: any) => {
    setBusy(u.id); setError('');
    try {
      const res: any = await api.post(`/api/friends/${u.id}`);
      if (res?.autoAccepted) store.toast(`You and ${u.displayName} are friends now.`, 'success', '🤝');
      else store.toast(`Friend request sent to ${u.displayName}.`, 'success', '📨');
      await store.refreshFriends();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(''); }
  };
  const dm = async (u: any) => {
    setBusy(u.id);
    try {
      const res: any = await api.post('/api/dms', { recipientIds: [u.id] });
      store.mergeDm(res.channel); onClose(); await store.openChannel(null, res.channel.id);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(''); }
  };
  return <Modal open={open} onClose={onClose} title="Find your people" small={false}>
    <div class="modal-body">
      <p class="muted mb-16" style={{ fontSize: 13 }}>Search by username. No contact uploads, no phone numbers, no algorithmic "people you may know." You have to know who you're looking for.</p>
      <div class="search-input mb-16"><Icon name="search" size={15} /><input class="input" autoFocus placeholder="Username…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} /></div>
      {error ? <div class="auth-error">{error}</div> : null}
      {searching ? <div class="empty" style={{ padding: 20 }}><Spinner size={18} /></div> : results.length ? <div class="list-card">{results.map((u) => (
        <div class="friend-row" key={u.id}>
          <Avatar user={u} size={34} onClick={() => { onClose(); void store.showProfile(u.id); }} />
          <div class="fr-info"><div class="fr-name">{u.displayName} <span class="faint" style={{ fontSize: 11 }}>@{u.username}</span></div><div class="fr-status">{u.customStatus || u.status || 'offline'}</div></div>
          {friendIds.has(u.id) ? <span class="badge">already known</span> : <>
            <button class="btn btn-primary btn-sm" disabled={busy === u.id} onClick={() => add(u)}><Icon name="friends" size={13} /> Add</button>
            <button class="btn btn-sm" disabled={busy === u.id} onClick={() => dm(u)}><Icon name="send" size={13} /> DM</button>
          </>}
        </div>
      ))}</div> : query.length >= 2 && !searching ? <div class="empty" style={{ padding: 20 }}><div class="empty-emoji">🫥</div><p>No goblins found. Try their actual username.</p></div> : null}
      <div class="divider" />
      <div class="row-between"><span class="muted" style={{ fontSize: 12 }}>Your username</span><span class="mono badge">{state.user?.username}</span></div>
    </div>
  </Modal>;
}
