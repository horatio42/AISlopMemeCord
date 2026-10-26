import { useApp, store } from '../lib/use-store';
import { Icon } from './Icons';
import { Avatar } from './Avatar';
import { UserPanel } from './UserPanel';
import type { DMChannel } from '../../shared/types';

export function DMSidebar(props: { onAddFriend: () => void; open?: boolean }) {
  const state = useApp();
  const incoming = state.friends.incoming.length;
  const nav: { label: string; path: string; icon: string; view: string[]; badge?: number }[] = [
    { label: 'Friends', path: '/friends', icon: 'friends', view: ['friends'], badge: incoming },
    { label: 'Discover servers', path: '/discover', icon: 'compass', view: ['discover'] },
    { label: 'Saved slop', path: '/saved', icon: 'bookmark', view: ['saved'] },
    { label: 'Slop leaderboard', path: '/leaderboard', icon: 'award', view: ['leaderboard'] },
    { label: 'Achievements', path: '/achievements', icon: 'star', view: ['achievements'] },
  ];
  const others = (dm: DMChannel) => dm.members.filter((m) => m.id !== state.user?.id);
  const online = state.dms.filter((d) => others(d).some((m) => m.status === 'online' || m.status === 'idle' || m.status === 'dnd'));
  const offline = state.dms.filter((d) => !online.includes(d));
  const dmUnread = (dm: DMChannel) => dm.unreadCount ?? state.unread[dm.id]?.count ?? 0;
  const dmMentions = (dm: DMChannel) => dm.mentionCount ?? state.unread[dm.id]?.mentions ?? 0;
  const row = (dm: DMChannel) => {
    const active = state.view.type === 'dm' && state.activeChannelId === dm.id;
    const people = others(dm);
    const person = people[0];
    const label = dm.type === 'group_dm' ? (dm.name || people.map((p) => p.displayName).join(', ')) : (person?.displayName ?? dm.name ?? 'Direct Slop');
    const unread = dmUnread(dm), mentions = dmMentions(dm);
    return (
      <button key={dm.id} class={`dm-item ${active ? 'active' : ''}`} onClick={() => void store.openChannel(null, dm.id)} title={label}>
        {dm.type === 'group_dm' && people.length > 1 ? (
          <div class="dm-group-avatar">
            {people.slice(0, 2).map((p) => <Avatar key={p.id} user={p} size={20} status={false} />)}
          </div>
        ) : <Avatar user={person ?? { id: dm.id, displayName: label }} size={32} />}
        <span class="dm-name">{label}{dm.type === 'group_dm' ? <span class="faint" style={{ fontSize: 10 }}> · {people.length + 1}</span> : null}</span>
        {mentions > 0 ? <span class="dm-badge">{mentions > 99 ? '99+' : mentions}</span> : unread > 0 ? <span class="dm-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
    );
  };
  const go = (path: string) => { history.pushState({}, '', path); void store.applyRoute(path, false); };
  return (
    <aside class={`sidebar ${props.open ? 'open' : ''}`} aria-label="Direct messages">
      <div class="sidebar-header">
        <div class="server-name-btn" style={{ cursor: 'default' }}>
          <img src="/static/assets/brand/logo.svg" alt="" style={{ width: 24, height: 24 }} />
          <span class="truncate">Slop HQ</span>
        </div>
        <button class="btn-icon sm" title="New group DM" onClick={() => props.onAddFriend()}><Icon name="plus" size={17} /></button>
      </div>
      <div style={{ padding: '8px 10px 0' }}>
        <button class="search-trigger" style={{ width: '100%' }} onClick={() => store.updateUi({ quickSwitcherOpen: true })}>
          <Icon name="search" size={13} /><span class="grow" style={{ textAlign: 'left' }}>Find or start a chat</span><span class="kbd">⌘K</span>
        </button>
      </div>
      <div class="channel-scroll" style={{ paddingTop: 6 }}>
        {nav.map((item) => (
          <button key={item.path} class={`channel-item ${item.view.includes(state.view.type) ? 'active' : ''}`} onClick={() => go(item.path)}>
            <Icon name={item.icon} size={17} class="ch-icon" />
            <span class="ch-name">{item.label}</span>
            {item.badge ? <span class="ch-badge">{item.badge}</span> : null}
          </button>
        ))}
        <div class="sidebar-section-label" style={{ display: 'flex', alignItems: 'center' }}>
          <span class="grow">Direct messages</span>
          <button class="btn-icon sm" title="New DM / group" onClick={() => props.onAddFriend()}><Icon name="plus" size={13} /></button>
        </div>
        {online.length ? <div class="dm-group-label">Online — allegedly</div> : null}
        <div class="dm-list">{online.map(row)}</div>
        {offline.length ? <div class="dm-group-label">Offline / touching grass</div> : null}
        <div class="dm-list">{offline.map(row)}</div>
        {!state.dms.length ? <div class="sidebar-cta" style={{ cursor: 'pointer' }} onClick={() => props.onAddFriend()}>No DMs yet. Click to summon a friend.</div> : null}
      </div>
      <UserPanel />
    </aside>
  );
}
