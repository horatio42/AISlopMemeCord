import { useEffect, useState } from 'preact/hooks';
import { Modal, Spinner } from '../Ui';
import { Icon } from '../Icons';
import { store, useApp } from '../../lib/use-store';
import { can, isOwner } from '../../lib/permissions';
import { Perm } from '../../../shared/permissions';
import { SettingsError, SettingsNotice } from './settings/server/shared';
import { OverviewTab } from './settings/server/OverviewTab';
import { RolesTab } from './settings/server/RolesTab';
import { ChannelsTab } from './settings/server/ChannelsTab';
import { MembersTab } from './settings/server/MembersTab';
import { InvitesTab } from './settings/server/InvitesTab';
import { AssetsTab } from './settings/server/AssetsTab';
import { EventsTab } from './settings/server/EventsTab';
import { WebhooksTab } from './settings/server/WebhooksTab';
import { ModerationTab } from './settings/server/ModerationTab';
import { AuditTab } from './settings/server/AuditTab';
import { DangerTab } from './settings/server/DangerTab';

type Tab = 'overview' | 'roles' | 'channels' | 'members' | 'invites' | 'assets' | 'events' | 'webhooks' | 'moderation' | 'audit' | 'danger';

interface Parsed { tab: Tab; param?: string }

const TAB_IDS: Tab[] = ['overview', 'roles', 'channels', 'members', 'invites', 'assets', 'events', 'webhooks', 'moderation', 'audit', 'danger'];

export function parseSettingsTab(raw: string | undefined | null): Parsed {
  if (!raw) return { tab: 'overview' };
  if (raw.startsWith('channel:')) return { tab: 'channels', param: raw.slice('channel:'.length) };
  if (raw.startsWith('members:')) return { tab: 'members', param: raw.slice('members:'.length) };
  if (raw === 'emoji') return { tab: 'assets' };
  if (TAB_IDS.includes(raw as Tab)) return { tab: raw as Tab };
  return { tab: 'overview' };
}

