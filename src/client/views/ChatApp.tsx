import { useEffect, useState } from 'preact/hooks';
import { useApp, store } from '../lib/use-store';
import { GuildRail } from '../components/GuildRail';
import { ServerSidebar } from '../components/ServerSidebar';
import { DMSidebar } from '../components/DMSidebar';
import { HomeView } from './HomeView';
import { FriendsView } from './FriendsView';
import { DiscoverView } from './DiscoverView';
import { SavedView } from './SavedView';
import { LeaderboardView } from './LeaderboardView';
import { AchievementsView } from './AchievementsView';
import { ChannelView } from './ChannelView';
import { MenuRoot, Toasts } from '../components/Ui';
import { CreateServerModal } from '../components/modals/CreateServerModal';
import { AddFriendModal } from '../components/modals/AddFriendModal';
import { InviteModal } from '../components/modals/InviteModal';
import { UserSettingsModal } from '../components/modals/UserSettingsModal';
import { ProfilePopover } from '../components/modals/ProfilePopover';
import { SearchModal } from '../components/modals/SearchModal';
import { QuickSwitcher } from '../components/modals/QuickSwitcher';
import { Lightbox } from '../components/modals/Lightbox';
import { ServerSettingsModal } from '../components/modals/ServerSettingsModal';
import { CreateChannelModal } from '../components/modals/CreateChannelModal';
import { ReportModal } from '../components/modals/ReportModal';
import { ensureE2EEKeys } from '../lib/e2ee';

