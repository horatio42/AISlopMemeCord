import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../lib/api';
import { store, useApp } from '../../lib/use-store';
import { Modal, Field, Spinner } from '../Ui';
import { Icon } from '../Icons';
import { canChannel } from '../../lib/permissions';
import { Perm } from '../../../shared/permissions';

export function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApp();
  const bundle = state.activeServerId ? state.servers[state.activeServerId] : null;
  const eligible = (bundle?.channels ?? []).filter((c) => c.type !== 'category' && c.type !== 'thread' && canChannel(state, c, Perm.VIEW_CHANNEL));
  const [channelId, setChannelId] = useState('');
  const [expires, setExpires] = useState(24 * 7);
  const [maxUses, setMaxUses] = useState(0);
  const [invites, setInvites] = useState<any[]>([]);
  const [created, setCreated] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!open) return;
    setCreated(null); setError('');
    const preferred = state.activeChannelId && eligible.some((c) => c.id === state.activeChannelId) ? state.activeChannelId : eligible[0]?.id ?? '';
    setChannelId(preferred);
    if (bundle) api.get<any>(`/api/servers/${bundle.server.id}/invites`).then((r) => setInvites(r.invites ?? [])).catch(() => setInvites([]));
  }, [open, state.activeServerId]);
  const link = (code: string) => `${location.origin}/invite/${code}`;
  const generate = async () => {
    if (!channelId) { setError('No channel available for invites.'); return; }
    setBusy(true); setError('');
    try {
      const res: any = await api.post(`/api/channels/${channelId}/invites`, { maxUses, expiresInHours: expires || undefined });
      setCreated(res.invite);
      setInvites((old) => [res.invite, ...old]);
      store.toast('Invite generated. Spread the disease.', 'success', '🔗');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(link(code)); setCopied(code); setTimeout(() => setCopied(''), 1800); store.toast('Invite link copied.', 'success', '📋'); }
    catch { setError('Clipboard unavailable. Select the link manually.'); }
  };
  const revoke = async (code: string) => {
    if (!confirm('Revoke this invite? Anyone holding the link will be sad.')) return;
    try { await api.del(`/api/invites/${code}`); setInvites(invites.filter((i) => i.code !== code)); if (created?.code === code) setCreated(null); }
    catch (e) { setError(errorMessage(e)); }
  };
  if (!bundle) return null;
  return <Modal open={open} onClose={onClose} title={`Invite people to ${bundle.server.name}`} wide>
    <div class="modal-body">
      {error ? <div class="auth-error">{error}</div> : null}
      {created ? <div class="card flat mb-16" style={{ borderColor: 'var(--accent)' }}>
        <div class="label mb-8">Your fresh invite link</div>
        <div class="row gap-8">
          <input class="input mono" readOnly value={link(created.code)} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button class="btn btn-primary" onClick={() => void copy(created.code)}>{copied === created.code ? 'Copied!' : 'Copy'}</button>
        </div>
        <div class="faint mt-8" style={{ fontSize: 11 }}>Uses: {created.uses}/{created.maxUses || '∞'} · Expires: {created.expiresAt ? new Date(created.expiresAt).toLocaleString() : 'never'} · Treat it like a bearer token.</div>
      </div> : null}
      <div class="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
        <div class="grow"><Field label="Channel"><select class="select" value={channelId} onChange={(e) => setChannelId((e.target as HTMLSelectElement).value)}>{eligible.map((c) => <option value={c.id}># {c.name}</option>)}</select></Field></div>
        <div><Field label="Expires"><select class="select" value={expires} onChange={(e) => setExpires(Number((e.target as HTMLSelectElement).value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option><option value={0}>Never</option></select></Field></div>
        <div><Field label="Max uses"><select class="select" value={maxUses} onChange={(e) => setMaxUses(Number((e.target as HTMLSelectElement).value))}><option value={0}>Unlimited</option><option value={1}>1 use</option><option value={5}>5 uses</option><option value={10}>10 uses</option><option value={25}>25 uses</option></select></Field></div>
        <button class="btn btn-primary mb-16" disabled={busy || !eligible.length} onClick={generate}>{busy ? <Spinner size={14} /> : <><Icon name="link" size={15} /> Generate</>}</button>
      </div>
      {!eligible.length ? <div class="auth-notice">You do not have permission to invite people to this server. Ask someone with CREATE_INVITES.</div> : null}
      <hr />
      <div class="section-title mb-8">Active invites — {invites.length}</div>
      {invites.length ? <div class="list-card" style={{ maxHeight: 220, overflowY: 'auto' }}>{invites.map((i) => <div class="friend-row" key={i.code} style={{ padding: '8px 12px' }}>
        <Icon name="link" size={14} class="text-accent" />
        <div class="fr-info"><div class="fr-name mono" style={{ fontSize: 12 }}>{i.code}</div><div class="fr-status">{i.creator?.displayName ?? 'someone'} · {i.uses}{i.maxUses ? `/${i.maxUses}` : ''} uses · {i.expiresAt ? `expires ${new Date(i.expiresAt).toLocaleDateString()}` : 'never expires'}</div></div>
        <button class="btn-link" onClick={() => void copy(i.code)}>copy</button>
        <button class="btn-link" style={{ color: 'var(--danger)' }} onClick={() => void revoke(i.code)}>revoke</button>
      </div>)}</div> : <p class="muted" style={{ fontSize: 12 }}>No active invites. Generate one and become the reason the server grows.</p>}
    </div>
  </Modal>;
}
