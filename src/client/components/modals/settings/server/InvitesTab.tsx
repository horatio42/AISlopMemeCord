import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, errorMessage } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can, canChannel } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { Invite } from '../../../../../shared/types';
import { fmtDateTime, fmtRelative } from '../../../../lib/format';
import { Field } from '../../../Ui';
import { Icon } from '../../../Icons';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

export function InvitesTab({ serverId }: { serverId: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const manageInvites = can(state, Perm.MANAGE_SERVER, serverId) || can(state, Perm.CREATE_INVITES, serverId);
  const eligible = useMemo(() => (bundle?.channels ?? [])
    .filter((c) => c.type !== 'category' && c.type !== 'thread' && canChannel(state, c, Perm.VIEW_CHANNEL) && canChannel(state, c, Perm.CREATE_INVITES))
    .sort((a, b) => a.position - b.position), [bundle?.channels, state]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [created, setCreated] = useState<Invite | null>(null);
  const [channelId, setChannelId] = useState('');
  const [expires, setExpires] = useState(168);
  const [maxUses, setMaxUses] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmCode, setConfirmCode] = useState<string | null>(null);

  useEffect(() => {
    if (!eligible.length) { setChannelId(''); return; }
    setChannelId((prev) => eligible.some((c) => c.id === prev) ? prev : eligible[0]!.id);
  }, [serverId, eligible.length]);

  useEffect(() => {
    if (!manageInvites) return;
    void api.get<{ invites: Invite[] }>(`/api/servers/${serverId}/invites`)
      .then((r) => setInvites(r.invites ?? []))
      .catch((e) => setError(errorMessage(e)));
  }, [serverId, manageInvites]);

  if (!bundle) return <SettingsError message="This server has no invites and no reality." />;

  const link = (code: string) => `${location.origin}/invite/${code}`;

  const create = async () => {
    if (!channelId) { setError('No invite-capable channel. Grant Create Invites somewhere first.'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post<{ invite: Invite }>(`/api/channels/${channelId}/invites`, { maxUses, expiresInHours: expires || undefined });
      setCreated(res.invite);
      setInvites((old) => [res.invite, ...old]);
      store.toast('Invite forged. Now the slop can spread.', 'success', '🔗');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(link(code));
      store.toast('Invite link copied. Treat it like a bearer token.', 'success', '📋');
    } catch { setError('Clipboard unavailable. Select the link manually, like a peasant.'); }
  };

  const revoke = async (code: string) => {
    setBusy(true); setError('');
    try {
      await api.del(`/api/invites/${code}`);
      setInvites((old) => old.filter((i) => i.code !== code));
      if (created?.code === code) setCreated(null);
      setConfirmCode(null);
      store.toast('Invite revoked. The door is shut.', 'success', '🚪');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  if (!manageInvites) return <SettingsSection title="Invites" desc="Links that let other slop goblins in.">
    <SettingsNotice kind="warn">Managing invites needs <span class="mono">Manage Server</span> or <span class="mono">Create Invites</span>. You currently hold neither. Ask a friend with buttons.</SettingsNotice>
  </SettingsSection>;

  return <SettingsSection title="Invites" desc="Every link is a tiny liability. Set an expiry, cap the uses, and revoke anything suspicious.">
    <SettingsError message={error} />
    <SubCard title="Create invite">
      {!eligible.length ? <SettingsNotice kind="warn">You cannot create invites in any channel here. You need View Channel and Create Invites.</SettingsNotice> : null}
      <div class="row gap-8 wrap srv-invite-form">
        <div class="grow" style={{ minWidth: 180 }}><Field label="Channel">
          <select class="select" value={channelId} onChange={(e) => setChannelId((e.target as HTMLSelectElement).value)}>
            {eligible.map((c) => <option value={c.id}># {c.name}</option>)}
          </select>
        </Field></div>
        <div><Field label="Expires">
          <select class="select" value={expires} onChange={(e) => setExpires(Number((e.target as HTMLSelectElement).value))}>
            <option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option><option value={0}>Never</option>
          </select>
        </Field></div>
        <div><Field label="Max uses">
          <select class="select" value={maxUses} onChange={(e) => setMaxUses(Number((e.target as HTMLSelectElement).value))}>
            <option value={0}>Unlimited</option><option value={1}>1 use</option><option value={5}>5 uses</option><option value={10}>10 uses</option><option value={25}>25 uses</option>
          </select>
        </Field></div>
        <button class="btn btn-primary mb-16" disabled={busy || !channelId} onClick={() => void create()}>{busy ? 'Forging…' : 'Generate invite'}</button>
      </div>
      {created ? <div class="srv-created-invite">
        <div class="row-between mb-8"><span class="srv-card-title">Fresh link</span><span class="badge accent">new</span></div>
        <div class="row gap-8">
          <input class="input mono" readOnly value={link(created.code)} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button class="btn btn-sm btn-primary" onClick={() => void copy(created.code)}>Copy</button>
        </div>
        <div class="srv-hint mt-8">Uses: {created.uses}/{created.maxUses || '∞'} · Expires: {created.expiresAt ? fmtDateTime(created.expiresAt) : 'never'}. Tokens are bearer credentials; do not frame them.</div>
      </div> : null}
    </SubCard>

    <SubCard title={`Active invites — ${invites.length}`}>
      {invites.length ? <div class="srv-invite-list">
        {invites.map((i) => <div class="srv-invite-row" key={i.code}>
          <Icon name="link" size={15} class="text-accent" />
          <div class="grow" style={{ minWidth: 0 }}>
            <div class="mono truncate">{link(i.code)}</div>
            <div class="srv-hint truncate">
              {i.creator.displayName} · {i.uses}{i.maxUses ? `/${i.maxUses}` : ''} uses · {i.expiresAt ? `expires ${fmtRelative(i.expiresAt)}` : 'never expires'} · created {fmtRelative(i.createdAt)}
              {i.channelId ? ` · # ${bundle.channels.find((c) => c.id === i.channelId)?.name ?? 'channel'}` : ''}
            </div>
          </div>
          <button class="btn btn-sm" onClick={() => void copy(i.code)}><Icon name="copy" size={12} /> Copy</button>
          {(can(state, Perm.MANAGE_SERVER, serverId) || i.creator.id === state.user?.id) ? (confirmCode === i.code
            ? <><button class="btn btn-sm btn-danger" disabled={busy} onClick={() => void revoke(i.code)}>Revoke</button><button class="btn btn-sm btn-ghost" onClick={() => setConfirmCode(null)}>Keep</button></>
            : <button class="btn btn-sm btn-ghost" onClick={() => setConfirmCode(i.code)}>Revoke</button>)
            : <span class="badge">not yours</span>}
        </div>)}
      </div> : <EmptySlop emoji="🔗" title="No active invites">The server is a sealed bunker. Generate a link and welcome the next wave of bad ideas.</EmptySlop>}
    </SubCard>
  </SettingsSection>;
}
