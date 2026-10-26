import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../../../lib/api';
import { useApp } from '../../../../lib/use-store';
import { can } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { AuditEntry } from '../../../../../shared/types';
import { fmtDateTime, fmtRelative } from '../../../../lib/format';
import { Avatar } from '../../../Avatar';
import { Icon } from '../../../Icons';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

const COMMON_ACTIONS = [
  'server.update', 'server.delete', 'server.transfer', 'member.leave', 'MEMBER_KICK', 'MEMBER_BAN', 'MEMBER_UNBAN',
  'MEMBER_UPDATE', 'MEMBER_TIMEOUT', 'MEMBER_ROLES_UPDATE', 'MEMBER_WARN', 'MEMBER_WARNING_DELETE',
  'ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE', 'channel.create', 'channel.update', 'channel.delete',
  'channel.reorder', 'channel.overrides', 'MESSAGE_DELETE', 'invite.create', 'invite.delete',
  'emoji.create', 'emoji.delete', 'sticker.create', 'sticker.delete', 'sound.create', 'sound.delete',
  'webhook.create', 'webhook.delete', 'event.create', 'event.update', 'event.delete', 'rule.create', 'rule.delete',
];

export function AuditTab({ serverId }: { serverId: string }) {
  const state = useApp();
  const view = can(state, Perm.VIEW_AUDIT_LOG, serverId);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = async (filter = action) => {
    if (!view) return;
    setLoading(true); setError('');
    try {
      const res = await api.get<{ entries: AuditEntry[] }>(`/api/servers/${serverId}/audit-log${filter ? `?action=${encodeURIComponent(filter)}&limit=100` : '?limit=100'}`);
      setEntries(res.entries ?? []);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(''); /* initial unfiltered view */ }, [serverId, view]);

  if (!view) return <SettingsSection title="Audit log" desc="Who did what, when, and with what degree of regret.">
    <SettingsNotice kind="warn">The audit log requires <span class="mono">View Audit Log</span>. Evidence of your own chaos is a privilege, not a right.</SettingsNotice>
  </SettingsSection>;

  return <SettingsSection title="Audit log" desc="Every server, role, channel, moderation and asset action, appended forever. No sneaky edits, no memory holes.">
    <SettingsError message={error} />
    <div class="row gap-8 wrap mb-16">
      <input class="input" list="srv-audit-actions" value={action} placeholder="Filter by exact action (e.g. MEMBER_KICK)" style={{ maxWidth: 320 }} onInput={(e) => setAction((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} />
      <datalist id="srv-audit-actions">{COMMON_ACTIONS.map((a) => <option value={a} />)}</datalist>
      <button class="btn btn-sm btn-primary" disabled={loading} onClick={() => void load()}>{loading ? 'Reading the scrolls…' : 'Apply filter'}</button>
      <button class="btn btn-sm" disabled={loading} onClick={() => { setAction(''); void load(''); }}><Icon name="refresh" size={13} /> Reset</button>
      <span class="srv-hint">{entries.length} entries (max 100)</span>
    </div>
    <SubCard title="Chronicle of slop">
      {entries.length ? <div class="srv-audit-list">
        {entries.map((entry) => <div class="srv-audit-row" key={entry.id}>
          <Avatar user={entry.actor} size={26} status={false} />
          <div class="grow" style={{ minWidth: 0 }}>
            <div class="row gap-8 wrap">
              <span class="srv-audit-action mono">{entry.action}</span>
              <span class="srv-hint">by {entry.actor?.displayName ?? 'unknown / deleted'}</span>
            </div>
            <div class="srv-hint truncate">
              {entry.targetType}{entry.targetId ? `: ${entry.targetId}` : ''} · {fmtDateTime(entry.createdAt)} ({fmtRelative(entry.createdAt)})
              {entry.reason ? ` · ${entry.reason}` : ''}
            </div>
            {entry.changes ? <div class="mt-4">
              <button class="btn-link" onClick={() => setOpen(open === entry.id ? null : entry.id)}>{open === entry.id ? 'hide changes' : 'show changes'}</button>
              {open === entry.id ? <pre class="srv-audit-json">{JSON.stringify(entry.changes, null, 2)}</pre> : null}
            </div> : null}
          </div>
          <span class="srv-hint mono truncate" style={{ maxWidth: 140 }}>{entry.id}</span>
        </div>)}
      </div> : <EmptySlop emoji="📜" title="No audit entries">Either nothing has happened, or the filter is too aggressive. History is a quiet place.</EmptySlop>}
    </SubCard>
  </SettingsSection>;
}
