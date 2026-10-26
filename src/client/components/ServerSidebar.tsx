import { useState } from 'preact/hooks';
import { useApp, store } from '../lib/use-store';
import { Icon } from './Icons';
import { Avatar } from './Avatar';
import { UserPanel } from './UserPanel';
import { Perm } from '../../shared/permissions';
import { can, canChannel } from '../lib/permissions';
import { api, errorMessage } from '../lib/api';

export function ServerSidebar(props: {
  onOpenSettings: (tab?: string) => void;
  onInvite: () => void;
  onCreateChannel: (parentId?: string, type?: string) => void;
  open?: boolean;
}) {
  const state = useApp();
  const bundle = state.activeServerId ? state.servers[state.activeServerId] : null;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('slop-collapsed') ?? '{}'); } catch { return {}; }
  });
  if (!bundle) return null;
  const { server, roles, channels } = bundle;
  const manageChannels = can(state, Perm.MANAGE_CHANNELS, server.id);
  const manageServer = can(state, Perm.MANAGE_SERVER, server.id);
  const createInvite = can(state, Perm.CREATE_INVITES, server.id);
  const canCreateThreads = can(state, Perm.CREATE_THREADS, server.id);

  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    localStorage.setItem('slop-collapsed', JSON.stringify(next));
  };
  const sorted = [...channels].filter((c) => c.type !== 'thread' && c.type !== 'dm' && c.type !== 'group_dm').sort((a, b) => a.position - b.position);
  const cats = sorted.filter((c) => c.type === 'category');
  const top = sorted.filter((c) => c.type !== 'category' && !c.parentId);
  const childrenOf = (parentId: string) => sorted.filter((c) => c.type !== 'category' && c.parentId === parentId);
  const allTop = top;
  const activeChannel = state.activeChannelId ? state.channels[state.activeChannelId] : null;

  const serverMenu = (e: MouseEvent) => {
    const items = [
      ...(createInvite ? [{ label: 'Invite people', icon: 'link', action: props.onInvite }] : []),
      ...(manageServer ? [{ label: 'Server settings', icon: 'settings', action: () => props.onOpenSettings('overview') }] : []),
      ...(manageChannels ? [
        { label: 'Create channel', icon: 'plus', action: () => props.onCreateChannel(undefined, 'text') },
        { label: 'Create category', icon: 'plus', action: () => props.onCreateChannel(undefined, 'category') },
      ] : []),
      { separator: true, label: '' },
      { label: 'Copy server link', icon: 'copy', action: async () => {
        try { await navigator.clipboard.writeText(location.origin + `/channels/${server.id}`); store.toast('Link copied. Spam responsibly.', 'success', '🔗'); } catch { store.toast('Clipboard broke. Classic.', 'error'); }
      } },
      { separator: true, label: '' },
      { label: server.ownerId === state.user?.id ? 'Delete server' : 'Leave server', icon: 'logout', danger: true, action: async () => {
        if (server.ownerId === state.user?.id) {
          if (!confirm(`Delete "${server.name}" and all its slop forever? This cannot be undone.`)) return;
          try { await api.del(`/api/servers/${server.id}`, { confirmName: server.name }); store.toast('Server deleted. The pit is quiet.', 'success'); } catch (e) { store.toast(errorMessage(e), 'error'); return; }
        } else {
          if (!confirm(`Leave "${server.name}"?`)) return;
          try { await api.post(`/api/servers/${server.id}/leave`); store.toast('You left the server. Freedom.', 'success'); } catch (e) { store.toast(errorMessage(e), 'error'); return; }
        }
        history.pushState({}, '', '/');
        await store.loadWorkspace();
        await store.applyRoute('/', false);
      } },
    ] as any[];
    store.openMenu(e, items, server.name);
  };

  const channelMenu = (e: MouseEvent, ch: any) => {
    e.preventDefault(); e.stopPropagation();
    const items: any[] = [
      { label: 'Mark as read', icon: 'check', action: () => void store.markRead(ch.id) },
      { label: 'Copy channel link', icon: 'link', action: async () => { try { await navigator.clipboard.writeText(`${location.origin}/channels/${server.id}/${ch.id}`); store.toast('Channel link copied', 'success', '🔗'); } catch { /* ignore */ } } },
    ];
    if (ch.type !== 'voice' && canChannel(state, ch, Perm.CREATE_INVITES)) items.push({ label: 'Create invite', icon: 'link', action: props.onInvite });
    if (manageChannels || manageServer) {
      items.push({ separator: true, label: '' }, { label: 'Edit channel', icon: 'edit', action: () => props.onOpenSettings(`channel:${ch.id}`) });
      items.push({ label: 'Delete channel', icon: 'trash', danger: true, action: async () => {
        if (!confirm(`Delete #${ch.name} and every message in it?`)) return;
        try {
          await api.del(`/api/channels/${ch.id}`);
          store.toast('Channel deleted', 'success');
          await store.loadServer(server.id, { force: true });
          if (state.activeChannelId === ch.id) {
            const fallback = store.state.servers[server.id]?.channels.find((c) => c.type === 'text');
            if (fallback) await store.openChannel(server.id, fallback.id);
          }
        } catch (e) { store.toast(errorMessage(e), 'error'); }
      } });
    }
    store.openMenu(e, items, `#${ch.name}`);
  };

  const renderChannel = (ch: any) => {
    const active = activeChannel?.id === ch.id;
    const unread = state.unread[ch.id];
    const mentionCount = unread?.mentions ?? ch.mentionCount ?? 0;
    const count = unread?.count ?? ch.unreadCount ?? 0;
    const icon = ch.type === 'voice' ? 'volume' : ch.type === 'forum' ? 'forum' : ch.type === 'announcement' ? 'announcement' : 'hash';
    const locked = !canChannel(state, ch, Perm.VIEW_CHANNEL);
    return (
      <button key={ch.id} class={`channel-item ${ch.type === 'voice' ? 'voice' : ''} ${active ? 'active' : ''} ${state.voice.channelId === ch.id ? 'active-voice' : ''}`}
        onClick={() => void store.openChannel(server.id, ch.id)} onContextMenu={(e) => channelMenu(e, ch)}
        title={locked ? 'Private channel' : ch.topic || ch.name}>
        <Icon name={locked ? 'lock' : icon} size={17} class="ch-icon" />
        <span class="ch-name">{ch.name}</span>
        {ch.type === 'forum' && canCreateThreads ? <span class="ch-meta" title="Forum"><Icon name="thread" size={12} /></span> : null}
        {mentionCount > 0 ? <span class="ch-badge">{mentionCount > 99 ? '99+' : mentionCount}</span> : count > 0 && !active ? <span class="ch-unread" /> : null}
      </button>
    );
  };

  return (
    <aside class={`sidebar ${props.open ? 'open' : ''}`} aria-label="Channels">
      <div class="sidebar-header">
        <button class="server-name-btn" onClick={serverMenu}>
          {server.icon ? <img class="server-icon-sm" src={server.icon} alt="" /> : <span class="server-icon-sm center" style={{ display: 'inline-flex', fontWeight: 800, color: 'var(--accent-ink)', background: 'var(--accent)' }}>{server.name.charAt(0)}</span>}
          <span class="truncate">{server.name}</span>
          <Icon name="chevronDown" size={14} class="chev" />
        </button>
      </div>
      {server.motd ? <div class="server-traits"><span class="badge" title={server.motd} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{server.motd}</span></div> : null}
      <div class="channel-scroll">
        {allTop.map((ch) => renderChannel(ch))}
        {cats.map((cat) => {
          const kids = childrenOf(cat.id);
          const isCollapsed = collapsed[cat.id];
          return <div key={cat.id}>
            <div class={`channel-category ${isCollapsed ? 'collapsed' : ''}`} onClick={() => toggle(cat.id)}>
              <Icon name="chevronDown" size={12} class="chev" />
              <span class="truncate">{cat.name}</span>
              {manageChannels ? <button class="cat-add btn-icon sm" title="Create channel in category" onClick={(e) => { e.stopPropagation(); props.onCreateChannel(cat.id, 'text'); }}><Icon name="plus" size={12} /></button> : null}
            </div>
            {!isCollapsed ? <div class="channel-list">{kids.map(renderChannel)}</div> : null}
          </div>;
        })}
        {manageChannels ? <button class="sidebar-cta" style={{ width: 'calc(100% - 20px)' }} onClick={() => props.onCreateChannel(undefined, 'text')}>+ Create channel</button> : null}
      </div>
      <UserPanel />
    </aside>
  );
}