export function ChatApp() {
  const state = useApp();
  const [createServerOpen, setCreateServerOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState<any>(null);
  const [serverSettingsTab, setServerSettingsTab] = useState<string | null>(null);
  const [createChannel, setCreateChannel] = useState<{ parentId?: string; type?: string } | null>(null);

  useEffect(() => {
    if (state.loadingWorkspace) return;
    if (!state.activeServerId && state.view.type === 'home' && state.serverOrder.length && !sessionStorage.getItem('slop-auto-opened')) {
      sessionStorage.setItem('slop-auto-opened', '1');
    }
  }, [state.loadingWorkspace, state.activeServerId, state.view.type, state.serverOrder.length]);

  useEffect(() => {
    if (!state.user) return;
    void ensureE2EEKeys(state.user.id, state.user.publicKey).then((pub) => {
      if (pub && store.state.user && store.state.user.publicKey !== JSON.stringify(pub)) {
        store.state.user = { ...store.state.user, publicKey: JSON.stringify(pub) };
        store.emit();
      }
    });
  }, [state.user?.id]);

  useEffect(() => {
    const openSettings = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setServerSettingsTab(tab);
    };
    const openCreate = () => setCreateServerOpen(true);
    const openFriend = () => setAddFriendOpen(true);
    window.addEventListener('slop:server-settings', openSettings as EventListener);
    window.addEventListener('slop:create-server', openCreate);
    window.addEventListener('slop:add-friend', openFriend);
    return () => {
      window.removeEventListener('slop:server-settings', openSettings as EventListener);
      window.removeEventListener('slop:create-server', openCreate);
      window.removeEventListener('slop:add-friend', openFriend);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); store.updateUi({ quickSwitcherOpen: !state.ui.quickSwitcherOpen }); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && state.activeChannelId) { e.preventDefault(); store.updateUi({ searchOpen: true }); }
      else if (e.key === 'Escape' && !typing) { store.updateUi({ searchOpen: false, quickSwitcherOpen: false, rightPanel: null }); store.closeMenu(); }
      else if (e.key === '/' && !typing && state.activeChannelId) { e.preventDefault(); document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.activeChannelId, state.ui.quickSwitcherOpen]);

  useEffect(() => {
    if (!state.loadingWorkspace && state.user && !state.ui.pendingInvite && location.pathname.startsWith('/invite/')) {
      // Invite path is handled by InviteView; no-op.
    }
  }, [state.loadingWorkspace]);

  useEffect(() => { closeMobileNav(); }, [state.view.type, state.activeChannelId, state.activeServerId]);

  const onOpenSettings = (tab?: string) => setServerSettingsTab(tab ?? 'overview');
  const onInvite = () => setInviteOpen(true);
  const onCreateChannel = (parentId?: string, type?: string) => setCreateChannel({ parentId, type });
  const mobileNavOpen = state.ui.mobileSidebar || state.ui.mobileRail;
  const closeMobileNav = () => store.updateUi({ mobileSidebar: false, mobileRail: false });
  const serverMode = !!state.activeServerId;
  const view = state.view;

  if (state.loadingWorkspace) {
    return <div class="app"><div class="center col" style={{ flex: 1, gap: 14 }}><img src="/static/assets/brand/mascot.svg" alt="" style={{ width: 90, animation: 'float 3s infinite' }} /><div class="spinner" /><p class="muted mono">summoning the workspace…</p></div><MenuRoot /><Toasts /></div>;
  }

  return (
    <div class="app">
      <GuildRail open={state.ui.mobileRail} onCreateServer={() => setCreateServerOpen(true)} />
      {mobileNavOpen ? <button class="mobile-scrim" aria-label="Close navigation" onClick={closeMobileNav} /> : null}
      {serverMode ? <ServerSidebar open={state.ui.mobileSidebar} onOpenSettings={onOpenSettings} onInvite={onInvite} onCreateChannel={onCreateChannel} /> : <DMSidebar open={state.ui.mobileSidebar} onAddFriend={() => setAddFriendOpen(true)} />}
      <div class="main-pane">
        <div class="mobile-bar">
          <button class={`btn-icon ${mobileNavOpen ? 'active' : ''}`} onClick={() => store.updateUi({ mobileSidebar: !mobileNavOpen, mobileRail: !mobileNavOpen })} title="Menu"><Icon name="menu" size={19} /></button>
          <span class="mobile-title">{serverMode ? state.servers[state.activeServerId!]?.server.name : 'Slop HQ'}</span>
          <button class="btn-icon" onClick={() => store.updateUi({ quickSwitcherOpen: true })}><Icon name="search" size={18} /></button>
        </div>
        {serverMode && state.activeChannelId ? <ChannelView onReport={setReportMessage} onOpenSettings={() => onOpenSettings('overview')} /> :
          serverMode ? <EmptyServer onCreateChannel={() => onCreateChannel(undefined, 'text')} /> :
          view.type === 'dm' && state.activeChannelId ? <ChannelView onReport={setReportMessage} onOpenSettings={() => {}} /> :
          view.type === 'friends' ? <FriendsView onAddFriend={() => setAddFriendOpen(true)} /> :
          view.type === 'discover' ? <DiscoverView /> :
          view.type === 'saved' ? <SavedView /> :
          view.type === 'leaderboard' ? <LeaderboardView /> :
          view.type === 'achievements' ? <AchievementsView /> :
          <HomeView onCreateServer={() => setCreateServerOpen(true)} onAddFriend={() => setAddFriendOpen(true)} />}
      </div>
      {state.ui.userSettingsOpen ? <UserSettingsModal onClose={() => store.updateUi({ userSettingsOpen: false })} /> : null}
      {serverSettingsTab ? <ServerSettingsModal initialTab={serverSettingsTab} onClose={() => setServerSettingsTab(null)} /> : null}
      {state.ui.profile || state.ui.profileLoading ? <ProfilePopover /> : null}
      {state.ui.lightbox ? <Lightbox /> : null}
      {state.ui.searchOpen ? <SearchModal /> : null}
      {state.ui.quickSwitcherOpen ? <QuickSwitcher /> : null}
      {reportMessage ? <ReportModal message={reportMessage} onClose={() => setReportMessage(null)} /> : null}
      <CreateServerModal open={createServerOpen} onClose={() => setCreateServerOpen(false)} />
      <AddFriendModal open={addFriendOpen} onClose={() => setAddFriendOpen(false)} />
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <CreateChannelModal open={!!createChannel} parentId={createChannel?.parentId} initialType={createChannel?.type} onClose={() => setCreateChannel(null)} />
      <MenuRoot />
      <Toasts />
    </div>
  );
}

function EmptyServer({ onCreateChannel }: { onCreateChannel: () => void }) {
  return <div class="center col" style={{ flex: 1, gap: 12, textAlign: 'center', padding: 20 }}>
    <img src="/static/assets/memes/brain-empty.svg" alt="" style={{ width: 240, borderRadius: 10 }} />
    <h2>No channels. No thoughts.</h2>
    <p class="muted">Create a channel before the void notices.</p>
    <button class="btn btn-primary" onClick={onCreateChannel}>Create channel</button>
  </div>;
}

import { Icon } from '../components/Icons';
