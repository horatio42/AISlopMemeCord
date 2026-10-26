import { Avatar, BarChart, Empty, ErrorNote, HealthSummary, Icon, Loading, PageHead, Panel, StatCard, TimeCell } from '../ui';
import type { AdminUser, Overview } from '../types';
import { fmtSize } from '../../lib/format';
import { actionLabel, actionTone, changeSummary } from '../display';

export function DashboardPage(props: {
  admin: AdminUser;
  overview: Overview | null;
  loading: boolean;
  error: string | null;
  refreshBusy: boolean;
  onRefresh: () => void;
  navigate: (page: string) => void;
}) {
  const { overview } = props;
  if (props.error && !overview) return <div class="admin-content"><ErrorNote message={props.error} /><button class="btn" onClick={props.onRefresh}>Try again</button></div>;
  if (!overview && props.loading) return <div class="admin-content"><Loading label="Assembling the dashboard of mild concern…" /></div>;
  if (!overview) return <div class="admin-content"><Empty title="No dashboard telemetry" emoji="📉">The overview endpoint returned nothing. Which is technically privacy-first.</Empty></div>;

  const c = overview.counts;
  return (
    <div class="admin-content">
      <PageHead
        title="Dashboard"
        subtitle={<>A calm, corporate view of the slop. No telemetry leaves this box; everything here is local and audited.</>}
        actions={
          <button class="btn btn-primary" onClick={props.onRefresh} disabled={props.refreshBusy} aria-label="Refresh dashboard">
            {props.refreshBusy ? <span class="spinner" style={{ width: 14, height: 14 }} /> : <Icon name="refresh" size={15} />}
            Refresh
          </button>
        }
      />
      <ErrorNote message={props.error} />

      <div class="admin-stat-grid">
        <StatCard label="Users" value={c.users.toLocaleString()} sub={`${c.sessions.toLocaleString()} active sessions`} icon="users" />
        <StatCard label="Servers" value={c.servers.toLocaleString()} sub={`${c.channels.toLocaleString()} channels`} icon="home" />
        <StatCard label="Messages" value={c.messages.toLocaleString()} sub="Not deleted, not proud" icon="thread" />
        <StatCard label="Stored media" value={fmtSize(overview.storageBytes)} sub={`${c.uploads.toLocaleString()} uploads`} icon="file" />
        <StatCard label="Open reports" value={c.openReports.toLocaleString()} sub={c.openReports ? 'Needs a janitor' : 'Queue is spotless'} icon="gavel" />
        <StatCard label="Online now" value={overview.onlineCount.toLocaleString()} sub="Live gateway sockets" icon="heart" />
      </div>

      <div class="admin-grid-2 admin-dashboard-charts">
        <Panel title="Signups — last 14 days" actions={<span class="admin-panel-note">UTC days</span>}>
          <BarChart points={overview.signups} label="Daily signups" />
        </Panel>
        <Panel title="Messages — last 14 days" actions={<span class="admin-panel-note">deleted excluded</span>}>
          <BarChart points={overview.messages} label="Daily messages" tone="message" />
        </Panel>
      </div>

      <div class="admin-grid-2">
        <Panel title="Top servers" actions={<button class="btn btn-xs" onClick={() => props.navigate('servers')}>Manage servers <Icon name="chevronRight" size={13} /></button>}>
          {overview.topServers.length ? (
            <ul class="admin-list">
              {overview.topServers.map((s) => (
                <li key={s.id}>
                  <button class="admin-list-row" onClick={() => props.navigate('servers')} aria-label={`Open ${s.name} in servers`}>
                    <span class="admin-server-icon" aria-hidden="true">{s.icon ? <img src={s.icon} alt="" /> : s.name.slice(0, 1).toUpperCase()}</span>
                    <span class="grow truncate">{s.name}</span>
                    <span class="admin-metric">{s.memberCount.toLocaleString()} members</span>
                    <Icon name="chevronRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty emoji="🏚️" title="No servers yet">The void is serverless.</Empty>}
        </Panel>

        <Panel title="Recent audit — instance wide" actions={<button class="btn btn-xs" onClick={() => props.navigate('audit')}>Full audit log <Icon name="chevronRight" size={13} /></button>}>
          {overview.recentAudit.length ? (
            <ul class="admin-audit-mini">
              {overview.recentAudit.map((entry) => (
                <li key={entry.id}>
                  <span class={`admin-audit-dot ${actionTone(entry.action)}`} aria-hidden="true" />
                  <Avatar user={entry.actor} size={24} status={false} />
                  <div class="grow min-w-0">
                    <div class="truncate"><strong>{actionLabel(entry.action)}</strong>{entry.targetType ? <span class="muted"> · {entry.targetType}</span> : null}</div>
                    <div class="admin-audit-sub truncate">
                      {entry.actor ? entry.actor.displayName : 'system'} · {changeSummary(entry.changes) || entry.reason || 'no extra detail'}
                    </div>
                  </div>
                  <TimeCell ts={entry.createdAt} />
                </li>
              ))}
            </ul>
          ) : <Empty emoji="🧾" title="Audit log is empty">Suspiciously clean. The audit goblin is watching.</Empty>}
        </Panel>
      </div>

      <div class="admin-grid-2">
        <Panel
          title="Instance health"
          actions={<button class="btn btn-xs" onClick={() => props.navigate('logs')}>Logs &amp; health <Icon name="chevronRight" size={13} /></button>}
        >
          <HealthSummary health={overview.health} compact />
        </Panel>
        <Panel title="Things you can do" class="admin-card-warning">
          <p class="admin-copy">
            Every action in this console writes an audit entry with your name on it. There is no telemetry, no external fetch,
            and no “undo” button. The slop is watching back.
          </p>
          <div class="admin-quick-actions">
            <button class="btn btn-sm" onClick={() => props.navigate('reports')}><Icon name="gavel" size={14} /> Triage reports {c.openReports ? <span class="badge danger">{c.openReports}</span> : null}</button>
            <button class="btn btn-sm" onClick={() => props.navigate('users')}><Icon name="users" size={14} /> Manage users</button>
            <button class="btn btn-sm" onClick={() => props.navigate('settings')}><Icon name="settings" size={14} /> Instance settings</button>
            <button class="btn btn-sm" onClick={() => props.navigate('maintenance')}><Icon name="download" size={14} /> Backup &amp; maintenance</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
