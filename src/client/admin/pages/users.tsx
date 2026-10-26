import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, qs } from '../../lib/api';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import type { AdminUserDetail, AdminUserListItem, Paged } from '../types';
import {
  Avatar, ConfirmDialog, CopyButton, Empty, ErrorNote, Field, Icon, Loading, Modal, PageHead,
  Panel, Pager, SkeletonRows, StatusPills, SuccessNote, TimeCell, UserCell, useDebounced, useLoad,
} from '../ui';
import { actionLabel } from '../display';

const PAGE_SIZE = 25;

export function UsersPage(props: { adminId: string; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [query, filter]);

  const list = useLoad(
    (signal) => api.get<Paged<{ users: AdminUserListItem[] }>>(`/api/admin/users${qs({ query, filter, page, limit: PAGE_SIZE })}`, { signal }),
    [query, filter, page],
  );

  const rows = list.data?.users ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div class="admin-content">
      <PageHead
        title="Users"
        subtitle={<>Every goblin in the instance: {total.toLocaleString()} account{total === 1 ? '' : 's'} matching the current filter.</>}
        actions={
          <button class="btn" onClick={list.reload} disabled={list.loading} aria-label="Refresh users">
            <Icon name="refresh" size={15} /> Refresh
          </button>
        }
      />
      <ErrorNote message={list.error} />

      <div class="admin-toolbar">
        <div class="admin-search">
          <Icon name="search" size={15} />
          <input
            class="input"
            type="search"
            placeholder="Search username or display name…"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            aria-label="Search users"
          />
        </div>
        <select class="select" value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)} aria-label="Filter users">
          <option value="all">All users</option>
          <option value="admin">Admins</option>
          <option value="banned">Suspended</option>
          <option value="disabled">Disabled</option>
        </select>
        {list.loading ? <span class="admin-inline-loading"><span class="spinner" /> Updating…</span> : null}
      </div>

      <div class="admin-table-wrap">
        {list.loading && !list.data ? <SkeletonRows rows={8} cols={6} /> : rows.length === 0 && !list.loading ? (
          <Empty emoji="🕳️" title="No users match">The filter found nothing. Either the slop is clean or your query is too specific.</Empty>
        ) : (
          <table class="table admin-table" aria-label="Instance users">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Karma</th>
                <th>Servers</th>
                <th>Messages</th>
                <th>Last seen</th>
                <th><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody class={list.loading ? 'is-refreshing' : ''}>
              {rows.map((u) => (
                <tr key={u.id} class="admin-row-click" onClick={() => setSelectedId(u.id)}>
                  <td><UserCell user={{ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar }} /></td>
                  <td><StatusPills isAdmin={u.isAdmin} disabled={u.disabled} bannedUntil={u.bannedUntil} /></td>
                  <td title={`${u.karma} karma`}>{u.karma.toLocaleString()}</td>
                  <td>{u.serverCount.toLocaleString()}</td>
                  <td>{u.messageCount.toLocaleString()}</td>
                  <td><TimeCell ts={u.lastSeenAt} /></td>
                  <td class="actions">
                    <button class="btn btn-xs" onClick={(e) => { e.stopPropagation(); setSelectedId(u.id); }} aria-label={`Open details for ${u.displayName}`}>
                      Details <Icon name="chevronRight" size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pager page={page} total={total} limit={PAGE_SIZE} onPage={setPage} loading={list.loading} />

      <UserDrawer
        id={selectedId}
        adminId={props.adminId}
        onClose={() => setSelectedId(null)}
        onListChanged={() => { list.reload(); props.onChanged(); }}
        onGone={() => { setSelectedId(null); list.reload(); props.onChanged(); }}
      />
    </div>
  );
}

function UserDrawer(props: {
  id: string | null;
  adminId: string;
  onClose: () => void;
  onListChanged: () => void;
  onGone: () => void;
}) {
  const detail = useLoad(
    (signal) => props.id ? api.get<AdminUserDetail>(`/api/admin/users/${props.id}`, { signal }) : Promise.resolve(null),
    [props.id],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [suspendUntil, setSuspendUntil] = useState(defaultSuspendValue());
  const [banReason, setBanReason] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const data = detail.data;
  const user = data?.user;

  useEffect(() => {
    if (!data) return;
    setDisplayName(data.user.displayName);
    setBio(data.user.bio ?? '');
  }, [data?.user.id]);

  useEffect(() => {
    if (!data) return;
    setBanReason(data.user.banReason ?? '');
  }, [data?.user.id, data?.user.bannedUntil, data?.user.banReason]);

  useEffect(() => {
    if (!props.id) {
      setActionError(null);
      setFeedback(null);
      setTempPassword(null);
      setConfirmDelete(false);
    }
  }, [props.id]);

  async function run(name: string, fn: () => Promise<string | void>) {
    setBusy(name);
    setActionError(null);
    setFeedback(null);
    try {
      const message = await fn();
      if (message) setFeedback(message);
      detail.reload();
      props.onListChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const isSelf = !!user && user.id === props.adminId;
  const suspended = !!user?.bannedUntil && user.bannedUntil > Date.now();

  return (
    <>
      <Modal
        open={props.id !== null}
        onClose={() => { if (!busy) props.onClose(); }}
        title={user ? <span class="admin-drawer-title"><Avatar user={user} size={30} status={false} /> {user.displayName} <span class="muted">@{user.username}</span></span> : 'User details'}
        wide
        footer={<button class="btn" onClick={props.onClose} disabled={!!busy}>Close</button>}
      >
        <div class="modal-body admin-drawer">
          <ErrorNote message={actionError} />
          <SuccessNote message={feedback} />
          {detail.error ? <ErrorNote message={detail.error} onDismiss={detail.reload} /> : null}
          {detail.loading && !data ? <Loading label="Fetching the user dossier…" /> : !data || !user ? (
            detail.error ? null : <Empty emoji="👻" title="User vanished" />
          ) : (
            <>
              <div class="admin-drawer-summary">
                <div><span class="admin-kicker">Joined</span> {fmtDateTime(user.createdAt)}</div>
                <div><span class="admin-kicker">Last seen</span> {fmtRelative(user.lastSeenAt)}</div>
                <div><span class="admin-kicker">Karma</span> {user.karma.toLocaleString()}</div>
                <div><span class="admin-kicker">Messages</span> {data.messageCount.toLocaleString()}</div>
                <div><span class="admin-kicker">Uploads</span> {data.uploads.toLocaleString()}</div>
                <div><span class="admin-kicker">Sessions</span> {data.sessions.toLocaleString()}</div>
                <div><span class="admin-kicker">2FA</span> {user.hasTotp ? 'Enabled' : 'Off'}</div>
                <div><span class="admin-kicker">User ID</span> <code>{user.id}</code></div>
              </div>
              <div class="admin-pills" style={{ marginBottom: 16 }}>
                <StatusPills isAdmin={user.isAdmin} disabled={user.disabled} bannedUntil={user.bannedUntil} />
                {user.isBot ? <span class="admin-pill">Bot</span> : null}
                {suspended ? <span class="admin-pill banned">Until {fmtDateTime(user.bannedUntil!)}</span> : null}
                {isSelf ? <span class="admin-pill">This is you</span> : null}
              </div>

              <div class="admin-action-grid">
                <div class="admin-action-block">
                  <h3>Access &amp; sanctions</h3>
                  <p class="admin-hint">Admin powers are instance-wide. Sanctions revoke active sessions immediately.</p>
                  <div class="admin-btn-row">
                    <button
                      class="btn btn-sm"
                      disabled={!!busy || isSelf || user.disabled}
                      title={isSelf ? 'You cannot demote yourself' : undefined}
                      onClick={() => run('admin', async () => {
                        await api.patch(`/api/admin/users/${user.id}`, { isAdmin: !user.isAdmin });
                        return user.isAdmin ? 'Admin rights removed.' : 'Promoted to instance admin.';
                      })}
                    >
                      {busy === 'admin' ? <span class="spinner" /> : <Icon name="shield" size={14} />}
                      {user.isAdmin ? 'Demote admin' : 'Promote to admin'}
                    </button>
                    <button
                      class="btn btn-sm"
                      disabled={!!busy || isSelf}
                      title={isSelf ? 'You cannot disable yourself' : undefined}
                      onClick={() => run('disabled', async () => {
                        await api.patch(`/api/admin/users/${user.id}`, { disabled: !user.disabled });
                        return user.disabled ? 'Account re-enabled.' : 'Account disabled and sessions revoked.';
                      })}
                    >
                      {busy === 'disabled' ? <span class="spinner" /> : <Icon name="lock" size={14} />}
                      {user.disabled ? 'Enable account' : 'Disable account'}
                    </button>
                    <button
                      class="btn btn-sm"
                      disabled={!!busy}
                      onClick={() => run('revoke', async () => {
                        const res = await api.post<{ revoked: number }>(`/api/admin/users/${user.id}/revoke-sessions`);
                        return `Revoked ${res.revoked} session${res.revoked === 1 ? '' : 's'}.`;
                      })}
                    >
                      {busy === 'revoke' ? <span class="spinner" /> : <Icon name="logout" size={14} />} Revoke sessions
                    </button>
                  </div>

                  <form class="admin-suspend-form" onSubmit={(e) => {
                    e.preventDefault();
                    run('suspend', async () => {
                      const ms = new Date(suspendUntil).getTime();
                      if (!Number.isFinite(ms)) throw new Error('Pick a valid suspension end date.');
                      if (ms <= Date.now()) throw new Error('Suspension must end in the future. Time travel is an enterprise feature.');
                      await api.patch(`/api/admin/users/${user.id}`, { bannedUntil: ms, banReason: banReason.trim() || null });
                      return 'User suspended until ' + fmtDateTime(ms) + '.';
                    });
                  }}>
                    <Field label="Suspend until">
                      <input class="input" type="datetime-local" value={suspendUntil} onInput={(e) => setSuspendUntil((e.target as HTMLInputElement).value)} aria-label="Suspension end date and time" />
                    </Field>
                    <Field label="Reason (optional, shown to the user)">
                      <input class="input" maxLength={500} value={banReason} onInput={(e) => setBanReason((e.target as HTMLInputElement).value)} placeholder="e.g. excessive slop in #general" aria-label="Suspension reason" />
                    </Field>
                    <button class="btn btn-sm btn-outline" disabled={!!busy}>
                      {busy === 'suspend' ? <span class="spinner" /> : <Icon name="ban" size={14} />} Apply suspension
                    </button>
                    {suspended ? (
                      <button type="button" class="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => run('unsuspend', async () => {
                        await api.patch(`/api/admin/users/${user.id}`, { bannedUntil: null, banReason: null });
                        return 'Suspension lifted.';
                      })}>Lift suspension</button>
                    ) : null}
                  </form>
                </div>

                <div class="admin-action-block">
                  <h3>Profile</h3>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    run('profile', async () => {
                      await api.patch(`/api/admin/users/${user.id}`, { displayName, bio });
                      return 'Profile updated.';
                    });
                  }}>
                    <Field label="Display name" hint="1–32 characters by server rules.">
                      <input class="input" value={displayName} maxLength={32} onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)} aria-label="Display name" />
                    </Field>
                    <Field label="Bio" hint="500 characters max. Admin edits are audited.">
                      <textarea class="textarea" rows={3} maxLength={500} value={bio} onInput={(e) => setBio((e.target as HTMLTextAreaElement).value)} aria-label="Bio" />
                    </Field>
                    <button class="btn btn-sm btn-primary" disabled={!!busy}>
                      {busy === 'profile' ? <span class="spinner" /> : <Icon name="check" size={14} />} Save profile
                    </button>
                  </form>

                  <h3 style={{ marginTop: 20 }}>Password</h3>
                  <p class="admin-hint">Resets the password, revokes every session and shows a one-time temporary password.</p>
                  <button class="btn btn-sm btn-danger" disabled={!!busy} onClick={() => run('password', async () => {
                    const res = await api.post<{ temporaryPassword: string }>(`/api/admin/users/${user.id}/reset-password`);
                    setTempPassword(res.temporaryPassword);
                    return 'Password reset. Hand the temp code to the user out-of-band.';
                  })}>
                    {busy === 'password' ? <span class="spinner" /> : <Icon name="lock" size={14} />} Reset password
                  </button>
                </div>
              </div>

              <div class="admin-grid-2">
                <Panel title={`Servers (${data.servers.length})`}>
                  {data.servers.length ? (
                    <ul class="admin-list dense">
                      {data.servers.map((s) => (
                        <li key={s.id}>
                          <div class="admin-list-row static">
                            <span class="admin-server-icon" aria-hidden="true">{s.icon ? <img src={s.icon} alt="" /> : s.name.slice(0, 1).toUpperCase()}</span>
                            <span class="grow truncate">{s.name}{s.nickname ? <span class="muted"> as {s.nickname}</span> : null}</span>
                            {s.isOwner ? <span class="admin-pill admin"><Icon name="crown" size={10} /> Owner</span> : null}
                            <span class="admin-metric">{s.memberCount} members</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty emoji="🚪" title="No servers">This user has touched exactly zero grass.</Empty>}
                </Panel>
                <Panel title={`Achievements (${data.achievements.length})`}>
                  {data.achievements.length ? (
                    <ul class="admin-achievements">
                      {data.achievements.map((a) => (
                        <li key={a.key}>
                          <span class="admin-achievement-emoji" aria-hidden="true">{a.emoji}</span>
                          <div>
                            <div><strong>{a.name}</strong></div>
                            <div class="admin-hint">{a.description || 'No description. Mysterious.'} · {fmtRelative(a.earnedAt)}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty emoji="🏆" title="No achievements">The trophy cabinet is empty. Sad, but efficient.</Empty>}
                </Panel>
              </div>

              <Panel title="Recent audit touching this user" class="admin-panel-flush">
                {data.recentAudit.length ? (
                  <ul class="admin-audit-mini">
                    {data.recentAudit.map((entry) => (
                      <li key={entry.id}>
                        <Avatar user={entry.actor} size={22} status={false} />
                        <div class="grow min-w-0">
                          <div class="truncate">{actionLabel(entry.action)} {entry.targetId ? <code class="admin-code-inline">{entry.targetId}</code> : null}</div>
                          <div class="admin-audit-sub truncate">{entry.reason || 'No reason recorded'}</div>
                        </div>
                        <TimeCell ts={entry.createdAt} />
                      </li>
                    ))}
                  </ul>
                ) : <p class="admin-hint">No audit entries mention this user yet.</p>}
              </Panel>

              <div class="admin-danger-zone">
                <div>
                  <h3>Delete user</h3>
                  <p class="admin-hint">Hard delete. Owned servers are deleted too. This cannot be undone and will be audited.</p>
                </div>
                <button class="btn btn-danger" disabled={!!busy || isSelf} onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={15} /> Delete user
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this user?"
        danger
        confirmLabel="Delete permanently"
        expected={user?.username}
        busy={busy === 'delete'}
        error={actionError}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => run('delete', async () => {
          await api.del(`/api/admin/users/${user!.id}`);
          setConfirmDelete(false);
          props.onGone();
        })}
      >
        <p><strong>{user?.displayName}</strong> (@{user?.username}) will be deleted, along with any servers they own. Their messages may remain as ghost echoes depending on the schema's mood.</p>
      </ConfirmDialog>

      <Modal
        open={tempPassword !== null}
        onClose={() => setTempPassword(null)}
        title="Temporary password issued"
        small
        footer={<button class="btn btn-primary" onClick={() => setTempPassword(null)}>Done</button>}
      >
        <div class="modal-body">
          <p class="admin-copy">Give this to <strong>@{user?.username}</strong> through a channel you trust. It will not be shown again, and every existing session was revoked.</p>
          <div class="admin-temp-password">
            <code>{tempPassword}</code>
            {tempPassword ? <CopyButton value={tempPassword} label="Copy password" /> : null}
          </div>
          <ErrorNote message="This value is not stored in plaintext anywhere. Copy it now." />
        </div>
      </Modal>
    </>
  );
}

function defaultSuspendValue(): string {
  const d = new Date(Date.now() + 24 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
