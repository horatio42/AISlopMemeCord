import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useApp, store } from '../../lib/use-store';
import { Icon } from '../Icons';
import { Avatar } from '../Avatar';
import { Perm } from '../../../shared/permissions';
import { can } from '../../lib/permissions';
import { openServer } from '../GuildRail';

interface Cmd { id: string; label: string; hint?: string; icon: string; group: string; run: () => void; avatar?: any; action?: () => void }

export function QuickSwitcher() {
  const state = useApp();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => store.updateUi({ quickSwitcherOpen: false });
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, []);
  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: 'friends', label: 'Friends', icon: 'friends', group: 'Navigate', run: () => { history.pushState({}, '', '/friends'); void store.applyRoute('/friends', false); } },
      { id: 'discover', label: 'Discover servers', icon: 'compass', group: 'Navigate', run: () => { history.pushState({}, '', '/discover'); void store.applyRoute('/discover', false); } },
      { id: 'saved', label: 'Saved slop', icon: 'bookmark', group: 'Navigate', run: () => { history.pushState({}, '', '/saved'); void store.applyRoute('/saved', false); } },
      { id: 'leaderboard', label: 'Slop leaderboard', icon: 'award', group: 'Navigate', run: () => { history.pushState({}, '', '/leaderboard'); void store.applyRoute('/leaderboard', false); } },
      { id: 'achievements', label: 'Achievements', icon: 'star', group: 'Navigate', run: () => { history.pushState({}, '', '/achievements'); void store.applyRoute('/achievements', false); } },
      { id: 'settings', label: 'User settings', icon: 'settings', hint: 'Personalize the slop', group: 'Actions', run: () => store.updateUi({ userSettingsOpen: true }) },
      { id: 'create', label: 'Create a server', icon: 'plus', hint: 'Become a landlord', group: 'Actions', run: () => window.dispatchEvent(new CustomEvent('slop:create-server')) },
      { id: 'addfriend', label: 'Add a friend', icon: 'friends', hint: 'Social interaction', group: 'Actions', run: () => window.dispatchEvent(new CustomEvent('slop:add-friend')) },
      { id: 'theme', label: 'Cycle theme', icon: 'moon', hint: 'Rotate the vibe', group: 'Actions', run: () => { const order = ['slop', 'corporate', 'deepfried', 'terminal', 'light'] as const; store.applyTheme(order[(order.indexOf(state.theme as any) + 1) % order.length]!); } },
      { id: 'logout', label: 'Log out', icon: 'logout', hint: 'Escape the pit', group: 'Actions', run: async () => { const { api } = await import('../../lib/api'); try { await api.post('/api/auth/logout'); } catch { /* ignore */ } location.assign('/'); } },
    ];
    for (const id of state.serverOrder) {
      const b = state.servers[id];
      if (!b) continue;
      list.push({ id: `server:${id}`, label: b.server.name, icon: 'home', hint: `${b.server.memberCount} members`, group: 'Servers', run: () => void openServer(id) });
      for (const ch of b.channels.filter((c) => c.type === 'text' || c.type === 'forum' || c.type === 'voice' || c.type === 'announcement')) {
        if (!can(state, Perm.VIEW_CHANNEL, id)) continue;
        list.push({ id: `channel:${ch.id}`, label: `#${ch.name}`, icon: ch.type === 'voice' ? 'volume' : ch.type === 'forum' ? 'forum' : 'hash', hint: b.server.name, group: 'Channels', run: () => void store.openChannel(id, ch.id) });
      }
    }
    for (const dm of state.dms) {
      const other = dm.members.find((m) => m.id !== state.user?.id);
      list.push({ id: `dm:${dm.id}`, label: dm.type === 'group_dm' ? (dm.name || dm.members.map((m) => m.displayName).join(', ')) : (other?.displayName ?? 'DM'), icon: 'user', hint: 'Direct message', group: 'Direct messages', avatar: other ?? { id: dm.id, displayName: dm.name || 'Group' }, run: () => void store.openChannel(null, dm.id) });
    }
    return list;
  }, [state.serverOrder, state.servers, state.dms, state.user?.id, state.theme]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => !['Servers', 'Channels', 'Direct messages'].includes(c.group)).concat(commands.filter((c) => c.group === 'Servers').slice(0, 4));
    return commands.filter((c) => (c.label + ' ' + (c.hint ?? '') + ' ' + c.group).toLowerCase().includes(q)).slice(0, 40);
  }, [commands, query]);
  useEffect(() => { setIndex(0); }, [query]);
  const choose = (c: Cmd) => { close(); c.run(); };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && filtered[index]) { e.preventDefault(); choose(filtered[index]); }
  };
  return createPortal(<div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="cmd-palette">
      <div class="cmd-input"><Icon name="search" size={18} class="text-accent" /><input ref={inputRef} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} onKeyDown={onKeyDown} placeholder="Jump to a server, channel, person, or command…" /></div>
      <div class="cmd-list">
        {filtered.length ? filtered.map((c, i) => {
          const lastGroup = filtered[i - 1]?.group;
          return <div key={c.id}>
            {query.trim() === '' && c.group !== lastGroup ? <div class="cmd-group">{c.group}</div> : null}
            <button class={`cmd-item ${i === index ? 'active' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(c)}>
              {c.avatar ? <Avatar user={c.avatar} size={22} status={false} /> : <Icon name={c.icon} size={16} />}
              <span class="grow truncate">{c.label}</span>
              {c.hint ? <span class="cmd-hint">{c.hint}</span> : null}
            </button>
          </div>;
        }) : <div class="search-empty">No matches. Maybe try a channel that exists.</div>}
      </div>
      <div class="row-between" style={{ padding: '8px 14px', borderTop: '1px solid var(--border-soft)', fontSize: 10.5, color: 'var(--faint)' }}><span><span class="kbd">↑↓</span> navigate · <span class="kbd">↵</span> go · <span class="kbd">esc</span> close</span><span>Keyboard goblin mode</span></div>
    </div>
  </div>, document.body);
}
