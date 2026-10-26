import { useEffect, useState } from 'preact/hooks';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import type { AdminServerListItem, AdminUserListItem, AuditEntry, Paged } from '../types';
import {
  Avatar, Empty, ErrorNote, Icon, PageHead, Pager, SkeletonRows, TimeCell, useDebounced, useLoad,
} from '../ui';
import { actionLabel, actionTone, changeSummary } from '../display';

const PAGE_SIZE = 50;

export function AuditPage(props: { navigate: (page: string) => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const [serverId, setServerId] = useState('');
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [query, serverId, actorId]);

  const servers = useLoad(
    (signal) => api.get<Paged<{ servers: AdminServerListItem[] }>>('/api/admin/servers?limit=100', { signal }),
    [],
  );
  const users = useLoad(
    (signal) => api.get<Paged<{ users: AdminUserListItem[] }>>('/api/admin/users?limit=100', { signal }),
    [],
  );
  const audit = useLoad(
    (signal) => api.get<Paged<{ entries: AuditEntry[] }>>(`/api/admin/audit${qs({ query, serverId, actorId, page, limit: PAGE_SIZE })}`, { signal }),
    [query, serverId, actorId, page],
  );

  const entries = audit.data?.entries ?? [];
  const total = audit.data?.total ?? 0;

  return (
    <div class="admin-content">
      <PageHead
        title="Audit log"
        subtitle={<>Every moderation or administrative act, with fingerprints. {total.toLocaleString()} entries match.</>}
        actions={<button class="btn" onClick={audit.reload} disabled={audit.loading}><Icon name="refresh" size={15} /> Refresh</button>}
      />
      <ErrorNote message={audit.error} />

      <div class="admin-toolbar">
        <div class="admin-search">
          <Icon name="search" size={15} />
          <input class="input" type="search" placeholder="Search action, reason, target ID or actor…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search audit log" />
        </div>
        <select class="select" value={serverId} onChange={(e) => setServerId((e.target as HTMLSelectElement).value)} aria-label="Filter by server">
          <option value="">All servers</option>
          {(servers.data?.servers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select class="select" value={actorId} onChange={(e) => setActorId((e.target as HTMLSelectElement).value)} aria-label="Filter by actor">
          <option value="">All actors</option>
          {(users.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>)}
        </select>
        {(serverId || actorId || q) ? <button class="btn btn-sm btn-ghost" onClick={() => { setQ(''); setServerId(''); setActorId(''); }}>Clear filters</button> : null}
      </div>
      <ErrorNote message={servers.error || users.error} />

      <div class="admin-table-wrap">
        {audit.loading && !audit.data ? <SkeletonRows rows={9} cols={5} /> : entries.length === 0 && !audit.loading ? (
          <Empty emoji="🧾" title="No audit entries">Nothing matches. The audit goblin is either asleep or impressed.</Empty>
        ) : (
          <table class="table admin-table admin-audit-table" aria-label="Audit entries">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Context</th><th>Detail</th></tr>
            </thead>
            <tbody class={audit.loading ? 'is-refreshing' : ''}>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td class="admin-nowrap"><TimeCell ts={entry.createdAt} /></td>
                  <td>
                    {entry.actor ? (
                      <button class="admin-actor-link" onClick={() => props.navigate('users')} title={`${entry.actor.displayName} (@${entry.actor.username})`}>
                        <Avatar user={entry.actor} size={24} status={false} />
                        <span>@{entry.actor.username}</span>
                      </button>
                    ) : <span class="muted">system</span>}
                  </td>
                  <td><span class={`admin-action-tag ${actionTone(entry.action)}`}>{actionLabel(entry.action)}</span><div class="admin-mono-small">{entry.action}</div></td>
                  <td><span class="admin-target">{entry.targetType}{entry.targetId ? <code class="admin-code-inline">{entry.targetId}</code> : null}</span></td>
                  <td>{entry.serverName ? <span class="admin-report-context"><Icon name="home" size={12} /> {entry.serverName}</span> : <span class="muted">instance</span>}</td>
                  <td class="admin-detail-cell">
                    {entry.reason ? <div class="admin-audit-reason">{entry.reason}</div> : null}
                    {entry.changes ? (
                      <details class="admin-changes">
                        <summary>{changeSummary(entry.changes) || 'View changes'}</summary>
                        <pre>{JSON.stringify(entry.changes, null, 2)}</pre>
                      </details>
                    ) : !entry.reason ? <span class="muted">—</span> : null}
                    <div class="admin-mono-small">{fmtDateTime(entry.createdAt)} · {entry.id}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pager page={page} total={total} limit={PAGE_SIZE} onPage={setPage} loading={audit.loading} />
    </div>
  );
}
