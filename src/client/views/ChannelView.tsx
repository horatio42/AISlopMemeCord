import { useEffect, useRef, useState } from 'preact/hooks';
import type { Channel, Message } from '../../shared/types';
import { useApp, store } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { Avatar, AvatarStack } from '../components/Avatar';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { MemberSidebar } from '../components/MemberSidebar';
import { ForumView } from '../components/ForumView';
import { VoiceRoom } from '../components/VoiceRoom';
import { RightPanels } from '../components/RightPanels';
import { can, canChannel } from '../lib/permissions';
import { Perm } from '../../shared/permissions';
import { api, errorMessage } from '../lib/api';
import { fmtRelative } from '../lib/format';

export function ChannelView({ onReport, onOpenSettings }: { onReport: (m: Message) => void; onOpenSettings: () => void }) {
  const state = useApp();
  const channelId = state.activeChannelId!;
  const channel = state.channels[channelId] ?? (state.dms.find((d) => d.id === channelId) as unknown as Channel | undefined) ?? null;
  const cache = state.messages[channelId];
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [mobileMembers, setMobileMembers] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 920px)').matches);
  const initialScrollDone = useRef<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 920px)');
    const onChange = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setReplyTo(null); setEditing(null); setMobileMembers(false);
    if (channelId) void store.loadMessages(channelId);
  }, [channelId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setAtBottom(nearBottom);
      if (el.scrollTop < 80 && cache?.hasMore && !cache.loading) void store.loadMoreMessages(channelId);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [channelId, cache?.hasMore, cache?.loading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !cache?.loaded) return;
    if (initialScrollDone.current !== channelId) {
      initialScrollDone.current = channelId;
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
      void store.markRead(channelId);
    } else if (atBottom) {
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    }
  }, [channelId, cache?.loaded, cache?.messages.length]);

  useEffect(() => {
    const hash = location.hash;
    if (hash.startsWith('#message-') && cache?.loaded) {
      const id = hash.slice('#message-'.length);
      setTimeout(() => document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [cache?.loaded, channelId]);

  if (!channel) return <div class="center col" style={{ flex: 1 }}><span class="spinner" /><p class="muted mono">loading channel…</p></div>;
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const dm = isDm ? state.dms.find((d) => d.id === channel.id) : null;
  const others = dm?.members.filter((m) => m.id !== state.user?.id) ?? [];
  const other = others[0];
  const bundle = channel.serverId ? state.servers[channel.serverId] : null;
  const sendPerm = isDm ? true : canChannel(state, channel, channel.type === 'thread' ? Perm.SEND_IN_THREADS : Perm.SEND_MESSAGES);
  const viewPerm = isDm ? true : canChannel(state, channel, Perm.VIEW_CHANNEL);
  const canPin = isDm ? false : canChannel(state, channel, Perm.PIN_MESSAGES);
  const canThread = !isDm && channel.serverId && canChannel(state, channel, Perm.CREATE_THREADS);
  const showMembers = !!bundle && (isNarrow ? mobileMembers : state.ui.membersOpen);
  const typing = (state.typing[channelId] ?? []).filter((u) => Date.now() - u.at < 7000);

  const headerMenu = (e: MouseEvent) => {
    const items: any[] = [
      { label: 'Copy channel link', icon: 'link', action: async () => { try { await navigator.clipboard.writeText(location.href); store.toast('Link copied', 'success'); } catch { /* ignore */ } } },
      { label: 'Mark as read', icon: 'check', action: () => void store.markRead(channelId) },
    ];
    if (!isDm) items.push({ label: 'Open pins', icon: 'pin', action: () => store.updateUi({ rightPanel: { kind: 'pins', channelId } }) });
    if (!isDm && channel.serverId) items.push({ label: 'Channel settings', icon: 'settings', action: () => onOpenSettings() });
    if (dm && dm.type === 'dm') items.push({ label: 'View profile', icon: 'user', action: () => other && void store.showProfile(other.id) });
    if (dm) items.push({ separator: true, label: '' }, { label: 'Close conversation', icon: 'close', danger: true, action: async () => {
      try { await api.del(`/api/dms/${dm.id}`); store.state.dms = store.state.dms.filter((d) => d.id !== dm.id); store.updateUi({ rightPanel: null }); history.pushState({}, '', '/'); await store.applyRoute('/', false); }
      catch (err) { store.toast(errorMessage(err), 'error'); }
    } });
    store.openMenu(e, items, isDm ? (dm?.name || other?.displayName || 'Conversation') : `#${channel.name}`);
  };

  const onSent = (m: Message) => {
    const c = store.state.messages[channelId];
    if (c) {
      if (!c.messages.find((x) => x.id === m.id)) c.messages.push(m);
      c.messages.sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
    }
    store.emit();
    setReplyTo(null); setEditing(null);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    void store.markRead(channelId, m.id);
  };

  return <>
    <div class="channel-header">
      {isDm ? <>
        {dm?.type === 'group_dm' ? <div style={{ display: 'flex' }}><AvatarStack users={others} size={26} max={3} /></div> : <Avatar user={other} size={26} />}
        <div class="ch-title"><span class="truncate">{dm?.type === 'group_dm' ? (dm.name || others.map((o) => o.displayName).join(', ')) : (other?.displayName ?? 'Direct Slop')}</span></div>
        {dm?.type === 'group_dm' ? <span class="faint" style={{ fontSize: 11 }}>{others.length + 1} members</span> : other ? <span class="ch-topic">{other.customStatus || other.status}</span> : null}
      </> : <>
        <div class="ch-title"><Icon name={channel.type === 'forum' ? 'forum' : channel.type === 'announcement' ? 'announcement' : channel.type === 'voice' ? 'volume' : channel.type === 'thread' ? 'thread' : 'hash'} size={20} class="icon" /> <span class="truncate">{channel.name}</span></div>
        {channel.topic ? <span class="ch-topic" title={channel.topic}>{channel.topic}</span> : null}
        {channel.locked ? <span class="badge danger">locked</span> : null}
        {channel.nsfw ? <span class="badge danger">NSFW</span> : null}
      </>}
      <div class="header-actions">
        {!isDm ? <button class="btn-icon" title="Threads" onClick={() => store.updateUi({ rightPanel: { kind: 'threads', channelId } })}><Icon name="thread" size={19} /></button> : null}
        {!isDm ? <button class="btn-icon" title="Pinned messages" onClick={() => store.updateUi({ rightPanel: { kind: 'pins', channelId } })}><Icon name="pin" size={19} /></button> : null}
        <button class="btn-icon" title="Search messages" onClick={() => store.updateUi({ searchOpen: true })}><Icon name="search" size={19} /></button>
        {!isDm ? <button class={`btn-icon ${(isNarrow ? mobileMembers : state.ui.membersOpen) ? 'active' : ''}`} title="Toggle member list" onClick={() => { if (isNarrow) setMobileMembers((v) => !v); else store.updateUi({ membersOpen: !state.ui.membersOpen }); }}><Icon name="users" size={19} /></button> : null}
        {!isDm && channel.type !== 'thread' && channel.serverId ? <button class="btn-icon" title="Channel settings" onClick={() => onOpenSettings()}><Icon name="settings" size={18} /></button> : null}
        <button class="btn-icon" title="More" onClick={headerMenu}><Icon name="more" size={19} /></button>
      </div>
    </div>
    <div class="chat-area">
      <div class="messages-pane">
        {channel.type === 'forum' ? <ForumView channel={channel} /> :
          channel.type === 'voice' ? <VoiceRoom channel={channel} /> :
          <>
            <div class="messages-scroll" ref={scrollRef}>
              <MessageList channel={channel} messages={cache?.messages ?? []} loading={!!cache?.loading} error={cache?.error ?? null} hasMore={!!cache?.hasMore} loaded={!!cache?.loaded}
                lastReadId={state.unread[channelId]?.lastReadId} onLoadMore={() => void store.loadMoreMessages(channelId)}
                onReply={(m) => { setEditing(null); setReplyTo(m); }}
                onEdit={(m) => { if (m.encrypted) { store.toast('Encrypted messages are immutable from this UI. Privacy wins.', 'info', '🔒'); return; } setReplyTo(null); setEditing(m); }}
                onReport={onReport} />
            </div>
            {!atBottom && cache?.loaded ? <button class="btn btn-primary btn-sm" style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 8, boxShadow: 'var(--shadow)' }} onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }}>↓ Jump to present <span class="badge">{store.state.unread[channelId]?.count ?? 0}</span></button> : null}
            <div class="typing-bar" aria-live="polite">
              {typing.length ? <>{typing.slice(0, 3).map((u, i) => <span class="row gap-4" key={u.id}><Avatar user={u as any} size={15} status={false} />{i === 0 ? '' : ', '}<strong style={{ color: 'var(--text-soft)' }}>{u.displayName}</strong></span>)}<span class="typing-dots"><span /><span /><span /></span><span>is typing…</span></> : null}
            </div>
            {sendPerm && !channel.locked && !channel.archived ? <Composer channel={channel} replyTo={replyTo} editing={editing} onSent={onSent} onCancelReply={() => setReplyTo(null)} onCancelEdit={() => setEditing(null)} /> : <div class="composer-wrap"><div class="composer" style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              {!viewPerm ? 'You cannot view this channel. Sneaky.' : channel.locked ? '🔒 This channel is locked. The adults are talking.' : channel.archived ? '🧊 This thread is archived. It had a good run.' : 'You lack permission to send messages here. The audacity.'}
            </div></div>}
          </>}
      </div>
      {!isDm && channel.type !== 'voice' && channel.type !== 'forum' && showMembers && bundle ? <MemberSidebar serverId={bundle.server.id} onClose={() => { if (isNarrow) setMobileMembers(false); else store.updateUi({ membersOpen: false }); }} /> : null}
      {state.ui.rightPanel ? <RightPanels onReport={onReport} /> : null}
    </div>
  </>;
}
