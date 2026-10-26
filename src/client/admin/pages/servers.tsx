import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, qs } from '../../lib/api';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import type { Channel } from '../../../shared/types';
import type { AdminServerDetail, AdminServerListItem, AdminUserListItem, Paged } from '../types';
import {
  ConfirmDialog, Empty, ErrorNote, Field, Icon, Loading, Modal, PageHead, Panel, Pager,
  SkeletonRows, SuccessNote, TimeCell, Toggle, UserCell, useDebounced, useLoad,
} from '../ui';

const PAGE_SIZE = 25;

export function ServersPage(props: { onChanged: () => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [query]);

  const list = useLoad(
    (signal) => api.get<Paged<{ servers: AdminServerListItem[] }>>(`/api/admin/servers${qs({ query, page, limit: PAGE_SIZE })}`, { signal }),
    [query, page],
  );
  const rows = list.data?.servers ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div class="admin-content">
      <PageHead
        title="Servers"
        subtitle={<>Every server the instance knows about, including the ones that smell. {total.toLocaleString()} total.</>}
        actions={<button class="btn" onClick={list.reload} disabled={list.loading}><Icon name="refresh" size={15} /> Refresh</button>}
      />
      <ErrorNote message={list.error} />
      <div class="admin-toolbar">
        <div class="admin-search">
          <Icon name="search" size={15} />
          <input class="input" type="search" placeholder="Search servers by name…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search servers" />
        </div>
        {list.loading ? <span class="admin-inline-loading"><span class="spinner" /> Updating…</span> : null}
      </div>

      <div class="admin-table-wrap">
        {list.loading && !list.data ? <SkeletonRows rows={8} cols={6} /> : rows.length === 0 && !list.loading ? (
          <Empty emoji="🏚️" title="No servers found">Either nobody made one or your search ate them.</Empty>
        ) : (
          <table class="table admin-table" aria-label="Instance servers">
            <thead>
              <tr><th>Server</th><th>Owner</th><th>Members</th><th>Channels</th><th>Messages</th><th>Visibility</th><th>Created</th><th><span class="sr-only">Actions</span></th></tr>
            </thead>
            <tbody class={list.loading ? 'is-refreshing' : ''}>
              {rows.map((s) => (
                <tr key={s.id} class="admin-row-click" onClick={() => setSelectedId(s.id)}>
                  <td>
                    <div class="admin-user-cell">
                      <span class="admin-server-icon" aria-hidden="true">{s.icon ? <img src={s.icon} alt="" /> : s.name.slice(0, 1).toUpperCase()}</span>
                      <div class="min-w-0"><div class="name truncate">{s.name}</div><div class="handle truncate">{s.id}</div></div>
                    </div>
                  </td>
                  <td><UserCell user={s.owner} /></td>
                  <td>{s.memberCount.toLocaleString()}</td>
                  <td>{s.channelCount.toLocaleString()}</td>
                  <td>{s.messageCount.toLocaleString()}</td>
                  <td>
                    <span class="admin-pills">
                      <span class={`admin-pill ${s.isPublic ? 'public' : ''}`}>{s.isPublic ? 'Public' : 'Private'}</span>
                      {s.nsfw ? <span class="admin-pill banned">NSFW</span> : null}
                    </span>
                  </td>
                  <td><TimeCell ts={s.createdAt} /></td>
                  <td class="actions"><button class="btn btn-xs" onClick={(e) => { e.stopPropagation(); setSelectedId(s.id); }} aria-label={`Open ${s.name}`}>Manage <Icon name="chevronRight" size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pager page={page} total={total} limit={PAGE_SIZE} onPage={setPage} loading={list.loading} />

      <ServerDrawer
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => { list.reload(); props.onChanged(); }}
        onGone={() => { setSelectedId(null); list.reload(); props.onChanged(); }}
      />
    </div>
  );
}

function ServerDrawer(props: { id: string | null; onClose: () => void; onChanged: () => void; onGone: () => void }) {
  const detail = useLoad(
    (signal) => props.id ? api.get<AdminServerDetail>(`/api/admin/servers/${props.id}`, { signal }) : Promise.resolve(null),
    [props.id],
  );
  const data = detail.data;
  const server = data?.server;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [nsfw, setNsfw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const ownerSearch = useDebounced(ownerQuery.trim(), 300);
  const ownerOptions = useLoad(
    (signal) => props.id
      ? api.get<Paged<{ users: AdminUserListItem[] }>>(`/api/admin/users${qs({ query: ownerSearch, limit: 20 })}`, { signal })
      : Promise.resolve<Paged<{ users: AdminUserListItem[] }>>({ users: [], total: 0, page: 1, limit: 20 }),
    [props.id, ownerSearch],
  );
  const [newOwnerId, setNewOwnerId] = useState('');
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [deleteServer, setDeleteServer] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.server.name);
    setDescription(data.server.description ?? '');
    setIsPublic(!!data.server.isPublic);
    setNsfw(!!data.server.nsfw);
    setNewOwnerId(data.server.ownerId);
  }, [data?.server.id]);

  useEffect(() => {
    if (!props.id) {
      setActionError(null);
      setFeedback(null);
      setEditingChannel(null);
      setDeleteServer(false);
    }
  }, [props.id]);

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setActionError(null);
    setFeedback(null);
    try {
      const message = await fn();
      if (message) setFeedback(message);
      detail.reload();
      props.onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Modal
        open={props.id !== null}
        onClose={() => { if (!busy) props.onClose(); }}
        title={server ? <span class="admin-drawer-title">{server.icon ? <img class="admin-detail-icon" src={server.icon} alt="" /> : null} {server.name}</span> : 'Server details'}
        xwide
        footer={<button class="btn" onClick={props.onClose} disabled={!!busy}>Close</button>}
      >
        <div class="modal-body admin-drawer">
          <ErrorNote message={actionError} />
          <SuccessNote message={feedback} />
          {detail.error ? <ErrorNote message={detail.error} onDismiss={detail.reload} /> : null}
          {detail.loading && !data ? <Loading label="Interrogating the server…" /> : !data || !server ? null : (
            <>
              <div class="admin-drawer-summary">
                <div><span class="admin-kicker">Server ID</span> <code>{server.id}</code></div>
                <div><span class="admin-kicker">Owner</span> {data.owner ? `@${data.owner.username}` : 'unknown'}</div>
                <div><span class="admin-kicker">Created</span> {fmtDateTime(server.createdAt)}</div>
                <div><span class="admin-kicker">Members</span> {data.counts.members.toLocaleString()}</div>
                <div><span class="admin-kicker">Messages</span> {data.counts.messages.toLocaleString()} <span class="muted">({data.counts.recentMessages} today)</span></div>
                <div><span class="admin-kicker">Bans</span> {data.counts.bans.toLocaleString()}</div>
              </div>

              <div class="admin-grid-2">
                <Panel title="Server identity">
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    run('identity', async () => {
                      await api.patch(`/api/admin/servers/${server.id}`, { name: name.trim(), description: description.trim() || null, isPublic, nsfw });
                      return 'Server settings saved. Members were notified via gateway.';
                    });
                  }}>
                    <Field label="Name"><input class="input" value={name} maxLength={100} onInput={(e) => setName((e.target as HTMLInputElement).value)} required aria-label="Server name" /></Field>
                    <Field label="Description"><textarea class="textarea" rows={3} maxLength={500} value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} aria-label="Server description" /></Field>
                    <div class="admin-toggle-row">
                      <Toggle checked={isPublic} onChange={setIsPublic} label="Public server" />
                      <Toggle checked={nsfw} onChange={setNsfw} label="NSFW content" />
                    </div>
                    <button class="btn btn-sm btn-primary" disabled={!!busy}>
                      {busy === 'identity' ? <span class="spinner" /> : <Icon name="check" size={14} />} Save server
                    </button>
                  </form>
                </Panel>

                <Panel title="Transfer ownership">
                  <p class="admin-hint">The new owner is added to the server if needed. Ownership transfer is announced to members and audited.</p>
                  <Field label="Find a user">
                    <input class="input" type="search" placeholder="Search users…" value={ownerQuery} onInput={(e) => setOwnerQuery((e.target as HTMLInputElement).value)} aria-label="Search users for new owner" />
                  </Field>
                  <Field label="New owner" hint={ownerOptions.loading ? 'Searching…' : 'Only enabled users can own a server.'}>
                    <select class="select" value={newOwnerId} onChange={(e) => setNewOwnerId((e.target as HTMLSelectElement).value)} aria-label="Select new owner">
                      <option value={server.ownerId}>Current owner (@{data.owner?.username ?? 'unknown'})</option>
                      {(ownerOptions.data?.users ?? []).filter((u) => u.id !== server.ownerId).map((u) => (
                        <option value={u.id} key={u.id} disabled={u.disabled}>{u.displayName} (@{u.username}){u.disabled ? ' — disabled' : ''}</option>
                      ))}
                    </select>
                  </Field>
                  <ErrorNote message={ownerOptions.error} />
                  <button class="btn btn-sm btn-outline" disabled={!!busy || newOwnerId === server.ownerId} onClick={() => run('owner', async () => {
                    await api.patch(`/api/admin/servers/${server.id}`, { ownerId: newOwnerId });
                    return 'Ownership transferred.';
                  })}>
                    {busy === 'owner' ? <span class="spinner" /> : <Icon name="crown" size={14} />} Transfer ownership
                  </button>
                </Panel>
              </div>

              <Panel title={`Channels (${data.channels.length})`} class="admin-panel-flush">
                {data.channels.length ? (
                  <div class="admin-table-wrap inner">
                    <table class="table admin-table" aria-label={`Channels in ${server.name}`}>
                      <thead><tr><th>Type</th><th>Name</th><th>Topic</th><th>Flags</th><th>Slowmode</th><th><span class="sr-only">Actions</span></th></tr></thead>
                      <tbody>
                        {data.channels.map((channel) => (
                          <tr key={channel.id}>
                            <td><span class="admin-channel-type"><Icon name={channel.type === 'voice' ? 'volume' : channel.type === 'forum' ? 'forum' : channel.type === 'announcement' ? 'announcement' : channel.type === 'category' ? 'menu' : 'hash'} size={14} /> {channel.type}</span></td>
                            <td class="truncate">{channel.name}</td>
                            <td class="admin-topic-cell truncate">{channel.topic || <span class="muted">—</span>}</td>
                            <td>
                              <span class="admin-pills">
                                {channel.nsfw ? <span class="admin-pill banned">NSFW</span> : null}
                                {channel.locked ? <span class="admin-pill disabled">Locked</span> : null}
                                {channel.archived ? <span class="admin-pill disabled">Archived</span> : null}
                              </span>
                            </td>
                            <td>{channel.slowmode ? `${channel.slowmode}s` : '—'}</td>
                            <td class="actions">
                              <button class="btn btn-xs" onClick={() => setEditingChannel(channel)} aria-label={`Edit ${channel.name}`}><Icon name="edit" size={13} /> Edit</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div class="admin-panel-body"><Empty emoji="📭" title="No channels">This server is an empty shell of ambition.</Empty></div>}
              </Panel>

              <div class="admin-grid-2">
                <Panel title={`Roles (${data.roles.length})`}>
                  {data.roles.length ? (
                    <ul class="admin-list dense">
                      {data.roles.map((role) => (
                        <li key={role.id}>
                          <div class="admin-list-row static">
                            <span class="admin-role-swatch" style={{ background: role.color || undefined }} aria-hidden="true" />
                            <span class="grow truncate">{role.name}</span>
                            {role.isDefault ? <span class="admin-pill">Everyone</span> : null}
                            <span class="admin-metric">pos {role.position}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty emoji="🎭" title="No roles" />}
                  <p class="admin-hint" style={{ marginTop: 10 }}>Role permissions are managed inside the server by its moderators. Slop Control can read them but does not rewrite role graphs.</p>
                </Panel>
                <Panel title={`Invites (${data.invites.length})`}>
                  {data.invites.length ? (
                    <ul class="admin-list dense">
                      {data.invites.slice(0, 12).map((invite) => (
                        <li key={invite.code}>
                          <div class="admin-list-row static">
                            <code class="admin-code-inline">{invite.code}</code>
                            <span class="admin-metric">{invite.uses}{invite.maxUses ? ` / ${invite.maxUses}` : ''} uses</span>
                            <span class="muted admin-small">{invite.expiresAt ? `expires ${fmtRelative(invite.expiresAt)}` : 'never expires'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty emoji="✉️" title="No invites">Nobody can get in. Peaceful.</Empty>}
                </Panel>
              </div>

              <div class="admin-danger-zone">
                <div>
                  <h3>Delete server</h3>
                  <p class="admin-hint">Deletes every channel, role, invite and membership. Members get a realtime eviction notice. Audited, irreversible.</p>
                </div>
                <button class="btn btn-danger" disabled={!!busy} onClick={() => setDeleteServer(true)}><Icon name="trash" size={15} /> Delete server</button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {server ? (
        <ChannelEditor
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
          onSaved={() => { detail.reload(); props.onChanged(); setEditingChannel(null); }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteServer}
        title="Delete this server?"
        danger
        confirmLabel="Delete server"
        expected={server?.name}
        busy={busy === 'delete'}
        error={actionError}
        onClose={() => setDeleteServer(false)}
        onConfirm={() => run('delete', async () => {
          await api.del(`/api/admin/servers/${server!.id}`);
          setDeleteServer(false);
          props.onGone();
        })}
      >
        <p><strong>{server?.name}</strong> and all of its channels, roles and memberships will be removed. The slop will be redistributed to the void.</p>
      </ConfirmDialog>
    </>
  );
}

function ChannelEditor(props: { channel: Channel | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [nsfw, setNsfw] = useState(false);
  const [locked, setLocked] = useState(false);
  const [slowmode, setSlowmode] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!props.channel) return;
    setName(props.channel.name);
    setTopic(props.channel.topic ?? '');
    setNsfw(props.channel.nsfw);
    setLocked(props.channel.locked);
    setSlowmode(props.channel.slowmode);
    setError(null);
    setConfirmDelete(false);
  }, [props.channel?.id]);

  const channel = props.channel;

  async function save() {
    if (!channel) return;
    setBusy('save');
    setError(null);
    try {
      await api.patch(`/api/admin/channels/${channel.id}`, { name: name.trim(), topic: topic.trim() || null, nsfw, locked, slowmode });
      props.onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!channel) return;
    setBusy('delete');
    setError(null);
    try {
      await api.del(`/api/admin/channels/${channel.id}`);
      setConfirmDelete(false);
      props.onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Modal
        open={channel !== null}
        onClose={() => { if (!busy) props.onClose(); }}
        title={channel ? `Edit #${channel.name}` : 'Edit channel'}
        footer={(
          <>
            <button class="btn btn-danger" disabled={!!busy} onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} /> Delete channel</button>
            <button class="btn" onClick={props.onClose} disabled={!!busy}>Cancel</button>
            <button class="btn btn-primary" onClick={save} disabled={!!busy || !name.trim()}>
              {busy === 'save' ? <span class="spinner" /> : <Icon name="check" size={14} />} Save channel
            </button>
          </>
        )}
      >
        <div class="modal-body">
          <ErrorNote message={error} />
          {channel ? (
            <>
              <Field label="Channel name"><input class="input" value={name} maxLength={100} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Channel name" /></Field>
              <Field label="Topic"><textarea class="textarea" rows={2} maxLength={1024} value={topic} onInput={(e) => setTopic((e.target as HTMLTextAreaElement).value)} aria-label="Channel topic" /></Field>
              <div class="admin-toggle-row">
                <Toggle checked={nsfw} onChange={setNsfw} label="NSFW" />
                <Toggle checked={locked} onChange={setLocked} label="Locked" />
              </div>
              <Field label="Slowmode (seconds)" hint="0–21600. Applies to members; admins are also asked nicely.">
                <input class="input" type="number" min={0} max={21600} value={slowmode} onInput={(e) => setSlowmode(Number((e.target as HTMLInputElement).value) || 0)} aria-label="Channel slowmode in seconds" />
              </Field>
              <p class="admin-hint">Channel type is {channel.type}. Creating channels belongs to the server UI; this console edits and deletes existing ones.</p>
            </>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this channel?"
        danger
        confirmLabel="Delete channel"
        expected={channel?.name}
        busy={busy === 'delete'}
        error={error}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      >
        <p>Every message inside <strong>#{channel?.name}</strong> will be deleted with it. The server will be notified realtime.</p>
      </ConfirmDialog>
    </>
  );
}
