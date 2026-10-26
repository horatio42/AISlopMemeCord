import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can, canManageMember, isOwner, memberTopPosition } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { ServerMember } from '../../../../../shared/types';
import { fmtDate, fmtDateTime, fmtRelative } from '../../../../lib/format';
import { Avatar } from '../../../Avatar';
import { Icon } from '../../../Icons';
import { Field } from '../../../Ui';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

const TIMEOUTS: { label: string; ms: number }[] = [
  { label: '1 minute', ms: 60_000 },
  { label: '10 minutes', ms: 600_000 },
  { label: '1 hour', ms: 3_600_000 },
  { label: '1 day', ms: 86_400_000 },
  { label: '1 week', ms: 604_800_000 },
];

export function MembersTab({ serverId, initialUserId }: { serverId: string; initialUserId?: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialUserId ?? null);
  const [nickname, setNickname] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [timeoutCustom, setTimeoutCustom] = useState('');
  const [action, setAction] = useState<'kick' | 'ban' | null>(null);
  const [reason, setReason] = useState('');
  const [deleteSeconds, setDeleteSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const members = bundle?.members ?? [];
  const ownerBypass = isOwner(state, serverId);
  const top = memberTopPosition(state, serverId);
  const canRoles = can(state, Perm.MANAGE_ROLES, serverId);
  const canNicknames = can(state, Perm.MANAGE_NICKNAMES, serverId);
  const canTimeout = can(state, Perm.MODERATE_MEMBERS, serverId);
  const canKick = can(state, Perm.KICK_MEMBERS, serverId);
  const canBan = can(state, Perm.BAN_MEMBERS, serverId);
  const me = state.user;
  const selected = members.find((m) => m.user.id === selectedId) ?? null;

  useEffect(() => {
    if (bundle) void store.loadMembers(serverId);
  }, [serverId]);

  useEffect(() => { if (initialUserId) setSelectedId(initialUserId); }, [initialUserId]);

  useEffect(() => {
    setNickname(selected?.nickname ?? '');
    setRoleIds(selected?.roles ?? []);
    setAction(null); setReason(''); setFields({}); setError('');
  }, [selectedId]);

  const sorted = useMemo(() => {
    const score = (m: ServerMember) => m.user.id === bundle?.server.ownerId ? 9999 : Math.max(0, ...(bundle?.roles ?? []).filter((r) => m.roles.includes(r.id)).map((r) => r.position));
    return [...members].sort((a, b) => {
      if (a.user.id === bundle?.server.ownerId) return -1;
      if (b.user.id === bundle?.server.ownerId) return 1;
      return score(b) - score(a) || a.user.displayName.localeCompare(b.user.displayName);
    });
  }, [members, bundle?.server.ownerId, bundle?.roles]);

  useEffect(() => {
    if (!selectedId && sorted.length) setSelectedId(sorted[0]!.user.id);
  }, [sorted, selectedId]);
  const filtered = sorted.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return m.user.displayName.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q) || (m.nickname ?? '').toLowerCase().includes(q);
  });

  if (!bundle || !me) return <SettingsError message="Members are currently theoretical." />;

  const isSelf = selected?.user.id === me.id;
  const canManage = selected ? canManageMember(state, serverId, selected) : false;
  const canEditNickname = !!selected && (isSelf ? can(state, Perm.CHANGE_NICKNAME, serverId) : (canNicknames && canManage));
  const canEditRoles = !!selected && canRoles && (isSelf ? ownerBypass : canManage);
  const canTimeoutTarget = !!selected && canTimeout && (isSelf ? false : canManage);
  const canKickTarget = !!selected && canKick && canManage && !isSelf;
  const canBanTarget = !!selected && canBan && canManage && !isSelf;
  const timeoutUntil = selected?.timeoutUntil && selected.timeoutUntil > Date.now() ? selected.timeoutUntil : null;

  const patch = async (body: Record<string, unknown>, success: string) => {
    if (!selected) return;
    setBusy(true); setError(''); setFields({});
    try {
      await api.patch(`/api/servers/${serverId}/members/${selected.user.id}`, body);
      await store.loadMembers(serverId);
      await store.loadServer(serverId, { force: true });
      store.toast(success, 'success', '🛠️');
    } catch (e) {
      if (e instanceof HttpError) setFields(e.fields ?? {});
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  const runModeration = async () => {
    if (!selected || !action) return;
    setBusy(true); setError('');
    try {
      if (action === 'kick') {
        await api.del(`/api/servers/${serverId}/members/${selected.user.id}`, { reason: reason.trim() || undefined });
        store.toast(`${selected.user.displayName} was kicked. The door is fine.`, 'success', '👢');
      } else {
        await api.post(`/api/servers/${serverId}/bans/${selected.user.id}`, { reason: reason.trim() || undefined, deleteMessageSeconds: deleteSeconds });
        store.toast(`${selected.user.displayName} was banished to the slop void.`, 'success', '🔨');
      }
      const removedId = selected.user.id;
      setAction(null); setReason('');
      await store.loadMembers(serverId);
      await store.loadServer(serverId, { force: true });
      if (selectedId === removedId) setSelectedId(null);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const applyTimeout = async (ms: number | null) => {
    await patch({ timeoutUntil: ms ? Date.now() + ms : null }, ms ? 'Timeout applied. Touch grass, digitally.' : 'Timeout lifted. Grass privileges restored.');
  };

  const applyCustomTimeout = async () => {
    if (!timeoutCustom) return;
    const until = new Date(timeoutCustom).getTime();
    if (!Number.isFinite(until) || until <= Date.now()) { setError('Pick a future date and time. Time travel is out of scope.'); return; }
    await patch({ timeoutUntil: until }, 'Custom timeout applied. The calendar is your enemy.');
  };

  return <SettingsSection title="Members" desc="Nicknames, roles, timeouts and the occasional boot. Hierarchy applies; the owner is untouchable.">
    <SettingsError message={error} />
    <div class="srv-split">
      <div class="srv-member-list-col">
        <div class="search-input mb-8">
          <Icon name="search" size={14} />
          <input class="input" placeholder="Search members…" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
        </div>
        <div class="srv-hint mb-8">{filtered.length} of {members.length} members{members.length < bundle.server.memberCount ? ` (showing first ${members.length})` : ''}</div>
        <div class="srv-member-list">
          {filtered.map((m) => <button
            key={m.user.id}
            class={`srv-member-row ${selectedId === m.user.id ? 'active' : ''}`}
            onClick={() => setSelectedId(m.user.id)}
          >
            <Avatar user={m.user} size={30} status />
            <div class="grow truncate" style={{ textAlign: 'left' }}>
              <div class="srv-member-name truncate">
                {m.nickname || m.user.displayName}
                {m.user.id === bundle.server.ownerId ? <Icon name="crown" size={12} class="srv-crown" /> : null}
              </div>
              <div class="srv-hint truncate">@{m.user.username}{m.timeoutUntil && m.timeoutUntil > Date.now() ? ' · timed out' : ''}</div>
            </div>
            {m.user.status === 'offline' ? <span class="faint" style={{ fontSize: 10 }}>off</span> : <span class={`status-dot ${m.user.status}`} />}
          </button>)}
          {!filtered.length ? <EmptySlop emoji="🕵️" title="Nobody found">Try a different name, or accept the silence.</EmptySlop> : null}
        </div>
      </div>

      <div class="srv-editor-pane">
        {selected ? <SubCard title={<span class="row gap-8"><Avatar user={selected.user} size={26} /> <span>{selected.nickname || selected.user.displayName}{selected.user.id === bundle.server.ownerId ? <span class="badge purple" style={{ marginLeft: 6 }}><Icon name="crown" size={10} /> owner</span> : null}</span></span>}>
          <div class="srv-member-meta">
            <span>@{selected.user.username}</span>
            <span>Joined {fmtDate(selected.joinedAt)}</span>
            <span class="mono">ID {selected.user.id}</span>
            {timeoutUntil ? <span class="badge danger">Timed out until {fmtDateTime(timeoutUntil)}</span> : null}
          </div>
          {isSelf ? <SettingsNotice>This is you. You can change your own nickname{ownerBypass ? ' and roles' : ''}; the hierarchy still says no to self-promotion coups.</SettingsNotice> : null}
          {!isSelf && !canManage ? <SettingsNotice kind="warn">This member's highest role is at or above yours, or they own the server. You can look, not touch.</SettingsNotice> : null}

          <div class="srv-grid-2">
            <Field label="Server nickname" hint={isSelf ? 'Visible only inside this server.' : 'Requires Manage Nicknames and a position above them.'} error={fields.nickname}>
              <div class="row gap-8">
                <input class="input" value={nickname} maxLength={32} disabled={!canEditNickname} onInput={(e) => setNickname((e.target as HTMLInputElement).value)} placeholder="Their slop alias" />
                <button class="btn btn-sm" disabled={busy || !canEditNickname || nickname === (selected.nickname ?? '')} onClick={() => void patch({ nickname: nickname.trim() || null }, 'Nickname updated. Identity crisis averted.')}>Save</button>
              </div>
            </Field>
            <Field label="Timeout status" hint="Timeouts prevent speaking. 28 days max, because even punishment needs a ceiling.">
              <div class="row gap-8 wrap">
                {timeoutUntil ? <>
                  <span class="badge danger">until {fmtRelative(timeoutUntil)}</span>
                  <button class="btn btn-sm" disabled={busy || !canTimeoutTarget} onClick={() => void applyTimeout(null)}>Lift timeout</button>
                </> : <span class="badge">not timed out</span>}
              </div>
            </Field>
          </div>

          {canTimeoutTarget || timeoutUntil ? <div class="srv-subsection">
            <div class="srv-card-title mb-8">Timeout tools</div>
            <div class="row gap-8 wrap">
              {TIMEOUTS.map((t) => <button class="btn btn-sm" key={t.ms} disabled={busy || !canTimeoutTarget} onClick={() => void applyTimeout(t.ms)}>{t.label}</button>)}
              {timeoutUntil ? <button class="btn btn-sm btn-ghost" disabled={busy || !canTimeoutTarget} onClick={() => void applyTimeout(null)}>Clear</button> : null}
            </div>
            {canTimeoutTarget ? <div class="row gap-8 mt-8">
              <input class="input" type="datetime-local" value={timeoutCustom} onInput={(e) => setTimeoutCustom((e.target as HTMLInputElement).value)} />
              <button class="btn btn-sm" disabled={busy || !timeoutCustom} onClick={() => void applyCustomTimeout()}>Custom until</button>
            </div> : null}
          </div> : null}

          <div class="srv-subsection">
            <div class="row-between mb-8">
              <div><div class="srv-card-title">Roles</div><div class="srv-hint">@everyone applies to all members implicitly. Higher-position roles win ties.</div></div>
              <button class="btn btn-sm btn-primary" disabled={busy || !canEditRoles || arraysEqual([...roleIds].sort(), [...selected.roles].sort())} onClick={() => void patch({ roles: roleIds }, 'Role assignments updated. The hierarchy shuffles.')}>Save roles</button>
            </div>
            <div class="srv-role-checks">
              <label class="srv-role-check muted"><input type="checkbox" checked disabled /> @everyone <span class="badge">implicit</span></label>
              {[...bundle.roles].sort((a, b) => b.position - a.position).filter((r) => !r.isDefault).map((role) => {
                const locked = !canEditRoles || (!ownerBypass && role.position >= top);
                return <label class={`srv-role-check ${locked ? 'locked' : ''}`} key={role.id} title={locked ? 'This role is at or above your highest role.' : undefined}>
                  <input
                    type="checkbox"
                    checked={roleIds.includes(role.id)}
                    disabled={busy || locked}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked;
                      setRoleIds(on ? [...new Set([...roleIds, role.id])] : roleIds.filter((id) => id !== role.id));
                    }}
                  />
                  <span class="srv-role-dot" style={{ background: role.color === 'transparent' ? 'var(--faint)' : role.color }} />
                  <span class="grow truncate">{role.name}</span>
                  <span class="srv-hint">pos {role.position}{locked ? ' · locked' : ''}</span>
                </label>;
              })}
            </div>
            {!canEditRoles ? <div class="srv-hint mt-8">You cannot edit this member's roles. Either you lack Manage Roles, or the hierarchy says no.</div> : null}
          </div>

          {(canKickTarget || canBanTarget) ? <div class="srv-subsection srv-danger-zone">
            <div class="srv-card-title mb-8">Moderation</div>
            {action === null ? <div class="row gap-8 wrap">
              {canKickTarget ? <button class="btn btn-sm" disabled={busy} onClick={() => { setAction('kick'); setReason(''); }}><Icon name="logout" size={13} /> Kick member</button> : null}
              {canBanTarget ? <button class="btn btn-sm btn-danger" disabled={busy} onClick={() => { setAction('ban'); setReason(''); }}><Icon name="ban" size={13} /> Ban member</button> : null}
            </div> : <div class="srv-confirm">
              <div class="srv-card-title mb-8">{action === 'kick' ? `Kick ${selected.user.displayName}?` : `Ban ${selected.user.displayName}?`}</div>
              <p class="srv-hint mb-8">{action === 'kick'
                ? 'They can rejoin with a new invite. The door will politely hit them on the way out.'
                : 'They cannot rejoin until unbanned. The ban hammer is permanent-ish.'}</p>
              <Field label="Reason" hint="Optional, but posted to the audit log and included in any system notice.">
                <textarea class="textarea" value={reason} maxLength={500} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} style={{ minHeight: 56 }} placeholder="Too much slop, even for us" />
              </Field>
              {action === 'ban' ? <Field label="Delete recent messages" hint="Purges their messages from this server's timeline.">
                <select class="select" value={deleteSeconds} onChange={(e) => setDeleteSeconds(Number((e.target as HTMLSelectElement).value))}>
                  <option value={0}>Don't delete anything</option>
                  <option value={3600}>Last hour</option>
                  <option value={86400}>Last 24 hours</option>
                  <option value={604800}>Last 7 days</option>
                </select>
              </Field> : null}
              <div class="row gap-8">
                <button class="btn btn-sm btn-danger" disabled={busy} onClick={() => void runModeration()}>{busy ? 'Working…' : action === 'kick' ? 'Confirm kick' : 'Confirm ban'}</button>
                <button class="btn btn-sm btn-ghost" disabled={busy} onClick={() => { setAction(null); setReason(''); }}>Cancel</button>
              </div>
            </div>}
          </div> : null}
        </SubCard> : <EmptySlop emoji="🕵️" title="Pick a member">Select someone from the list to inspect their vibes, roles and punishment history.</EmptySlop>}
      </div>
    </div>
  </SettingsSection>;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
