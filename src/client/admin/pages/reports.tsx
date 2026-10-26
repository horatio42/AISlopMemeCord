import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import type { Paged, Report } from '../types';
import {
  Empty, ErrorNote, Field, Icon, Loading, Modal, PageHead, Pager, SkeletonRows,
  SuccessNote, TimeCell, UserCell, useLoad,
} from '../ui';

const PAGE_SIZE = 50;
const DURATIONS = [
  { label: '5 minutes', value: 5 * 60_000 },
  { label: '10 minutes', value: 10 * 60_000 },
  { label: '1 hour', value: 60 * 60_000 },
  { label: '6 hours', value: 6 * 60 * 60_000 },
  { label: '1 day', value: 24 * 60 * 60_000 },
  { label: '7 days', value: 7 * 24 * 60 * 60_000 },
  { label: '28 days', value: 28 * 24 * 60 * 60_000 },
];

export function ReportsPage(props: { onChanged: () => void }) {
  const [status, setStatus] = useState<'open' | 'resolved' | 'dismissed' | 'all'>('open');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Report | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [status]);

  const list = useLoad(
    (signal) => api.get<Paged<{ reports: Report[] }>>(`/api/admin/reports${qs({ status, page, limit: PAGE_SIZE })}`, { signal }),
    [status, page],
  );

  const reports = list.data?.reports ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div class="admin-content">
      <PageHead
        title="Reports"
        subtitle={<>The complaint queue. Encrypted messages stay encrypted: this console never attempts to decrypt E2EE content.</>}
        actions={<button class="btn" onClick={list.reload} disabled={list.loading}><Icon name="refresh" size={15} /> Refresh</button>}
      />
      <SuccessNote message={feedback} />
      <ErrorNote message={list.error} />

      <div class="admin-toolbar">
        <div class="admin-segmented" role="group" aria-label="Filter reports by status">
          {(['open', 'resolved', 'dismissed', 'all'] as const).map((s) => (
            <button key={s} class={`admin-segment ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)} aria-pressed={status === s}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <span class="grow" />
        <span class="admin-panel-note">{total.toLocaleString()} report{total === 1 ? '' : 's'}</span>
      </div>

      {list.loading && !list.data ? <SkeletonRows rows={6} cols={3} /> : reports.length === 0 && !list.loading ? (
        <Empty emoji="🧘" title={status === 'open' ? 'No open reports' : 'Nothing here'}>
          {status === 'open' ? 'The queue is empty. Either everyone is behaving or nobody cares.' : 'No reports match that status. Try another filter.'}
        </Empty>
      ) : (
        <div class={list.loading ? 'is-refreshing' : ''}>
          {reports.map((report) => (
            <article class="admin-report-card" key={report.id}>
              <div class="report-head">
                <span class={`admin-pill ${report.status}`}>{report.status}</span>
                <span class="admin-report-reason-label">Report reason</span>
                <span class="grow" />
                <TimeCell ts={report.createdAt} />
              </div>

              <div class="admin-report-people">
                <div><span class="admin-kicker">Reporter</span><UserCell user={report.reporter} size={24} /></div>
                <Icon name="arrowUp" size={14} class="admin-report-arrow" />
                <div><span class="admin-kicker">Target</span>{report.targetUser ? <UserCell user={report.targetUser} size={24} /> : <span class="muted">message-only report</span>}</div>
                <span class="grow" />
                {report.serverName ? <span class="admin-report-context"><Icon name="home" size={13} /> {report.serverName}{report.channelName ? ` · #${report.channelName}` : ''}</span> : <span class="admin-report-context"><Icon name="thread" size={13} /> Direct context</span>}
              </div>

              <div class="report-reason">{report.reason}</div>

              {report.message ? (
                <div class="report-message">
                  <div class="admin-report-message-meta">
                    <span>Message by {report.message.author ? `@${report.message.author.username}` : 'unknown'}</span>
                    <span>{fmtDateTime(report.message.createdAt)}</span>
                    {report.message.deletedAt ? <span class="admin-pill disabled">Already deleted</span> : null}
                  </div>
                  {report.message.encrypted ? (
                    <div class="admin-privacy-note"><Icon name="lock" size={14} /> Encrypted message. Ciphertext is not exposed to this console; Slop Control never decrypts E2EE content.</div>
                  ) : report.message.content ? (
                    <blockquote class="admin-message-quote">{report.message.content}</blockquote>
                  ) : (
                    <div class="admin-privacy-note"><Icon name="lock" size={14} /> Message content is unavailable (deleted, encrypted, or too sloppy to render).</div>
                  )}
                </div>
              ) : (
                <div class="admin-privacy-note"><Icon name="info" size={14} /> No message attached to this report.</div>
              )}

              {report.status === 'open' ? (
                <div class="admin-report-actions">
                  <button class="btn btn-sm btn-primary" onClick={() => setSelected(report)}><Icon name="gavel" size={14} /> Resolve report</button>
                </div>
              ) : (
                <div class="admin-resolution">
                  <div><span class="admin-kicker">Resolution</span> {report.resolution || <span class="muted">No note left.</span>}</div>
                  <div><span class="admin-kicker">Handled by</span> {report.resolvedBy ? `${report.resolvedBy.displayName} (@${report.resolvedBy.username})` : 'system'} {report.resolvedAt ? `· ${fmtDateTime(report.resolvedAt)}` : ''}</div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <Pager page={page} total={total} limit={PAGE_SIZE} onPage={setPage} loading={list.loading} />

      <ResolveDialog
        report={selected}
        onClose={() => setSelected(null)}
        onDone={(message) => {
          setSelected(null);
          setFeedback(message);
          list.reload();
          props.onChanged();
        }}
      />
    </div>
  );
}

function ResolveDialog(props: { report: Report | null; onClose: () => void; onDone: (message: string) => void }) {
  const [status, setStatus] = useState<'resolved' | 'dismissed'>('resolved');
  const [resolution, setResolution] = useState('');
  const [action, setAction] = useState<'none' | 'delete_message' | 'timeout' | 'ban'>('none');
  const [durationMs, setDurationMs] = useState(3_600_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.report) return;
    setStatus('resolved');
    setResolution('');
    setAction('none');
    setError(null);
    setBusy(false);
  }, [props.report?.id]);

  const report = props.report;
  const canDelete = !!report?.message;
  const canSanction = !!report?.serverId && !!report?.targetUser;
  const effectiveAction = (action === 'delete_message' && !canDelete) || ((action === 'timeout' || action === 'ban') && !canSanction)
    ? 'none'
    : action;

  async function submit() {
    if (!report) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ actionApplied: string; alreadyResolved?: boolean }>(`/api/admin/reports/${report.id}/resolve`, {
        status,
        resolution: resolution.trim() || null,
        action: effectiveAction,
        ...(effectiveAction === 'timeout' ? { durationMs } : {}),
      });
      const applied = res.actionApplied && res.actionApplied !== 'none' ? ` Action: ${res.actionApplied.replace('_', ' ')}.` : '';
      props.onDone(`Report ${status}.${applied} Reporter was notified by the slop mail service.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={report !== null}
      onClose={() => { if (!busy) props.onClose(); }}
      title="Resolve report"
      footer={(
        <>
          <button class="btn" onClick={props.onClose} disabled={busy}>Cancel</button>
          <button class="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span class="spinner" /> : <Icon name="gavel" size={15} />} Resolve
          </button>
        </>
      )}
    >
      <div class="modal-body">
        <ErrorNote message={error} />
        {report ? (
          <>
            <div class="admin-report-summary">
              <span class="admin-kicker">Reported by</span> {report.reporter ? `@${report.reporter.username}` : 'unknown'}
              <span class="admin-kicker">Against</span> {report.targetUser ? `@${report.targetUser.username}` : 'the message, apparently'}
              <span class="admin-kicker">Context</span> {report.serverName ?? 'instance'}{report.channelName ? ` / #${report.channelName}` : ''}
            </div>
            <Field label="Outcome">
              <select class="select" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as 'resolved' | 'dismissed')} aria-label="Report outcome">
                <option value="resolved">Resolved — action will be recorded</option>
                <option value="dismissed">Dismissed — no action needed</option>
              </select>
            </Field>
            <Field label="Resolution note" hint="Optional, up to 500 characters. The reporter receives this in a notification.">
              <textarea class="textarea" rows={3} maxLength={500} value={resolution} onInput={(e) => setResolution((e.target as HTMLTextAreaElement).value)} placeholder="What happened, and what should the next janitor know?" aria-label="Resolution note" />
            </Field>
            <Field label="Moderation action" hint="Actions apply before the report is marked closed. Bans and timeouts need a server member target.">
              <select class="select" value={effectiveAction} onChange={(e) => setAction((e.target as HTMLSelectElement).value as typeof action)} aria-label="Moderation action">
                <option value="none">No action</option>
                <option value="delete_message" disabled={!canDelete}>Delete reported message{canDelete ? '' : ' — no message attached'}</option>
                <option value="timeout" disabled={!canSanction}>Timeout target member{canSanction ? '' : ' — no server member'}</option>
                <option value="ban" disabled={!canSanction}>Ban target member{canSanction ? '' : ' — no server member'}</option>
              </select>
            </Field>
            {effectiveAction === 'timeout' ? (
              <Field label="Timeout duration">
                <select class="select" value={durationMs} onChange={(e) => setDurationMs(Number((e.target as HTMLSelectElement).value))} aria-label="Timeout duration">
                  {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>
            ) : null}
            {effectiveAction === 'ban' ? (
              <div class="admin-privacy-note"><Icon name="alert" size={14} /> Banning removes the user from the server and records a ban entry. This is audited and reversible only from the server's ban list.</div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
