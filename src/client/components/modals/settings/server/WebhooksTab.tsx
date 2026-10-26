import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { Webhook } from '../../../../../shared/types';
import { fmtRelative } from '../../../../lib/format';
import { Icon } from '../../../Icons';
import { Field } from '../../../Ui';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard, UploadControl } from './shared';

export function WebhooksTab({ serverId }: { serverId: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const manage = can(state, Perm.MANAGE_SERVER, serverId);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [created, setCreated] = useState<Webhook | null>(null);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!manage) return;
    void api.get<{ webhooks: Webhook[] }>(`/api/servers/${serverId}/webhooks`)
      .then((r) => setWebhooks(r.webhooks ?? []))
      .catch((e) => setError(errorMessage(e)));
  }, [serverId, manage]);

  if (!bundle) return <SettingsError message="Webhooks crawled back into the sewer." />;

  const channels = bundle.channels.filter((c) => c.type === 'text' || c.type === 'announcement').sort((a, b) => a.position - b.position);
  const endpoint = (w: Webhook) => w.token ? `${location.origin}/api/webhooks/${w.id}/${w.token}` : '';

  const create = async () => {
    if (!name.trim() || !channelId) { setError('Pick a channel and name the webhook.'); return; }
    setBusy(true); setError('');
    try {
      const body: Record<string, unknown> = { name: name.trim(), channelId };
      if (avatar) body.avatar = avatar;
      const res = await api.post<{ webhook: Webhook }>(`/api/servers/${serverId}/webhooks`, body);
      setCreated(res.webhook);
      setWebhooks((old) => [...old, res.webhook]);
      setName(''); setAvatar(null);
      store.toast('Webhook created. The token below is shown exactly once.', 'success', '🪝');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError('');
    try {
      await api.del(`/api/webhooks/${id}`);
      setWebhooks((old) => old.filter((w) => w.id !== id));
      if (created?.id === id) setCreated(null);
      setConfirm(null);
      store.toast('Webhook deleted. The sewer is quieter.', 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); store.toast('Copied. Handle with care.', 'success', '📋'); }
    catch { setError('Clipboard said no. Select the text manually.'); }
  };

  if (!manage) return <SettingsSection title="Webhooks" desc="Machine-readable doorways into your channels.">
    <SettingsNotice kind="warn">Webhooks require <span class="mono">Manage Server</span>. The robots must wait.</SettingsNotice>
  </SettingsSection>;

  return <SettingsSection title="Webhooks" desc="Let outside scripts post into a channel without a real account. Tokens are shown once and stored hashed server-side.">
    <SettingsError message={error} />
    <SettingsNotice>
      Treat webhook URLs like passwords: anyone with the URL can post. They only work on this instance, never leak to a third party, and you can revoke one instantly by deleting it.
    </SettingsNotice>

    <SubCard title="Create webhook">
      {!channels.length ? <SettingsNotice kind="warn">You need a text or announcement channel before a webhook has somewhere to yell.</SettingsNotice> : null}
      <div class="row gap-8 wrap">
        <div class="grow" style={{ minWidth: 180 }}><Field label="Name"><input class="input" value={name} maxLength={80} placeholder="CI goblin" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field></div>
        <div class="grow" style={{ minWidth: 180 }}><Field label="Channel">
          <select class="select" value={channelId} onChange={(e) => setChannelId((e.target as HTMLSelectElement).value)}>
            <option value="">— pick a channel —</option>
            {channels.map((c) => <option value={c.id}># {c.name}</option>)}
          </select>
        </Field></div>
        <button class="btn btn-primary mb-16" disabled={busy || !name.trim() || !channelId} onClick={() => void create()}>{busy ? 'Summoning…' : 'Create webhook'}</button>
      </div>
      <UploadControl purpose="webhook_avatar" value={avatar} onChange={setAvatar} label="Avatar (optional)" hint="2MB max. Purely cosmetic; the robot can be cute." maxMb={2} size={52} round />
      {created ? <div class="srv-created-webhook">
        <div class="row-between mb-8"><span class="srv-card-title">Your webhook URL — shown once</span><span class="badge accent">secret</span></div>
        <div class="row gap-8">
          <input class="input mono" readOnly value={endpoint(created)} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button class="btn btn-sm btn-primary" onClick={() => void copy(endpoint(created))}>Copy</button>
        </div>
        <div class="srv-hint mt-8">POST JSON to this URL with <span class="mono">{'{ "content": "hello slop" }'}</span>. The token cannot be recovered after you close this page.</div>
      </div> : null}
    </SubCard>

    <SubCard title={`Active webhooks — ${webhooks.length}`}>
      {webhooks.length ? <div class="srv-webhook-list">{webhooks.map((w) => <div class="srv-webhook-row" key={w.id}>
        <div class="srv-webhook-avatar">{w.avatar ? <img src={w.avatar} alt="" /> : <Icon name="robot" size={18} />}</div>
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="truncate">{w.name}</div>
          <div class="srv-hint truncate"># {bundle.channels.find((c) => c.id === w.channelId)?.name ?? w.channelId} · created {fmtRelative(w.createdAt)} · {w.lastUsedAt ? `last used ${fmtRelative(w.lastUsedAt)}` : 'never used'}</div>
        </div>
        <span class="badge mono">token hidden</span>
        {confirm === w.id
          ? <><button class="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove(w.id)}>Delete</button><button class="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>Keep</button></>
          : <button class="btn btn-sm btn-ghost" onClick={() => setConfirm(w.id)}><Icon name="trash" size={13} /> Revoke</button>}
      </div>)}</div> : <EmptySlop emoji="🪝" title="No webhooks">No robots have breached the perimeter yet.</EmptySlop>}
    </SubCard>
  </SettingsSection>;
}
