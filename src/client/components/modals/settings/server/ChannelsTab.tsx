import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can } from '../../../../lib/permissions';
import { Perm, PERMISSION_META, PERMISSION_NAMES } from '../../../../../shared/permissions';
import type { Channel, ChannelOverride, ChannelType, Role } from '../../../../../shared/types';
import { Field, Toggle } from '../../../Ui';
import { Icon } from '../../../Icons';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

const TYPES: { value: ChannelType; label: string; icon: string }[] = [
  { value: 'text', label: 'Text', icon: 'hash' },
  { value: 'voice', label: 'Voice', icon: 'volume' },
  { value: 'forum', label: 'Forum', icon: 'forum' },
  { value: 'announcement', label: 'Announcement', icon: 'announcement' },
  { value: 'category', label: 'Category', icon: 'file' },
];

const TYPE_ICON: Record<string, string> = { text: 'hash', voice: 'volume', forum: 'forum', announcement: 'announcement', category: 'chevronDown', thread: 'thread' };
const SLOWMODE_OPTIONS = [0, 5, 10, 30, 60, 300, 900, 3600, 21600];

interface ChannelDraft {
  name: string;
  type: ChannelType;
  parentId: string;
  topic: string;
  nsfw: boolean;
  slowmode: number;
  locked: boolean;
  votingEnabled: boolean;
  defaultSort: '' | 'hot' | 'new' | 'top';
  tags: string;
}

const blankDraft = (parentId = ''): ChannelDraft => ({
  name: '', type: 'text', parentId, topic: '', nsfw: false, slowmode: 0, locked: false,
  votingEnabled: true, defaultSort: '', tags: '',
});

function draftOf(ch: Channel): ChannelDraft {
  return {
    name: ch.name, type: ch.type, parentId: ch.parentId ?? '', topic: ch.topic ?? '', nsfw: ch.nsfw,
    slowmode: ch.slowmode, locked: ch.locked, votingEnabled: ch.votingEnabled,
    defaultSort: ch.defaultSort ?? '', tags: (ch.tags ?? []).join(', '),
  };
}

