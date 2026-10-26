import { useMemo, useState } from 'preact/hooks';
import { api, errorMessage } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icons';
import { EmptyState } from '../components/Avatar';
import { fmtSince } from '../lib/format2';

type Tab = 'online' | 'all' | 'pending' | 'blocked';

export function FriendsView({ onAddFriend }: { onAddFriend: () => void }) {
  const state = useApp();
  const [tab, setTab] = useState<Tab>('online');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const f = state.friends;
  const all = [...f.friends];
  const filtered = useMemo(() => {
    let list = tab === 'online' ? all.filter((x) => ['online', 'idle', 'dnd'].includes(x.user.status)) : tab === 'all' ? all : tab === 'pending' ? [...f.incoming, ...f.outgoing] : f.blocked;
    if (query.trim()) { const q = query.toLowerCase(); list = list.filter((x) => x.user.displayName.toLowerCase().includes(q) || x.user.username.toLowerCase().includes(q)); }
    return list.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  }, [tab, query, f]);

  const act = async (fn: () => Promise<any>, success?: string) => {
    setBusy('action');
    try { await fn(); await store.refreshFriends(); if (success) store.toast(success, 'success'); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setBusy(''); }
  };
  const openDm = (userId: string) => act(async () => {
    const res = await api.post<any>('/api/dms', { recipientIds: [userId] });
    store.mergeDm(res.channel);
    await store.openChannel(null, res.channel.id);
  });

  return (
    <main class="home-main">
      <div class="page-head">
        <Icon name="friends" size={22} class="text-accent" />
        <h1>Friends</h1>
        <div class="row gap-4" style={{ marginLeft: 12 }}>
          {(['online', 'all', 'pending', 'blocked'] as Tab[]).map((t) => (
            <button key={t} class={`chip ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'online' ? 'Online' : t === 'all' ? 'All friends' : t === 'pending' ? `Pending${(f.incoming.length + f.outgoing.length) ? ` ${f.incoming.length + f.outgoing.length}` : ''}` : 'Blocked'}
            </button>
          ))}
        </div>
        <button class="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={onAddFriend}><Icon name="plus" size={14} /> Add friend</button>
      </div>
      <div class="home-scroll">
        <div class="home-container" style={{ maxWidth: 860 }}>
          <div class="toolbar">
            <div class="search-input grow">
              <Icon name="search" size={15} />
              <input class="input" placeholder="Search your friends…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
            </div>
            <span class="badge">{filtered.length} in this list</span>
          </div>
          <div class="list-card">
            {filtered.length ? filtered.map((fr) => {
              const pendingIn = f.incoming.some((x) => x.user.id === fr.user.id);
              const pendingOut = f.outgoing.some((x) => x.user.id === fr.user.id);
              const blocked = f.blocked.some((x) => x.user.id === fr.user.id);
              return (
                <div class="friend-row" key={fr.user.id}>
                  <Avatar user={fr.user} size={40} onClick={() => void store.showProfile(fr.user.id)} />
                  <div class="fr-info" onClick={() => void store.showProfile(fr.user.id)} style={{ cursor: 'pointer' }}>
                    <div class="fr-name">{fr.user.displayName} <span class="faint" style={{ fontSize: 11 }}>@{fr.user.username}</span></div>
                    <div class="fr-status">{blocked ? 'Blocked. Emotionally and technically.' : fr.user.customStatus || fr.user.status} {fr.createdAt ? ` · since ${fmtSince(fr.createdAt)}` : ''}</div>
                  </div>
                  <div class="fr-actions">
                    {tab === 'pending' && pendingIn ? <>
                      <button class="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act(async () => api.post(`/api/friends/${fr.user.id}/accept`), 'Friend acquired.')}><Icon name="check" size={14} /> Accept</button>
                      <button class="btn btn-sm" disabled={!!busy} onClick={() => act(async () => api.post(`/api/friends/${fr.user.id}/decline`))}>Decline</button>
                    </> : null}
                    {tab === 'pending' && pendingOut ? <button class="btn btn-sm" disabled={!!busy} onClick={() => act(async () => api.del(`/api/friends/${fr.user.id}`))}>Cancel request</button> : null}
                    {tab === 'blocked' ? <button class="btn btn-sm" disabled={!!busy} onClick={() => act(async () => api.del(`/api/users/${fr.user.id}/block`), 'Unblocked.')}>Unblock</button> : null}
                    {!blocked && !pendingIn && !pendingOut ? <>
                      <button class="btn btn-sm" title="Send DM" onClick={() => openDm(fr.user.id)}><Icon name="send" size={14} /> Message</button>
                      <button class="btn-icon" title="More" onClick={(e) => store.openMenu(e, [
                        { label: 'View profile', icon: 'user', action: () => void store.showProfile(fr.user.id) },
                        { label: 'Remove friend', icon: 'trash', danger: true, action: () => act(async () => api.del(`/api/friends/${fr.user.id}`), 'Friend removed.') },
                        { label: 'Block user', icon: 'ban', danger: true, action: () => act(async () => api.post(`/api/users/${fr.user.id}/block`), 'Blocked.') },
                      ])}><Icon name="more" size={17} /></button>
                    </> : null}
                  </div>
                </div>
              );
            }) : <EmptyState emoji={tab === 'online' ? '😴' : tab === 'pending' ? '📬' : tab === 'blocked' ? '🚫' : '🫂'} title={tab === 'online' ? 'Nobody is online' : tab === 'pending' ? 'No pending requests' : tab === 'blocked' ? 'Nobody is blocked' : 'No friends yet'}>
              {tab === 'online' ? 'Everyone is touching grass. Unbelievable.' : tab === 'all' ? 'Add a friend. Or don’t. We’re not your therapist.' : tab === 'pending' ? 'Send someone a friend request, coward.' : 'A clean block list. Suspiciously healthy.'}
              <button class="btn btn-primary btn-sm mt-8" onClick={onAddFriend}>Add friend</button>
            </EmptyState>}
          </div>
          <p class="faint text-center mt-24" style={{ fontSize: 11 }}>Friend requests are private. No suggestions, no contact upload, no algorithmic "people you may know" nonsense.</p>
        </div>
      </div>
    </main>
  );
}
