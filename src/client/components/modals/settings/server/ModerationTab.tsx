import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { Report } from '../../../../../shared/types';
import { fmtDateTime, fmtRelative } from '../../../../lib/format';
import { Avatar } from '../../../Avatar';
import { Icon } from '../../../Icons';
import { Field } from '../../../Ui';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

interface WarningDto {
  id: string;
  user: { id: string; displayName: string; username: string; avatar: string | null } | null;
  moderator: { id: string; displayName: string } | null;
  reason: string;
  createdAt: number;
}

interface RuleDto {
  id: string;
  pattern: string;
  action: string;
  enabled: boolean;
  createdAt: number;
}

const ACTIONS = [
  { value: 'none', label: 'No extra action' },
  { value: 'delete_message', label: 'Delete reported message' },
  { value: 'timeout', label: 'Timeout the author' },
  { value: 'ban', label: 'Ban the author' },
];
const TIMEOUTS = [
  { value: 600_000, label: '10 minutes' },
  { value: 3_600_000, label: '1 hour' },
  { value: 86_400_000, label: '1 day' },
  { value: 604_800_000, label: '7 days' },
  { value: 2_419_200_000, label: '28 days' },
];

export function ModerationTab({ serverId, initialSection = 'reports' }: { serverId: string; initialSection?: 'reports' | 'warnings' | 'rules' }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const canReports = can(state, Perm.MANAGE_MESSAGES, serverId);
  const canWarnings = can(state, Perm.MODERATE_MEMBERS, serverId);
  const canRules = can(state, Perm.MANAGE_SERVER, serverId);
  const [section, setSection] = useState(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
  const [reports, setReports] = useState<Report[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [warnings, setWarnings] = useState<WarningDto[]>([]);
  const [rules, setRules] = useState<RuleDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmWarning, setConfirmWarning] = useState<string | null>(null);
  const [confirmRule, setConfirmRule] = useState<string | null>(null);
  const [reportAction, setReportAction] = useState<Record<string, string>>({});
  const [reportDuration, setReportDuration] = useState<Record<string, number>>({});
  const [reportResolution, setReportResolution] = useState<Record<string, string>>({});
  const [warningUser, setWarningUser] = useState('');
  const [warningReason, setWarningReason] = useState('');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleAction, setRuleAction] = useState('flag');

  useEffect(() => {
    if (canReports) void loadReports(statusFilter);
  }, [serverId, statusFilter, canReports]);
  useEffect(() => {
    if (canWarnings) void api.get<{ warnings: WarningDto[] }>(`/api/servers/${serverId}/warnings`)
      .then((r) => setWarnings(r.warnings ?? [])).catch((e) => setError(errorMessage(e)));
  }, [serverId, canWarnings]);
  useEffect(() => {
    if (!bundle) return;
    void api.get<{ rules: RuleDto[] }>(`/api/servers/${serverId}/rules`)
      .then((r) => setRules(r.rules ?? [])).catch((e) => setError(errorMessage(e)));
  }, [serverId]);

  if (!bundle) return <SettingsError message="Moderation tools fell into the slop pit." />;

  async function loadReports(status: string) {
    try {
      const res = await api.get<{ reports: Report[] }>(`/api/servers/${serverId}/reports${status === 'all' ? '' : `?status=${status}`}`);
      setReports(res.reports ?? []);
    } catch (e) { setError(errorMessage(e)); }
  }

  const resolveReport = async (report: Report, status: 'resolved' | 'dismissed') => {
    setBusy(true); setError('');
    try {
      const action = status === 'dismissed' ? 'none' : (reportAction[report.id] ?? 'none');
      const durationMs = action === 'timeout' ? (reportDuration[report.id] ?? 3_600_000) : null;
      const res = await api.patch<{ report: Report }>(`/api/reports/${report.id}`, {
        status, action, durationMs, resolution: reportResolution[report.id]?.trim() || null,
      });
      setReports((old) => {
        const next = old.map((r) => r.id === res.report.id ? res.report : r);
        return statusFilter === 'all' || statusFilter === res.report.status ? next : next.filter((r) => r.id !== res.report.id);
      });
      store.toast(status === 'resolved' ? 'Report resolved. Justice-ish served.' : 'Report dismissed. The void shrugs.', 'success', '⚖️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const addWarning = async () => {
    if (!warningUser || !warningReason.trim()) { setError('Pick a member and write a reason. Otherwise it is just bullying.'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post<{ warning: WarningDto }>(`/api/servers/${serverId}/warnings`, { userId: warningUser, reason: warningReason.trim() });
      setWarnings((old) => [res.warning, ...old]);
      setWarningUser(''); setWarningReason('');
      store.toast('Warning issued. A paper trail of disappointment.', 'success', '⚠️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const deleteWarning = async (id: string) => {
    setBusy(true); setError('');
    try {
      await api.del(`/api/servers/${serverId}/warnings/${id}`);
      setWarnings((old) => old.filter((w) => w.id !== id));
      setConfirmWarning(null);
      store.toast('Warning deleted. Forgetfulness, institutionalized.', 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const addRule = async () => {
    if (!rulePattern.trim()) { setError('A rule needs a pattern. Otherwise it is just a suggestion.'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post<{ rule: RuleDto }>(`/api/servers/${serverId}/rules`, { pattern: rulePattern.trim(), action: ruleAction, enabled: true });
      setRules((old) => [...old, res.rule]);
      setRulePattern('');
      store.toast('Rule created. The automod goblin is awake.', 'success', '🛡️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const deleteRule = async (id: string) => {
    setBusy(true); setError('');
    try {
      await api.del(`/api/rules/${id}`);
      setRules((old) => old.filter((r) => r.id !== id));
      setConfirmRule(null);
      store.toast('Rule deleted. Chaos regains a foothold.', 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return <SettingsSection title="Moderation" desc="Reports, warnings and automod rules. The janitorial arts of the slop empire.">
    <SettingsError message={error} />
    <div class="segmented mb-16">
      <button class={section === 'reports' ? 'active' : ''} onClick={() => setSection('reports')}>Reports {reports.length && section === 'reports' ? `(${reports.length})` : ''}</button>
      <button class={section === 'warnings' ? 'active' : ''} onClick={() => setSection('warnings')}>Warnings</button>
      <button class={section === 'rules' ? 'active' : ''} onClick={() => setSection('rules')}>Automod rules</button>
    </div>

    {section === 'reports' ? (!canReports
      ? <SettingsNotice kind="warn">Reports require <span class="mono">Manage Messages</span>. Your justice era must wait.</SettingsNotice>
      : <>
        <div class="row-between mb-8">
          <div class="row gap-8">
            <select class="select" value={statusFilter} style={{ width: 160 }} onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}>
              <option value="open">Open</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="all">All statuses</option>
            </select>
            <button class="btn btn-sm" onClick={() => void loadReports(statusFilter)}><Icon name="refresh" size={13} /> Refresh</button>
          </div>
          <span class="srv-hint">{reports.length} report{reports.length === 1 ? '' : 's'}</span>
        </div>
        {reports.length ? reports.map((report) => <div class="srv-report" key={report.id}>
          <div class="row-between">
            <div class="row gap-8">
              <Avatar user={report.reporter} size={24} status={false} />
              <div><div class="srv-card-title">Reported by {report.reporter.displayName}</div><div class="srv-hint">{fmtRelative(report.createdAt)} · {report.reason}</div></div>
            </div>
            <span class={`badge ${report.status === 'open' ? 'danger' : report.status === 'resolved' ? 'accent' : ''}`}>{report.status}</span>
          </div>
          {report.targetUser ? <div class="srv-hint mt-8">Target: <strong>{report.targetUser.displayName}</strong> (@{report.targetUser.username})</div> : null}
          {report.message ? <div class="srv-report-message">
            <Avatar user={report.message.author} size={20} status={false} />
            <div class="grow"><div class="srv-hint">{report.message.author.displayName} · {fmtDateTime(report.message.createdAt)}</div><div class="srv-report-content">{report.message.content || '(attachment-only message)'}</div></div>
          </div> : report.targetUser ? null : <div class="srv-hint mt-8">The reported message is not visible to you, or it no longer exists.</div>}
          {report.status === 'open' ? <div class="srv-report-controls">
            <select class="select" value={reportAction[report.id] ?? 'none'} onChange={(e) => setReportAction({ ...reportAction, [report.id]: (e.target as HTMLSelectElement).value })}>
              {ACTIONS.map((a) => <option value={a.value}>{a.label}</option>)}
            </select>
            {(reportAction[report.id] === 'timeout') ? <select class="select" value={reportDuration[report.id] ?? 3_600_000} onChange={(e) => setReportDuration({ ...reportDuration, [report.id]: Number((e.target as HTMLSelectElement).value) })}>
              {TIMEOUTS.map((t) => <option value={t.value}>{t.label}</option>)}
            </select> : null}
            <input class="input" placeholder="Resolution note (optional)" value={reportResolution[report.id] ?? ''} onInput={(e) => setReportResolution({ ...reportResolution, [report.id]: (e.target as HTMLInputElement).value })} />
            <button class="btn btn-sm btn-primary" disabled={busy} onClick={() => void resolveReport(report, 'resolved')}>Resolve</button>
            <button class="btn btn-sm btn-ghost" disabled={busy} onClick={() => void resolveReport(report, 'dismissed')}>Dismiss</button>
          </div> : report.resolution ? <div class="srv-hint mt-8">Resolution: {report.resolution}{report.resolvedBy ? ` — ${report.resolvedBy.displayName}` : ''}</div> : null}
        </div>) : <EmptySlop emoji="⚖️" title="No reports in this bucket">Either the server is peaceful, or nobody cares enough to snitch.</EmptySlop>}
      </>) : null}

    {section === 'warnings' ? (!canWarnings
      ? <SettingsNotice kind="warn">Warnings require <span class="mono">Timeout Members</span>. The admonishment queue is closed to you.</SettingsNotice>
      : <>
        <SubCard title="Issue a warning">
          <div class="row gap-8 wrap">
            <div class="grow" style={{ minWidth: 180 }}><Field label="Member">
              <select class="select" value={warningUser} onChange={(e) => setWarningUser((e.target as HTMLSelectElement).value)}>
                <option value="">— pick a member —</option>
                {bundle.members.map((m) => <option value={m.user.id}>{m.user.displayName} (@{m.user.username})</option>)}
              </select>
            </Field></div>
            <div class="grow" style={{ minWidth: 240 }}><Field label="Reason">
              <input class="input" value={warningReason} maxLength={500} placeholder="Spreading misinformation about beans" onInput={(e) => setWarningReason((e.target as HTMLInputElement).value)} />
            </Field></div>
            <button class="btn btn-primary mb-16" disabled={busy || !warningUser || !warningReason.trim()} onClick={() => void addWarning()}>Warn</button>
          </div>
        </SubCard>
        <SubCard title={`Warning history — ${warnings.length}`}>
          {warnings.length ? <div class="srv-warning-list">{warnings.map((w) => <div class="srv-warning-row" key={w.id}>
            <Icon name="alert" size={15} class="text-warning" />
            <div class="grow" style={{ minWidth: 0 }}>
              <div class="truncate"><strong>{w.user?.displayName ?? 'deleted user'}</strong> — {w.reason}</div>
              <div class="srv-hint">{w.moderator ? `by ${w.moderator.displayName}` : 'by unknown janitor'} · {fmtDateTime(w.createdAt)}</div>
            </div>
            {confirmWarning === w.id
              ? <><button class="btn btn-xs btn-danger" disabled={busy} onClick={() => void deleteWarning(w.id)}>Delete</button><button class="btn btn-xs btn-ghost" onClick={() => setConfirmWarning(null)}>Keep</button></>
              : <button class="btn-icon sm" title="Delete warning" onClick={() => setConfirmWarning(w.id)}><Icon name="trash" size={13} /></button>}
          </div>)}</div> : <EmptySlop emoji="⚠️" title="No warnings on record">Everyone is behaving. Suspicious.</EmptySlop>}
        </SubCard>
      </>) : null}

    {section === 'rules' ? <>
      {canRules ? <SubCard title="Add automod rule">
        <div class="row gap-8 wrap">
          <div class="grow" style={{ minWidth: 240 }}><Field label="Pattern" hint="A regex-ish pattern the moderation pipeline looks for. Be specific; the robot is literal.">
            <input class="input mono" value={rulePattern} maxLength={500} placeholder="(?i)(free\\s+nitro|discord\\.gift)" onInput={(e) => setRulePattern((e.target as HTMLInputElement).value)} />
          </Field></div>
          <div><Field label="Action">
            <select class="select" value={ruleAction} onChange={(e) => setRuleAction((e.target as HTMLSelectElement).value)}>
              <option value="flag">Flag for review</option><option value="delete">Delete message</option><option value="warn">Warn author</option>
              <option value="timeout">Timeout author</option><option value="ban">Ban author</option>
            </select>
          </Field></div>
          <button class="btn btn-primary mb-16" disabled={busy || !rulePattern.trim()} onClick={() => void addRule()}>Add rule</button>
        </div>
      </SubCard> : <SettingsNotice kind="warn">Automod rules can be viewed by everyone but only edited with <span class="mono">Manage Server</span>.</SettingsNotice>}
      <SubCard title={`Rules — ${rules.length}`}>
        {rules.length ? <div class="srv-rule-list">{rules.map((r) => <div class="srv-rule-row" key={r.id}>
          <span class="badge">{r.action}</span>
          <span class="mono grow truncate">{r.pattern}</span>
          <span class={`badge ${r.enabled ? 'accent' : ''}`}>{r.enabled ? 'enabled' : 'disabled'}</span>
          {canRules ? (confirmRule === r.id
            ? <><button class="btn btn-xs btn-danger" disabled={busy} onClick={() => void deleteRule(r.id)}>Delete</button><button class="btn btn-xs btn-ghost" onClick={() => setConfirmRule(null)}>Keep</button></>
            : <button class="btn-icon sm" title="Delete rule" onClick={() => setConfirmRule(r.id)}><Icon name="trash" size={13} /></button>) : null}
        </div>)}</div> : <EmptySlop emoji="🛡️" title="No automod rules">The robot is unarmed. Free nitro spam awaits.</EmptySlop>}
      </SubCard>
    </> : null}
  </SettingsSection>;
}
