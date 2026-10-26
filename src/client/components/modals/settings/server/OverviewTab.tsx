import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can, isOwner } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import { fmtDate, fmtDateTime } from '../../../../lib/format';
import { Field, Toggle } from '../../../Ui';
import { Icon } from '../../../Icons';
import { SettingsError, SettingsNotice, SettingsSection, SubCard, UploadControl } from './shared';

export function OverviewTab({ serverId, onNavigate }: { serverId: string; onNavigate: (tab: string) => void }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const server = bundle?.server;
  const manageServer = can(state, Perm.MANAGE_SERVER, serverId);
  const [name, setName] = useState(server?.name ?? '');
  const [description, setDescription] = useState(server?.description ?? '');
  const [motd, setMotd] = useState(server?.motd ?? '');
  const [icon, setIcon] = useState<string | null>(server?.icon ?? null);
  const [banner, setBanner] = useState<string | null>(server?.banner ?? null);
  const [iconDirty, setIconDirty] = useState(false);
  const [bannerDirty, setBannerDirty] = useState(false);
  const [bannerColor, setBannerColor] = useState(server?.bannerColor ?? '');
  const [traits, setTraits] = useState((server?.traits ?? []).join(', '));
  const [isPublic, setIsPublic] = useState(!!server?.isPublic);
  const [nsfw, setNsfw] = useState(!!server?.nsfw);
  const [welcomeChannelId, setWelcomeChannelId] = useState(server?.welcomeChannelId ?? '');
  const [systemChannelId, setSystemChannelId] = useState(server?.systemChannelId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!server || dirty) return;
    setName(server.name); setDescription(server.description ?? ''); setMotd(server.motd ?? '');
    setIcon(server.icon); setBanner(server.banner); setBannerColor(server.bannerColor ?? '');
    setIconDirty(false); setBannerDirty(false);
    setTraits((server.traits ?? []).join(', ')); setIsPublic(!!server.isPublic); setNsfw(!!server.nsfw);
    setWelcomeChannelId(server.welcomeChannelId ?? ''); setSystemChannelId(server.systemChannelId ?? '');
  }, [
    server?.id, server?.name, server?.description, server?.motd, server?.icon, server?.banner, server?.bannerColor,
    server?.traits, server?.isPublic, server?.nsfw, server?.welcomeChannelId, server?.systemChannelId, dirty,
  ]);

  if (!bundle || !server) return <SettingsError message="This server slipped out of the void." />;

  const touch = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };
  const textChannels = bundle.channels.filter((c) => c.serverId === serverId && (c.type === 'text' || c.type === 'announcement'))
    .sort((a, b) => a.position - b.position);
  const ownerMember = bundle.members.find((m) => m.user.id === server.ownerId);
  const ownerName = ownerMember?.user.displayName ?? (state.user?.id === server.ownerId ? state.user.displayName : server.ownerId);
  const ownerIsMe = state.user?.id === server.ownerId;
  const channelCount = bundle.channels.filter((c) => c.type !== 'thread' && c.type !== 'dm' && c.type !== 'group_dm').length;
  const owner = isOwner(state, serverId);

  const save = async () => {
    if (!manageServer) return;
    setBusy(true); setError(''); setFields({});
    try {
      const traitList = traits.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
      const body: Record<string, unknown> = {
        name: name.trim(), description: description.trim() || null, motd: motd.trim() || null,
        bannerColor: bannerColor || null,
        traits: traitList, isPublic, nsfw,
        welcomeChannelId: welcomeChannelId || null, systemChannelId: systemChannelId || null,
      };
      // Existing uploads are owned by whoever uploaded them; only send files the current actor changed.
      if (iconDirty) body.icon = icon;
      if (bannerDirty) body.banner = banner;
      await api.patch(`/api/servers/${serverId}`, body);
      await store.loadServer(serverId, { force: true });
      setIconDirty(false); setBannerDirty(false);
      setDirty(false);
      store.toast('Server settings saved. The slop has been restructured.', 'success', '🛠️');
    } catch (e) {
      if (e instanceof HttpError) setFields(e.fields ?? {});
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return <SettingsSection
    title="Overview"
    desc="The face of your slop empire. Everything here is visible to members unless marked otherwise."
    actions={manageServer ? <button class="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button> : undefined}
  >
    <SettingsError message={error} />
    {!manageServer ? <SettingsNotice kind="warn">You need <span class="mono">Manage Server</span> to edit this page. Enjoy the museum plaque.</SettingsNotice> : null}

    <SubCard title="Identity">
      <UploadControl purpose="server_icon" value={icon} onChange={(v) => { setIcon(v); setIconDirty(true); setDirty(true); }} label="Server icon" hint="PNG/JPG/WebP up to 2MB. Raster only, like your memories." square size={76} maxMb={2} disabled={!manageServer} />
      <div class="srv-grid-2 mt-16">
        <Field label="Server name" error={fields.name}>
          <input class="input" value={name} maxLength={100} disabled={!manageServer} onInput={(e) => touch(setName)((e.target as HTMLInputElement).value)} placeholder="The Slop Pit" />
        </Field>
        <Field label="Server ID" hint="Share this only when someone asks for support. It is not a secret handshake.">
          <div class="row gap-8">
            <input class="input mono" readOnly aria-label="Server ID" value={server.id} onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button class="btn btn-sm" onClick={() => void navigator.clipboard.writeText(server.id).then(() => store.toast('Server ID copied.', 'success', '📋')).catch(() => store.toast('Clipboard is being shy.', 'error'))}>Copy</button>
          </div>
        </Field>
      </div>
      <Field label="Description" hint={`${description.length}/500. Keep it punchy.`} error={fields.description}>
        <textarea class="textarea" value={description} maxLength={500} disabled={!manageServer} onInput={(e) => touch(setDescription)((e.target as HTMLTextAreaElement).value)} style={{ minHeight: 70 }} placeholder="A place where bad ideas become community." />
      </Field>
    </SubCard>

    <SubCard title="Banner & vibe">
      <div class="srv-banner-preview" style={banner ? { backgroundImage: `url(${banner})` } : { background: bannerColor || 'var(--bg-void)' }}>
        {!banner ? <span>{bannerColor ? 'Solid color banner' : 'No banner. Bold, minimal, unfinished.'}</span> : null}
        <div class="srv-banner-name">{name || server.name}</div>
      </div>
      <div class="srv-grid-2 mt-16">
        <UploadControl purpose="server_banner" value={banner} onChange={(v) => { setBanner(v); setBannerDirty(true); setDirty(true); }} label="Banner image" hint="Up to 5MB. Wide images look best; chaos is also acceptable." maxMb={5} disabled={!manageServer} size={64} />
        <Field label="Banner color" hint="Used when there is no image, or peeks through transparent pixels.">
          <div class="row gap-8">
            <input type="color" class="srv-color" aria-label="Banner color" value={bannerColor || '#b58cff'} disabled={!manageServer} onInput={(e) => touch(setBannerColor)((e.target as HTMLInputElement).value)} />
            <input class="input mono" value={bannerColor} maxLength={7} disabled={!manageServer} placeholder="#b58cff" onInput={(e) => touch(setBannerColor)((e.target as HTMLInputElement).value)} />
            <button class="btn btn-sm btn-ghost" disabled={!manageServer} onClick={() => touch(setBannerColor)('')}>Clear</button>
          </div>
        </Field>
      </div>
    </SubCard>

    <SubCard title="Welcome mat">
      <div class="srv-grid-2">
        <Field label="MOTD" hint="A short message shown at the top of the server. Do not put your passwords here." error={fields.motd}>
          <textarea class="textarea" value={motd} maxLength={500} disabled={!manageServer} onInput={(e) => touch(setMotd)((e.target as HTMLTextAreaElement).value)} style={{ minHeight: 60 }} placeholder="Be excellent to each other. Or at least mediocre." />
        </Field>
        <Field label="Traits" hint="Comma-separated, max 20. These show as chips in the sidebar." error={fields.traits}>
          <input class="input" value={traits} disabled={!manageServer} onInput={(e) => touch(setTraits)((e.target as HTMLInputElement).value)} placeholder="chaotic, sleep-deprived, lore-heavy" />
          <div class="chip-row mt-8">
            {traits.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20).map((t) => <span class="chip" key={t}>{t}</span>)}
          </div>
        </Field>
      </div>
      <div class="srv-grid-2">
        <Field label="Welcome channel" hint="Where new members land. Text or announcement channels only." error={fields.welcomeChannelId}>
          <select class="select" aria-label="Welcome channel" value={welcomeChannelId} disabled={!manageServer} onChange={(e) => touch(setWelcomeChannelId)((e.target as HTMLSelectElement).value)}>
            <option value="">— none —</option>
            {textChannels.map((c) => <option value={c.id}># {c.name}</option>)}
          </select>
        </Field>
        <Field label="System channel" hint="Join/leave/moderation notices are posted here." error={fields.systemChannelId}>
          <select class="select" aria-label="System channel" value={systemChannelId} disabled={!manageServer} onChange={(e) => touch(setSystemChannelId)((e.target as HTMLSelectElement).value)}>
            <option value="">— none —</option>
            {textChannels.map((c) => <option value={c.id}># {c.name}</option>)}
          </select>
        </Field>
      </div>
    </SubCard>

    <SubCard title="Visibility & warnings">
      <div class="srv-toggle-row">
        <div><div class="srv-toggle-title">Discovery listing</div><div class="srv-hint">Let strangers on this instance find and join the server. No external directory, no ads, no telemetry.</div></div>
        <Toggle checked={isPublic} onChange={(v) => manageServer && touch(setIsPublic)(v)} label={isPublic ? 'Public' : 'Private'} />
      </div>
      <div class="srv-toggle-row">
        <div><div class="srv-toggle-title">NSFW / 18+</div><div class="srv-hint">Marks the server as not safe for work. Your responsibilities are your own.</div></div>
        <Toggle checked={nsfw} onChange={(v) => manageServer && touch(setNsfw)(v)} label={nsfw ? 'Adults only' : 'All ages'} />
      </div>
    </SubCard>

    <SubCard title="Plaque of facts">
      <div class="srv-stat-grid">
        <div class="stat"><span class="value">{server.memberCount.toLocaleString()}</span><span class="label">Members</span></div>
        <div class="stat"><span class="value">{bundle.roles.length}</span><span class="label">Roles</span></div>
        <div class="stat"><span class="value">{channelCount}</span><span class="label">Channels</span></div>
        <div class="stat"><span class="value" style={{ fontSize: 15, paddingTop: 8 }}>{ownerName}</span><span class="label">{ownerIsMe ? 'Owner (you, the monarch)' : 'Owner'}</span></div>
        <div class="stat"><span class="value" style={{ fontSize: 15, paddingTop: 8 }}>{fmtDate(server.createdAt)}</span><span class="label">Created</span></div>
      </div>
      <div class="srv-hint mt-16">Owner ID: <span class="mono">{server.ownerId}</span> · Created {fmtDateTime(server.createdAt)}</div>
    </SubCard>

    {(owner || can(state, Perm.ADMINISTRATOR, serverId)) ? <SubCard title="Danger closet" actions={<span class="badge danger">owner / admin</span>}>
      <p class="srv-hint mb-16">Irreversible things live here. The slop does not offer undo.</p>
      <div class="row gap-8 wrap">
        {owner ? <button class="btn btn-sm" onClick={() => onNavigate('danger')}><Icon name="crown" size={13} /> Transfer ownership</button> : null}
        {!ownerIsMe ? <button class="btn btn-sm" onClick={() => onNavigate('danger')}><Icon name="logout" size={13} /> Leave server</button> : null}
        <button class="btn btn-sm btn-danger" onClick={() => onNavigate('danger')}><Icon name="trash" size={13} /> Delete server</button>
      </div>
    </SubCard> : null}
  </SettingsSection>;
}