export function ChannelsTab({ serverId, initialChannelId }: { serverId: string; initialChannelId?: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const manageChannels = can(state, Perm.MANAGE_CHANNELS, serverId);
  const channels = useMemo(() => [...(bundle?.channels ?? [])]
    .filter((c) => c.type !== 'thread' && c.type !== 'dm' && c.type !== 'group_dm')
    .sort((a, b) => a.position - b.position), [bundle?.channels]);
  const categories = channels.filter((c) => c.type === 'category');
  const loose = channels.filter((c) => c.type !== 'category' && !c.parentId);
  const [selectedId, setSelectedId] = useState<string | null>(initialChannelId ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ChannelDraft>(blankDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overrides, setOverrides] = useState<ChannelOverride[]>([]);
  const [overrideTarget, setOverrideTarget] = useState('');
  const selected = creating ? null : channels.find((c) => c.id === selectedId) ?? null;

  useEffect(() => { if (initialChannelId) { setCreating(false); setSelectedId(initialChannelId); } }, [initialChannelId]);

  useEffect(() => {
    if (creating) return;
    if (selected) setDraft(draftOf(selected));
    setConfirmDelete(false);
  }, [selectedId, creating]);

  useEffect(() => {
    if (creating || !selected) return;
    setOverrides(selected.overrides ?? []);
  }, [selectedId, creating, selected?.overrides]);

  useEffect(() => {
    if (!creating && !selectedId && channels.length) {
      setSelectedId((channels.find((c) => c.type !== 'category') ?? channels[0]!).id);
    }
    if (!creating && selectedId && !channels.some((c) => c.id === selectedId) && selectedId !== initialChannelId) setSelectedId(null);
  }, [channels, selectedId, creating, initialChannelId]);

  if (!bundle) return <SettingsError message="This server's channels have evaporated." />;

  const childrenOf = (parentId: string) => channels.filter((c) => c.type !== 'category' && c.parentId === parentId);

  const siblingsOf = (ch: Channel): Channel[] => {
    if (ch.type === 'category') return categories;
    if (ch.parentId) return childrenOf(ch.parentId);
    return loose;
  };

  const move = async (ch: Channel, dir: -1 | 1) => {
    const list = siblingsOf(ch);
    const idx = list.findIndex((c) => c.id === ch.id);
    const other = list[idx + dir];
    if (!other) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/api/servers/${serverId}/channels/positions`, { positions: [
        { id: ch.id, position: other.position, parentId: ch.parentId ?? null },
        { id: other.id, position: ch.position, parentId: other.parentId ?? null },
      ] });
      await store.loadServer(serverId, { force: true });
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const startCreate = (parentId = '', type: ChannelType = 'text') => {
    setCreating(true);
    setSelectedId(null);
    setDraft({ ...blankDraft(parentId), type });
    setFields({}); setError('');
  };

  const save = async () => {
    if (!manageChannels) return;
    setBusy(true); setError(''); setFields({});
    try {
      const tags = draft.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
      if (creating) {
        const res = await api.post<{ channel: Channel }>(`/api/servers/${serverId}/channels`, {
          name: draft.name.trim(), type: draft.type, parentId: draft.type === 'category' ? null : (draft.parentId || null),
          topic: draft.topic.trim() || null, nsfw: draft.nsfw, slowmode: draft.slowmode,
          locked: draft.locked, votingEnabled: draft.votingEnabled,
          defaultSort: draft.type === 'forum' ? (draft.defaultSort || null) : null,
          tags: draft.type === 'forum' ? tags : [],
        });
        // Creation only accepts the core shape; apply the extras with a follow-up edit so the form always matches reality.
        await api.patch(`/api/channels/${res.channel.id}`, {
          topic: draft.topic.trim() || null, nsfw: draft.nsfw, slowmode: draft.slowmode,
          locked: draft.locked, votingEnabled: draft.votingEnabled,
          defaultSort: draft.type === 'forum' ? (draft.defaultSort || null) : null,
          tags: draft.type === 'forum' ? tags : [],
        });
        await store.loadServer(serverId, { force: true });
        setCreating(false);
        setSelectedId(res.channel.id);
        store.toast('Channel created. The slop now has another room.', 'success', '📁');
      } else if (selected) {
        await api.patch(`/api/channels/${selected.id}`, {
          name: draft.name.trim(), topic: draft.topic.trim() || null, nsfw: draft.nsfw,
          slowmode: draft.slowmode, locked: draft.locked, votingEnabled: draft.votingEnabled,
          defaultSort: draft.type === 'forum' ? (draft.defaultSort || null) : null,
          tags: draft.type === 'forum' ? tags : [],
          parentId: draft.type === 'category' ? null : (draft.parentId || null),
        });
        await store.loadServer(serverId, { force: true });
        store.toast('Channel updated. The layout has been re-slopped.', 'success', '🛠️');
      }
    } catch (e) {
      if (e instanceof HttpError) setFields(e.fields ?? {});
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await api.del(`/api/channels/${selected.id}`);
      await store.loadServer(serverId, { force: true });
      setSelectedId(null); setConfirmDelete(false);
      store.toast('Channel deleted. Its messages are now lore.', 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const saveOverrides = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const cleaned = overrides.filter((o) => o.allow !== 0 || o.deny !== 0);
      const res = await api.put<{ overrides: ChannelOverride[] }>(`/api/channels/${selected.id}/overrides`, { overrides: cleaned });
      setOverrides(res.overrides);
      await store.loadServer(serverId, { force: true });
      store.toast('Channel overrides saved. Permission spaghetti, freshly plated.', 'success', '🔐');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const existingKeys = new Set(overrides.map((o) => `${o.targetType}:${o.targetId}`));
  const targetOptions: { key: string; label: string }[] = [
    ...bundle.roles.filter((r) => !existingKeys.has(`role:${r.id}`)).map((r) => ({ key: `role:${r.id}`, label: `@role ${r.name}` })),
    ...bundle.members.filter((m) => !existingKeys.has(`user:${m.user.id}`)).map((m) => ({ key: `user:${m.user.id}`, label: `@user ${m.user.displayName} (@${m.user.username})` })),
  ];

  const addOverride = () => {
    const [targetType, targetId] = overrideTarget.split(':');
    if ((targetType !== 'role' && targetType !== 'user') || !targetId) return;
    setOverrides([...overrides, { targetType, targetId, allow: 0, deny: 0 }]);
    setOverrideTarget('');
  };

  const renderChannelRow = (ch: Channel, depth = 0) => {
    const list = siblingsOf(ch);
    const idx = list.findIndex((c) => c.id === ch.id);
    return <div
      class={`srv-channel-row ${selectedId === ch.id && !creating ? 'active' : ''} ${ch.type === 'category' ? 'category' : ''}`}
      style={{ paddingLeft: `${10 + depth * 16}px` }}
      key={ch.id}
      onClick={() => { setCreating(false); setSelectedId(ch.id); }}
    >
      <Icon name={TYPE_ICON[ch.type] ?? 'hash'} size={14} class="srv-ch-icon" />
      <span class="grow truncate srv-ch-name">{ch.name}</span>
      {ch.nsfw ? <span class="badge danger" title="NSFW">18+</span> : null}
      {ch.locked ? <Icon name="lock" size={12} class="faint" /> : null}
      {ch.overrides?.length ? <span class="badge" title={`${ch.overrides.length} permission overrides`}>{ch.overrides.length}</span> : null}
      <div class="row gap-2" onClick={(e) => e.stopPropagation()}>
        <button class="btn-icon sm" disabled={busy || idx <= 0} title="Move up" onClick={() => void move(ch, -1)}><Icon name="arrowUp" size={12} /></button>
        <button class="btn-icon sm" disabled={busy || idx < 0 || idx >= list.length - 1} title="Move down" onClick={() => void move(ch, 1)}><Icon name="arrowDown" size={12} /></button>
      </div>
    </div>;
  };

  return <SettingsSection
    title="Channels"
    desc="Categories are shelves. Channels are the questionable little boxes on them. Drag-free reordering, because slop."
    actions={manageChannels ? <div class="row gap-8">
      <button class="btn btn-sm" onClick={() => startCreate('', 'category')}><Icon name="plus" size={13} /> Category</button>
      <button class="btn btn-primary btn-sm" onClick={() => startCreate()}><Icon name="plus" size={13} /> Channel</button>
    </div> : undefined}
  >
    <SettingsError message={error} />
    {!manageChannels ? <SettingsNotice kind="warn">You need <span class="mono">Manage Channels</span> to rearrange the plumbing.</SettingsNotice> : null}

    <div class="srv-split">
      <div class="srv-channel-list">
        {loose.map((ch) => renderChannelRow(ch))}
        {categories.map((cat) => <div key={cat.id}>
          {renderChannelRow(cat)}
          {childrenOf(cat.id).map((ch) => renderChannelRow(ch, 1))}
        </div>)}
        {!channels.length ? <EmptySlop emoji="📁" title="No channels yet">A server without channels is just a very quiet group chat.</EmptySlop> : null}
      </div>

      <div class="srv-editor-pane">
        {creating || selected ? <SubCard title={creating ? `New ${(TYPES.find((t) => t.value === draft.type)?.label ?? draft.type).toLowerCase()}` : `# ${selected!.name}`} actions={
          <div class="row gap-8">
            {!creating && selected ? (
              confirmDelete
                ? <><button class="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>Delete forever</button><button class="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button></>
                : <button class="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={13} /> Delete</button>
            ) : null}
            <button class="btn btn-primary btn-sm" disabled={busy || !manageChannels || !draft.name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : creating ? 'Create' : 'Save'}</button>
          </div>
        }>
          <div class="srv-grid-2">
            <Field label="Name" hint="Lowercase, dashes, no spaces. Chaos is not a naming convention." error={fields.name}>
              <input class="input" value={draft.name} maxLength={100} disabled={!manageChannels} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} placeholder="new-channel" />
            </Field>
            <Field label="Type" hint="Type cannot be changed after creation. Choose responsibly." error={fields.type}>
              <select class="select" value={draft.type} disabled={!manageChannels || !creating} onChange={(e) => setDraft({ ...draft, type: (e.target as HTMLSelectElement).value as ChannelType })}>
                {TYPES.map((t) => <option value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>
          <div class="srv-grid-2">
            <Field label="Category" hint="Only categories can contain channels." error={fields.parentId}>
              <select class="select" value={draft.parentId} disabled={!manageChannels || draft.type === 'category'} onChange={(e) => setDraft({ ...draft, parentId: (e.target as HTMLSelectElement).value })}>
                <option value="">— no category —</option>
                {categories.filter((c) => c.id !== selectedId).map((c) => <option value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Slowmode (seconds)" hint="0 = free-for-all. 21600 = everyone must touch grass between posts." error={fields.slowmode}>
              <select class="select" value={draft.slowmode} disabled={!manageChannels} onChange={(e) => setDraft({ ...draft, slowmode: Number((e.target as HTMLSelectElement).value) })}>
                {SLOWMODE_OPTIONS.map((s) => <option value={s}>{s === 0 ? 'Off' : `${s}s`}</option>)}
                {!SLOWMODE_OPTIONS.includes(draft.slowmode) ? <option value={draft.slowmode}>{draft.slowmode}s</option> : null}
              </select>
            </Field>
          </div>
          <Field label="Topic" hint="Shown in the channel header. 1024 characters of manifesto space." error={fields.topic}>
            <textarea class="textarea" value={draft.topic} maxLength={1024} disabled={!manageChannels} onInput={(e) => setDraft({ ...draft, topic: (e.target as HTMLTextAreaElement).value })} style={{ minHeight: 60 }} />
          </Field>
          {draft.type === 'forum' || selected?.type === 'forum' ? <div class="srv-grid-2">
            <Field label="Default forum sort" hint="How posts are ordered by default." error={fields.defaultSort}>
              <select class="select" value={draft.defaultSort} disabled={!manageChannels} onChange={(e) => setDraft({ ...draft, defaultSort: (e.target as HTMLSelectElement).value as ChannelDraft['defaultSort'] })}>
                <option value="">— none —</option><option value="hot">Hot</option><option value="new">New</option><option value="top">Top</option>
              </select>
            </Field>
            <Field label="Forum tags" hint="Comma-separated, max 10." error={fields.tags}>
              <input class="input" value={draft.tags} disabled={!manageChannels} onInput={(e) => setDraft({ ...draft, tags: (e.target as HTMLInputElement).value })} placeholder="hot-take, copium, lore" />
            </Field>
          </div> : null}
          <div class="row gap-24 wrap mb-16">
            <Toggle checked={draft.nsfw} onChange={(v) => setDraft({ ...draft, nsfw: v })} label="NSFW" />
            <Toggle checked={draft.locked} onChange={(v) => setDraft({ ...draft, locked: v })} label="Locked (read-only for everyone)" />
            <Toggle checked={draft.votingEnabled} onChange={(v) => setDraft({ ...draft, votingEnabled: v })} label="Voting enabled" />
          </div>

          {!creating && selected ? <div class="srv-subsection">
            <div class="row-between mb-8">
              <div><div class="srv-card-title">Permission overrides</div><div class="srv-hint">Deny beats allow; allow beats inherited. Put keys in the lock, or don't.</div></div>
              <button class="btn btn-sm btn-primary" disabled={!manageChannels || busy} onClick={() => void saveOverrides()}>Save overrides</button>
            </div>
            {!selected.overrides ? <SettingsNotice>Overrides were not included in your bundle. Reload the server to fetch them.</SettingsNotice> : null}
            <div class="row gap-8 mb-8">
              <select class="select" value={overrideTarget} disabled={!manageChannels || !targetOptions.length} onChange={(e) => setOverrideTarget((e.target as HTMLSelectElement).value)}>
                <option value="">— add a role or member —</option>
                {targetOptions.map((o) => <option value={o.key}>{o.label}</option>)}
              </select>
              <button class="btn btn-sm" disabled={!manageChannels || !overrideTarget} onClick={addOverride}>Add</button>
            </div>
            {overrides.length ? overrides.map((o) => <OverrideRow
              key={`${o.targetType}:${o.targetId}`}
              override={o}
              roles={bundle.roles}
              bundle={bundle}
              disabled={!manageChannels}
              onChange={(next) => setOverrides(overrides.map((x) => x === o ? next : x))}
              onRemove={() => setOverrides(overrides.filter((x) => x !== o))}
            />) : <div class="srv-hint">No overrides. Everyone sees the channel exactly as the role hierarchy says.</div>}
          </div> : null}
        </SubCard> : <EmptySlop emoji="📁" title="Pick a channel">Select something on the left, or create a fresh box of chaos.</EmptySlop>}
      </div>
    </div>
  </SettingsSection>;
}

function OverrideRow(props: {
  override: ChannelOverride;
  roles: Role[];
  bundle: { members: { user: { id: string; displayName: string; username: string } }[] };
  disabled: boolean;
  onChange: (next: ChannelOverride) => void;
  onRemove: () => void;
}) {
  const role = props.override.targetType === 'role' ? props.roles.find((r) => r.id === props.override.targetId) : null;
  const member = props.override.targetType === 'user' ? props.bundle.members.find((m) => m.user.id === props.override.targetId) : null;
  const label = props.override.targetType === 'role'
    ? `@role ${role?.name ?? props.override.targetId}`
    : `@user ${member?.user.displayName ?? props.override.targetId}`;
  const cycle = (bit: number) => {
    const allow = props.override.allow & bit;
    const deny = props.override.deny & bit;
    let nextAllow = allow, nextDeny = deny;
    if (!allow && !deny) nextAllow = bit;
    else if (allow) { nextAllow = 0; nextDeny = bit; }
    else { nextAllow = 0; nextDeny = 0; }
    props.onChange({ ...props.override, allow: nextAllow, deny: nextDeny });
  };
  return <div class="srv-override">
    <div class="row-between mb-8">
      <div class="row gap-8"><Icon name="shield" size={14} class="text-accent" /><span class="srv-override-target">{label}</span></div>
      <button class="btn btn-xs btn-ghost" disabled={props.disabled} onClick={props.onRemove}>remove</button>
    </div>
    <div class="srv-override-grid">
      {PERMISSION_NAMES.map((name) => {
        const bit = Perm[name];
        const state = props.override.allow & bit ? 'allow' : props.override.deny & bit ? 'deny' : 'inherit';
        return <button
          key={name}
          class={`srv-override-perm ${state}`}
          disabled={props.disabled}
          title={`${PERMISSION_META[name].label} — click to cycle: inherit → allow → deny`}
          onClick={() => cycle(bit)}
        >
          {PERMISSION_META[name].label}
        </button>;
      })}
    </div>
  </div>;
}