export function ServerSettingsModal({ initialTab, onClose }: { initialTab: string; onClose: () => void }) {
  const state = useApp();
  const serverId = state.activeServerId;
  const bundle = serverId ? state.servers[serverId] ?? null : null;
  const [tab, setTab] = useState<Tab>(() => parseSettingsTab(initialTab).tab);
  const [param, setParam] = useState<string | undefined>(() => parseSettingsTab(initialTab).param);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const parsed = parseSettingsTab(initialTab);
    setTab(parsed.tab);
    setParam(parsed.param);
    // A fresh deep-link target should not be overwritten by an old selection.
  }, [initialTab]);

  useEffect(() => {
    if (!serverId) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    void Promise.all([
      store.loadServer(serverId, { force: true }),
      store.loadMembers(serverId),
    ]).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [serverId]);

  if (!serverId) {
    return <Modal open onClose={onClose} title="Server settings" xwide>
      <div class="settings-shell"><div class="settings-content"><SettingsError message="No server is selected. Pick a server, then open its settings." /></div></div>
    </Modal>;
  }

  const nav: { group: string; items: { id: Tab; label: string; icon: string; locked?: boolean; danger?: boolean }[] }[] = [
    { group: 'Server', items: [
      { id: 'overview', label: 'Overview', icon: 'settings', locked: !can(state, Perm.MANAGE_SERVER, serverId) },
      { id: 'roles', label: 'Roles', icon: 'shield', locked: !can(state, Perm.MANAGE_ROLES, serverId) },
      { id: 'channels', label: 'Channels', icon: 'hash', locked: !can(state, Perm.MANAGE_CHANNELS, serverId) },
      { id: 'members', label: 'Members', icon: 'users' },
      { id: 'invites', label: 'Invites', icon: 'link', locked: !(can(state, Perm.MANAGE_SERVER, serverId) || can(state, Perm.CREATE_INVITES, serverId)) },
      { id: 'assets', label: 'Emojis & assets', icon: 'smile', locked: !can(state, Perm.MANAGE_EMOJIS, serverId) },
      { id: 'events', label: 'Events', icon: 'star' },
    ] },
    { group: 'Integrations & safety', items: [
      { id: 'webhooks', label: 'Webhooks', icon: 'robot', locked: !can(state, Perm.MANAGE_SERVER, serverId) },
      { id: 'moderation', label: 'Moderation', icon: 'gavel' },
      { id: 'audit', label: 'Audit log', icon: 'file', locked: !can(state, Perm.VIEW_AUDIT_LOG, serverId) },
    ] },
    { group: 'Danger', items: [
      { id: 'danger', label: 'Danger zone', icon: 'skull', locked: !isOwner(state, serverId), danger: true },
    ] },
  ];

  const navigate = (next: Tab) => {
    setTab(next);
    setParam(undefined);
  };

  const renderTab = () => {
    if (loading && !bundle) return <div class="srv-loading"><Spinner /><span class="muted">Loading server machinery…</span></div>;
    if (!bundle) return <SettingsError message="This server vanished while the modal was loading. Was it ever real?" />;
    switch (tab) {
      case 'overview': return <OverviewTab serverId={serverId} onNavigate={(t) => navigate(t as Tab)} />;
      case 'roles': return <RolesTab serverId={serverId} />;
      case 'channels': return <ChannelsTab serverId={serverId} initialChannelId={param} />;
      case 'members': return <MembersTab serverId={serverId} initialUserId={param} />;
      case 'invites': return <InvitesTab serverId={serverId} />;
      case 'assets': return <AssetsTab serverId={serverId} />;
      case 'events': return <EventsTab serverId={serverId} />;
      case 'webhooks': return <WebhooksTab serverId={serverId} />;
      case 'moderation': return <ModerationTab serverId={serverId} />;
      case 'audit': return <AuditTab serverId={serverId} />;
      case 'danger': return <DangerTab serverId={serverId} onClose={onClose} />;
      default: return null;
    }
  };

  return <Modal
    open
    onClose={onClose}
    xwide
    title={bundle
      ? <span class="row gap-8"><span class="srv-modal-title-icon">{bundle.server.icon ? <img src={bundle.server.icon} alt="" /> : bundle.server.name.charAt(0).toUpperCase()}</span><span>{bundle.server.name} <span class="muted" style={{ fontWeight: 500 }}>— settings</span></span></span>
      : <span class="row gap-8"><Icon name="settings" size={20} /> Server settings</span>}
  >
    <div class="settings-shell srv-settings-shell" style={{ minHeight: 0, flex: 1 }}>
      <nav class="settings-nav srv-settings-nav" aria-label="Server settings sections">
        {nav.map((group) => <div key={group.group}>
          <div class="settings-group">{group.group}</div>
          {group.items.map((item) => <button
            key={item.id}
            class={`${tab === item.id ? 'active' : ''} ${item.danger ? 'srv-nav-danger' : ''}`}
            onClick={() => navigate(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
          >
            <Icon name={item.icon} size={15} />
            <span class="grow">{item.label}</span>
            {item.locked ? <Icon name="lock" size={11} class="faint" title="Limited permissions" /> : null}
          </button>)}
        </div>)}
        <div class="srv-nav-footer">
          <button onClick={() => { void store.loadServer(serverId, { force: true }); void store.loadMembers(serverId); store.toast('Server data reloaded from the source.', 'info', '🔄'); }}>
            <Icon name="refresh" size={14} /> Reload server data
          </button>
        </div>
      </nav>
      <div class="settings-content srv-settings-content">
        {loading && bundle ? <div class="srv-reloading"><Spinner size={14} /> refreshing…</div> : null}
        {!bundle && !loading ? <SettingsNotice kind="warn">The server bundle is empty. Try reloading; the void may be temporary.</SettingsNotice> : null}
        {renderTab()}
      </div>
    </div>
  </Modal>;
}
