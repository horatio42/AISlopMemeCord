import { useMemo } from 'preact/hooks';
import { useApp, store } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { Avatar } from '../components/Avatar';
import { COPYPASTAS } from '../../shared/memes';
import { fmtRelative } from '../lib/format';
import { api, errorMessage } from '../lib/api';

export function HomeView({ onCreateServer, onAddFriend }: { onCreateServer: () => void; onAddFriend: () => void }) {
  const state = useApp();
  const user = state.user!;
  const day = new Date().toDateString();
  const copypasta = useMemo(() => COPYPASTAS[Math.abs([...day].reduce((a, c) => a + c.charCodeAt(0), 0)) % COPYPASTAS.length], [day]);
  const incoming = state.friends.incoming;
  const servers = state.serverOrder.map((id) => state.servers[id]).filter((b): b is NonNullable<typeof b> => !!b);
  const unreadNotifications = state.notifications.filter((n) => !n.read);
  const go = (path: string) => { history.pushState({}, '', path); void store.applyRoute(path, false); };
  const markAllRead = async () => {
    try {
      await api.post('/api/notifications/read', { all: true });
      state.notifications = state.notifications.map((n) => ({ ...n, read: true }));
      state.notificationUnread = 0;
      store.emit();
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  return (
    <main class="home-main">
      <div class="ticker"><div class="ticker-inner">{[...COPYPASTAS.slice(0, 7), ...COPYPASTAS.slice(0, 7)].map((t, i) => <span key={i}>⚡ {t}</span>)}</div></div>
      <div class="home-scroll">
        <div class="home-container">
          <div class="home-hero">
            <img class="hero-mascot" src="/static/assets/brand/mascot.svg" alt="" />
            <div class="grow">
              <h1>Welcome back, {user.displayName}.</h1>
              <p>{state.instance?.motd || 'The slop is warm. The goblins are waiting.'} You have <strong>{state.notificationUnread}</strong> unread notifications and <strong>{incoming.length}</strong> friend request{incoming.length === 1 ? '' : 's'}.</p>
              <div class="row gap-8 wrap mt-16">
                <button class="btn btn-primary btn-sm" onClick={onAddFriend}><Icon name="friends" size={15} /> Add friend</button>
                <button class="btn btn-sm" onClick={onCreateServer}><Icon name="plus" size={15} /> Create server</button>
                <button class="btn btn-sm" onClick={() => go('/discover')}><Icon name="compass" size={15} /> Discover</button>
                <button class="btn btn-ghost btn-sm" onClick={() => go('/leaderboard')}><Icon name="award" size={15} /> Leaderboard</button>
              </div>
            </div>
            <div class="card-sticker" style={{ maxWidth: 220, background: 'var(--bg-card)' }}>
              <div class="section-title">Slop of the day</div>
              <p style={{ marginTop: 6, fontFamily: 'var(--font-meme)', fontSize: 18, lineHeight: 1.25 }}>“{copypasta}”</p>
              <div class="faint mt-8" style={{ fontSize: 10 }}>— The Algorithm (probably)</div>
            </div>
          </div>
          <div class="home-grid">
            <div class="col gap-16">
              {incoming.length ? <div class="panel">
                <div class="panel-head"><h3><Icon name="friends" size={16} /> Friend requests</h3><button class="btn-link" onClick={() => go('/friends')}>View all</button></div>
                <div class="panel-body" style={{ padding: 0 }}>
                  {incoming.slice(0, 3).map((f) => <FriendRequestRow key={f.user.id} friend={f} />)}
                </div>
              </div> : null}
              <div class="panel">
                <div class="panel-head"><h3><Icon name="home" size={16} /> Your servers</h3><button class="btn-link" onClick={onCreateServer}>+ New</button></div>
                <div class="panel-body">
                  {servers.length ? <div class="discover-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                    {servers.slice(0, 6).map((b) => (
                      <button key={b.server.id} class="server-card" style={{ textAlign: 'left', background: 'var(--bg-main)' }} onClick={() => { void import('../components/GuildRail').then((m) => m.openServer(b.server.id)); }}>
                        <div class="sc-banner" style={{ background: b.server.bannerColor || 'linear-gradient(120deg, var(--purple), var(--pink))' }} />
                        <div class="sc-body">
                          {b.server.icon ? <img class="sc-icon" src={b.server.icon} alt="" /> : <div class="sc-icon center" style={{ display: 'flex', fontSize: 20, fontWeight: 800, color: 'var(--accent-ink)', background: 'var(--accent)' }}>{b.server.name.charAt(0)}</div>}
                          <div class="sc-name truncate">{b.server.name}</div>
                          <div class="sc-desc">{b.server.description || 'No description. Mysterious.'}</div>
                          <div class="row gap-8 faint" style={{ fontSize: 11 }}><Icon name="users" size={11} /> {b.server.memberCount} members</div>
                        </div>
                      </button>
                    ))}
                  </div> : <div class="empty" style={{ padding: 24 }}><div class="empty-emoji">🏚️</div><p>No servers yet. Be the landlord of your own slop.</p><button class="btn btn-primary btn-sm" onClick={onCreateServer}>Create a server</button></div>}
                </div>
              </div>
              <div class="panel">
                <div class="panel-head"><h3><Icon name="sparkles" size={16} /> Meme dispensary</h3><span class="badge accent">100% human-made*</span></div>
                <div class="panel-body">
                  <div class="meme-grid">
                    {['this-is-slop', 'touch-grass', 'brain-empty'].map((m) => (
                      <div class="meme-card" key={m}><img src={`/static/assets/memes/${m}.svg`} alt={m} /><div class="meme-caption">{m.replace(/-/g, ' ')}</div></div>
                    ))}
                  </div>
                  <div class="faint mt-8" style={{ fontSize: 10 }}>*made by an AI that has never touched grass</div>
                </div>
              </div>
            </div>
            <div class="col gap-16">
              <div class="panel">
                <div class="panel-head"><h3><Icon name="bell" size={16} /> Notifications</h3>{unreadNotifications.length ? <button class="btn-link" onClick={markAllRead}>Mark all read</button> : null}</div>
                <div class="panel-body" style={{ padding: 0, maxHeight: 320, overflowY: 'auto' }}>
                  {state.notifications.length ? state.notifications.slice(0, 6).map((n) => (
                    <div key={n.id} class="friend-row" style={{ padding: '9px 14px' }}>
                      {n.actor ? <Avatar user={n.actor} size={30} /> : <div class="avatar center" style={{ width: 30, height: 30, background: 'var(--bg-active)', color: 'var(--accent)' }}><Icon name="bell" size={14} /></div>}
                      <div class="fr-info">
                        <div class="fr-name" style={{ fontSize: 12.5 }}>{n.title}</div>
                        <div class="fr-status" style={{ fontSize: 11 }}>{n.body}</div>
                      </div>
                      {!n.read ? <span class="badge accent" style={{ fontSize: 9 }}>new</span> : null}
                    </div>
                  )) : <div class="empty" style={{ padding: 30 }}><div class="empty-emoji">🦗</div><p>No notifications. Peaceful. Suspicious.</p></div>}
                </div>
              </div>
              <div class="panel">
                <div class="panel-head"><h3><Icon name="fire" size={16} /> Slop stats</h3></div>
                <div class="panel-body">
                  <div class="row-between"><span class="muted">Your Slop Points</span><strong class="text-accent">{user.karma.toLocaleString()}</strong></div>
                  <div class="divider" />
                  <div class="row-between"><span class="muted">Servers joined</span><strong>{state.serverOrder.length}</strong></div>
                  <div class="divider" />
                  <div class="row-between"><span class="muted">Friends</span><strong>{state.friends.friends.length}</strong></div>
                  <div class="divider" />
                  <div class="row-between"><span class="muted">DMs unlocked</span><strong>{state.dms.length}</strong></div>
                  <button class="btn btn-sm btn-block mt-16" onClick={() => go('/achievements')}><Icon name="star" size={14} /> Show achievements</button>
                </div>
              </div>
              <div class="panel">
                <div class="panel-head"><h3><Icon name="info" size={16} /> Privacy corner</h3></div>
                <div class="panel-body" style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                  <p><strong style={{ color: 'var(--success)' }}>● No telemetry.</strong> No external requests. No tracking pixels. No "legitimate interest".</p>
                  <p class="mt-8"><strong style={{ color: 'var(--text)' }}>Everything lives in /data.</strong> SQLite, uploads, exports. One container. Portable forever.</p>
                  <p class="mt-8"><strong style={{ color: 'var(--text)' }}>E2EE DMs</strong> are optional and client-side. The server sees ciphertext and vibes.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function FriendRequestRow({ friend }: { friend: any }) {
  const accept = async () => {
    try { await api.post(`/api/friends/${friend.user.id}/accept`); await store.refreshFriends(); store.toast('Friend added. Touch grass adjacent.', 'success', '🤝'); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const decline = async () => {
    try { await api.post(`/api/friends/${friend.user.id}/decline`); await store.refreshFriends(); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  return <div class="friend-row">
    <Avatar user={friend.user} size={34} />
    <div class="fr-info"><div class="fr-name">{friend.user.displayName}</div><div class="fr-status">@{friend.user.username} · wants to slop with you</div></div>
    <div class="fr-actions"><button class="btn-icon" title="Accept" onClick={accept}><Icon name="check" size={17} /></button><button class="btn-icon" title="Decline" onClick={decline}><Icon name="close" size={17} /></button></div>
  </div>;
}

export function friendSince(ts: number) { return fmtRelative(ts); }
