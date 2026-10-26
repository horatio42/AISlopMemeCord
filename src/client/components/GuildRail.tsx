import { useApp, store } from '../lib/use-store';
import { Icon } from './Icons';
import { Avatar } from './Avatar';
import { initial } from '../lib/format';

export async function openServer(serverId: string) {
  const bundle = await store.loadServer(serverId);
  if (!bundle) return;
  const saved = localStorage.getItem(`slop-last-channel-${serverId}`);
  let target = saved ? bundle.channels.find((c) => c.id === saved && c.type !== 'category' && c.type !== 'thread') : null;
  if (!target) target = bundle.channels.find((c) => c.type === 'text' || c.type === 'forum' || c.type === 'announcement');
  if (!target) target = bundle.channels.find((c) => c.type !== 'category' && c.type !== 'thread');
  if (target) await store.openChannel(serverId, target.id);
  else { store.set({ view: { type: 'channel', serverId }, activeServerId: serverId, activeChannelId: null }); history.pushState({}, '', `/channels/${serverId}`); }
}

export function GuildRail({ onCreateServer, open = false }: { onCreateServer: () => void; open?: boolean }) {
  const state = useApp();
  const dmUnread = state.dms.reduce((n, d) => n + (d.unreadCount ?? 0), 0);
  const serverUnread = (id: string) => {
    const b = state.servers[id];
    return b ? b.channels.reduce((n, c) => n + (state.unread[c.id]?.count ?? 0), 0) : 0;
  };
  return (
    <nav class={`guild-rail ${open ? 'open' : ''}`} aria-label="Servers">
      <button class={`rail-item home ${!state.activeServerId && (state.view.type === 'home' || state.view.type === 'friends' || state.view.type === 'saved' || state.view.type === 'leaderboard' || state.view.type === 'discover') ? 'active' : ''}`} title="Slop HQ" onClick={() => { history.pushState({}, '', '/'); void store.applyRoute('/', false); }}>
        <img src="/static/assets/brand/logo.svg" alt="Home" style={{ padding: 3 }} />
        {dmUnread > 0 ? <span class="rail-badge">{dmUnread > 99 ? '99+' : dmUnread}</span> : null}
        <span class="rail-pill" />
      </button>
      <div class="rail-sep" />
      {state.serverOrder.map((id) => {
        const b = state.servers[id];
        if (!b) return null;
        const active = state.activeServerId === id;
        const unread = serverUnread(id);
        const initials = initial(b.server.name);
        return (
          <button key={id} class={`rail-item ${active ? 'active' : ''}`} title={b.server.name} onClick={() => void openServer(id)}>
            {b.server.icon ? <img src={b.server.icon} alt={b.server.name} /> : <span>{initials}</span>}
            {unread > 0 && !active ? <span class="rail-unread-dot" /> : null}
            {unread > 0 ? <span class="rail-badge">{unread > 99 ? '99+' : unread}</span> : null}
            <span class="rail-pill" />
          </button>
        );
      })}
      <button class="rail-item add" title="Create a server" onClick={onCreateServer}><Icon name="plus" size={22} /></button>
      <button class={`rail-item discover ${state.view.type === 'discover' ? 'active' : ''}`} title="Discover public slop" onClick={() => { history.pushState({}, '', '/discover'); void store.applyRoute('/discover', false); }}><Icon name="compass" size={22} /></button>
      <div class="rail-spacer" />
      {state.user?.isAdmin ? <a class="rail-admin" href="/admin" title="Slop Control (instance admin)"><Icon name="admin" size={19} /></a> : null}
      <button class="rail-item" title="Toggle theme" onClick={() => {
        const order = ['slop', 'corporate', 'deepfried', 'terminal', 'light'] as const;
        const next = order[(order.indexOf(state.theme as any) + 1) % order.length]!;
        store.applyTheme(next);
        store.toast(`Theme: ${next}`, 'info', next === 'deepfried' ? '🍟' : next === 'terminal' ? '🖥️' : '🎨');
      }} style={{ background: 'transparent', border: '1px solid var(--border-soft)' }}><Icon name={state.theme === 'light' ? 'sun' : 'moon'} size={18} /></button>
    </nav>
  );
}
