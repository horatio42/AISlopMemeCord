import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can, isOwner, memberTopPosition } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { Role } from '../../../../../shared/types';
import { Field, Toggle } from '../../../Ui';
import { Icon } from '../../../Icons';
import { EmptySlop, PermissionEditor, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

interface Draft {
  name: string;
  color: string;
  hoist: boolean;
  mentionable: boolean;
  permissions: number;
}

const BLANK: Draft = { name: 'new role', color: '#99aab5', hoist: false, mentionable: false, permissions: 0 };

function draftOf(role: Role): Draft {
  return { name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions };
}

export function RolesTab({ serverId, initialRoleId }: { serverId: string; initialRoleId?: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const roles = useMemo(() => [...(bundle?.roles ?? [])].sort((a, b) => b.position - a.position), [bundle?.roles]);
  const manageRoles = can(state, Perm.MANAGE_ROLES, serverId);
  const ownerBypass = isOwner(state, serverId);
  const top = memberTopPosition(state, serverId);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoleId ?? roles.find((r) => !r.isDefault)?.id ?? roles[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = creating ? null : roles.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (creating) { setDraft(BLANK); return; }
    if (selected) setDraft(draftOf(selected));
    setConfirmDelete(false);
  }, [selectedId, creating]);

  // If a role disappears (deleted elsewhere), fall back to the first manageable one.
  useEffect(() => {
    if (!creating && !selectedId && roles.length) {
      setSelectedId(roles.find((r) => !r.isDefault)?.id ?? roles[0]!.id);
    }
  }, [roles, selectedId, creating]);

  if (!bundle) return <SettingsError message="Server roles are missing. The void is hungry." />;

  const manageable = (role: Role): boolean => {
    if (!manageRoles) return false;
    if (ownerBypass) return true;
    if (role.isDefault) return can(state, Perm.ADMINISTRATOR, serverId);
    return role.position < top;
  };

  const move = async (role: Role, dir: -1 | 1) => {
    const idx = roles.findIndex((r) => r.id === role.id);
    const other = roles[idx + dir];
    if (!other || other.isDefault) return;
    if (!manageable(role) || !manageable(other)) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/api/servers/${serverId}/roles/positions`, { positions: [
        { id: role.id, position: other.position },
        { id: other.id, position: role.position },
      ] });
      await store.loadServer(serverId, { force: true });
      setSelectedId(role.id);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!manageRoles) return;
    setBusy(true); setError(''); setFields({});
    try {
      if (creating) {
        const res = await api.post<{ role: Role }>(`/api/servers/${serverId}/roles`, {
          name: draft.name.trim(), color: draft.color, hoist: draft.hoist, mentionable: draft.mentionable, permissions: draft.permissions,
        });
        await store.loadServer(serverId, { force: true });
        setCreating(false);
        setSelectedId(res.role.id);
        store.toast('Role forged. Assign it to someone who deserves chaos.', 'success', '🎭');
      } else if (selected) {
        await api.patch(`/api/roles/${selected.id}`, {
          name: draft.name.trim(), color: draft.color, hoist: draft.hoist, mentionable: draft.mentionable, permissions: draft.permissions,
        });
        await store.loadServer(serverId, { force: true });
        store.toast('Role updated. The hierarchy trembles.', 'success', '🛠️');
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
      await api.del(`/api/roles/${selected.id}`);
      await store.loadServer(serverId, { force: true });
      setConfirmDelete(false);
      setSelectedId(null);
      store.toast('Role deleted. Its power returns to the slop.', 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return <SettingsSection
    title="Roles"
    desc="Stack power like Jenga. Higher roles win ties and sit closer to the throne."
    actions={manageRoles ? <button class="btn btn-primary btn-sm" onClick={() => { setCreating(true); setFields({}); setError(''); }}><Icon name="plus" size={13} /> Create role</button> : undefined}
  >
    <SettingsError message={error} />
    {!manageRoles ? <SettingsNotice kind="warn">You need <span class="mono">Manage Roles</span> to touch this page. The roles remain a decorative hierarchy.</SettingsNotice> : null}
    {manageRoles && !ownerBypass ? <SettingsNotice kind="warn">Your highest role sits at position <span class="mono">{top}</span>. You cannot edit, reorder or delete roles at or above it. Ambition has limits.</SettingsNotice> : null}

    <div class="srv-roles-layout">
      <div class="srv-role-list">
        {roles.map((role, i) => {
          const canMoveUp = i > 0 && !role.isDefault && manageable(role);
          const canMoveDown = i < roles.length - 1 && !role.isDefault && manageable(role) && !roles[i + 1]!.isDefault;
          return <div
            class={`srv-role-row ${selectedId === role.id && !creating ? 'active' : ''}`}
            key={role.id}
            onClick={() => { setCreating(false); setSelectedId(role.id); }}
          >
            <span class="srv-role-dot" style={{ background: role.color === 'transparent' ? 'var(--faint)' : role.color, borderColor: role.color === 'transparent' ? 'var(--border)' : role.color }} />
            <div class="grow truncate">
              <div class="srv-role-name">{role.name}{role.isDefault ? <span class="badge" style={{ marginLeft: 6 }}>default</span> : null}</div>
              <div class="srv-hint">position {role.position} · {role.memberCount ?? 0} {role.memberCount === 1 ? 'member' : 'members'}{role.hoist ? ' · hoisted' : ''}{role.mentionable ? ' · mentionable' : ''}</div>
            </div>
            <div class="row gap-4" onClick={(e) => e.stopPropagation()}>
              <button class="btn-icon sm" disabled={busy || !canMoveUp} title="Move up" onClick={() => void move(role, -1)}><Icon name="arrowUp" size={13} /></button>
              <button class="btn-icon sm" disabled={busy || !canMoveDown} title="Move down" onClick={() => void move(role, 1)}><Icon name="arrowDown" size={13} /></button>
            </div>
          </div>;
        })}
        {!roles.length ? <EmptySlop emoji="🎭" title="No roles. A hierarchy of one.">Create a role before the void creates one for you.</EmptySlop> : null}
      </div>

      <div class="srv-role-editor">
        {creating || selected ? <SubCard title={creating ? 'New role' : selected!.name} actions={
          <div class="row gap-8">
            {!creating && selected && !selected.isDefault && manageable(selected) ? (
              confirmDelete
                ? <><button class="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>Delete forever</button><button class="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button></>
                : <button class="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={13} /> Delete</button>
            ) : null}
            <button class="btn btn-primary btn-sm" disabled={busy || !manageRoles || (!creating && (!selected || !manageable(selected)))} onClick={() => void save()}>{busy ? 'Saving…' : creating ? 'Create' : 'Save'}</button>
          </div>
        }>
          {!creating && selected && !manageable(selected) ? <SettingsNotice kind="warn">This role is at or above your highest role. You can look, but not touch.</SettingsNotice> : null}
          <div class="srv-grid-2">
            <Field label="Role name" hint={selected?.isDefault ? '@everyone cannot be renamed. It is eternal.' : '1-100 characters, probably.'} error={fields.name}>
              <input class="input" value={draft.name} maxLength={100} disabled={!manageRoles || (!creating && (!selected || !manageable(selected) || selected.isDefault))} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} />
            </Field>
            <Field label="Color" hint="Hex color for the role badge. Use transparent for no color." error={fields.color}>
              <div class="row gap-8">
                <input type="color" class="srv-color" aria-label="Role color" value={draft.color === 'transparent' ? '#99aab5' : draft.color} disabled={!manageRoles || (!creating && (!selected || !manageable(selected)))} onInput={(e) => setDraft({ ...draft, color: (e.target as HTMLInputElement).value })} />
                <input class="input mono" value={draft.color} maxLength={11} disabled={!manageRoles || (!creating && (!selected || !manageable(selected)))} onInput={(e) => setDraft({ ...draft, color: (e.target as HTMLInputElement).value })} />
                <span class="srv-role-dot" style={{ background: draft.color === 'transparent' ? 'var(--faint)' : draft.color }} />
              </div>
            </Field>
          </div>
          <div class="row gap-24 wrap mb-16">
            <Toggle checked={draft.hoist} onChange={(v) => setDraft({ ...draft, hoist: v })} label="Hoist members in sidebar" />
            <Toggle checked={draft.mentionable} onChange={(v) => setDraft({ ...draft, mentionable: v })} label="Mentionable" />
          </div>
          <div class="srv-hint mb-8">{selected?.isDefault ? 'The @everyone role applies to every member who has no other allow override. Edit its base permissions below.' : 'Permissions are additive. A deny override in a channel beats any role allow.'}</div>
          <PermissionEditor
            permissions={draft.permissions}
            onChange={(v) => setDraft({ ...draft, permissions: v })}
            disabled={!manageRoles || (!creating && (!selected || !manageable(selected)))}
          />
        </SubCard> : <EmptySlop emoji="🎭" title="Pick a role">Select a role on the left, or create a new one. Power awaits.</EmptySlop>}
      </div>
    </div>
  </SettingsSection>;
}
