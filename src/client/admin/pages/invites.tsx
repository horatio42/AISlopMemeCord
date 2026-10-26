import { useState } from 'preact/hooks';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import type { AccountInvite, AdminInvite, AdminSettings } from '../types';
import {
  ConfirmDialog, CopyButton, Empty, ErrorNote, Field, Icon, Loading, PageHead, Panel,
  SuccessNote, useLoad,
} from '../ui';

export function InvitesPage(props: { onChanged: () => void }) {
  const invites = useLoad((signal) => api.get<{ invites: AdminInvite[]; total: number }>('/api/admin/invites', { signal }), []);
  const account = useLoad((signal) => api.get<{ invites: AccountInvite[]; total: number }>('/api/admin/account-invites', { signal }), []);
  const settings = useLoad((signal) => api.get<{ settings: AdminSettings }>('/api/admin/settings', { signal }), []);

  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [created, setCreated] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'server' | 'account'; code: string; label: string } | null>(null);

  const query = q.trim().toLowerCase();
  const serverInvites = (invites.data?.invites ?? []).filter((i) =>
    !query || i.code.toLowerCase().includes(query) || (i.serverName ?? '').toLowerCase().includes(query) || i.creator.username.toLowerCase().includes(query),
  );
  const accountInvites = account.data?.invites ?? [];
  const mode = settings.data?.settings.registration;

  async function revoke() {
    if (!confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      if (confirm.kind === 'server') await api.del(`/api/admin/invites/${encodeURIComponent(confirm.code)}`);
      else await api.del(`/api/admin/account-invites/${encodeURIComponent(confirm.code)}`);
      setFeedback(`${confirm.kind === 'server' ? 'Server invite' : 'Account invite'} ${confirm.code} revoked.`);
      setConfirm(null);
      invites.reload();
      account.reload();
      props.onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function createAccountInvite() {
    setBusy(true);
    setActionError(null);
    setFeedback(null);
    try {
      const res = await api.post<{ invite: AccountInvite }>('/api/admin/account-invites', { maxUses, expiresInHours });
      setCreated(res.invite.code);
      setFeedback('Account invite minted. Copy it before the goblin eats it.');
      account.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="admin-content">
      <PageHead
        title="Invites"
        subtitle={<>Two very different doors: server invites let people into a server, account invites let people exist at all.</>}
        actions={
          <button class="btn" onClick={() => { invites.reload(); account.reload(); }} disabled={invites.loading || account.loading}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        }
      />
      <ErrorNote message={actionError} />
      <SuccessNote message={feedback} />

      <div class="admin-grid-2">
        <Panel
          title="Account invites"
          actions={<span class="admin-panel-note">Registration mode: <strong>{mode ?? '…'}</strong></span>}
        >
          <div class="admin-invite-explain">
            <Icon name="info" size={16} />
            <div>
              <p>Account invites are instance-level permits. When registration is <strong>invite</strong>, a valid unused code is required to create an account.</p>
              <p>They do <strong>not</strong> grant server membership: a new user still needs a separate server invite. <code>maxUses 0</code> means unlimited uses; expiry <code>0</code> means eternal. Every create and revoke is audited.</p>
            </div>
          </div>
          <form class="admin-invite-form" onSubmit={(e) => { e.preventDefault(); void createAccountInvite(); }}>
            <Field label="Max uses" hint="0 = unlimited. 1–1000 otherwise.">
              <input class="input" type="number" min={0} max={1000} value={maxUses} onInput={(e) => setMaxUses(Math.max(0, Math.min(1000, Number((e.target as HTMLInputElement).value) || 0)))} aria-label="Account invite max uses" />
            </Field>
            <Field label="Expires in hours" hint="0 = never expires. Up to 8760 hours (one year).">
              <input class="input" type="number" min={0} max={8760} value={expiresInHours} onInput={(e) => setExpiresInHours(Math.max(0, Math.min(8760, Number((e.target as HTMLInputElement).value) || 0)))} aria-label="Account invite expiry in hours" />
            </Field>
            <button class="btn btn-primary" disabled={busy}>
              {busy ? <span class="spinner" /> : <Icon name="plus" size={15} />} Mint account invite
            </button>
          </form>
          {created ? (
            <div class="admin-created-code">
              <span class="admin-kicker">New code — shown once</span>
              <code>{created}</code>
              <CopyButton value={created} label="Copy code" />
            </div>
          ) : null}

          <h3 class="admin-subhead">Existing account invites ({accountInvites.length})</h3>
          {account.loading && !account.data ? <Loading label="Loading account invites…" /> : accountInvites.length === 0 ? (
            <Empty emoji="✉️" title="No account invites">Registration is either open or completely closed. Check Instance settings.</Empty>
          ) : (
            <ul class="admin-list dense">
              {accountInvites.map((invite) => (
                <li key={invite.code}>
                  <div class="admin-list-row static admin-invite-row">
                    <code class="admin-code-inline">{invite.code}</code>
                    <CopyButton value={invite.code} ariaLabel={`Copy account invite ${invite.code}`} />
                    <span class="admin-metric">{invite.uses}{invite.maxUses ? ` / ${invite.maxUses}` : ''} uses</span>
                    <span class="admin-small muted">{invite.expired ? 'expired' : invite.exhausted ? 'exhausted' : invite.expiresAt ? `expires ${fmtRelative(invite.expiresAt)}` : 'never expires'}</span>
                    <span class="admin-small muted">by @{invite.createdBy.username}</span>
                    <button class="btn btn-xs btn-danger" onClick={() => setConfirm({ kind: 'account', code: invite.code, label: 'account invite' })} aria-label={`Revoke account invite ${invite.code}`}>
                      <Icon name="trash" size={12} /> Revoke
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ErrorNote message={account.error} />
        </Panel>

        <Panel title={`Server invites (${invites.data?.total ?? 0})`}>
          <div class="admin-search" style={{ marginBottom: 12 }}>
            <Icon name="search" size={15} />
            <input class="input" type="search" placeholder="Filter by code, server or creator…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Filter server invites" />
          </div>
          <ErrorNote message={invites.error} />
          {invites.loading && !invites.data ? <Loading label="Loading server invites…" /> : serverInvites.length === 0 ? (
            <Empty emoji="🚪" title="No server invites">Everyone is either already inside or locked out.</Empty>
          ) : (
            <ul class="admin-list dense admin-invite-list">
              {serverInvites.map((invite) => (
                <li key={invite.code}>
                  <div class="admin-invite-server-row">
                    <div class="admin-invite-main">
                      <div class="row gap-8">
                        <code class="admin-code-inline">{invite.code}</code>
                        <CopyButton value={invite.code} ariaLabel={`Copy server invite ${invite.code}`} />
                        <span class="grow" />
                        <button class="btn btn-xs btn-danger" onClick={() => setConfirm({ kind: 'server', code: invite.code, label: `invite for ${invite.serverName}` })} aria-label={`Revoke ${invite.code}`}>
                          <Icon name="trash" size={12} /> Revoke
                        </button>
                      </div>
                      <div class="admin-invite-meta">
                        <span><Icon name="home" size={12} /> {invite.serverName ?? 'server'}</span>
                        <span><Icon name="users" size={12} /> {invite.uses}{invite.maxUses ? ` / ${invite.maxUses}` : ''} uses</span>
                        <span>{invite.expiresAt ? `expires ${fmtDateTime(invite.expiresAt)}` : 'never expires'}</span>
                        <span class="muted">by @{invite.creator.username} · {fmtRelative(invite.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title="Revoke invite?"
        danger
        confirmLabel="Revoke invite"
        busy={busy}
        error={actionError}
        onClose={() => setConfirm(null)}
        onConfirm={revoke}
      >
        <p>The {confirm?.label ?? 'invite'} <code>{confirm?.code}</code> will stop working immediately. Existing members are not affected.</p>
      </ConfirmDialog>
    </div>
  );
}
