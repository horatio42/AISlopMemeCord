import { useState } from 'preact/hooks';
import { api, errorMessage } from '../../lib/api';
import { fmtSize } from '../../lib/format';
import type { HealthInfo, LogsPayload } from '../types';
import {
  ConfirmDialog, CopyButton, Empty, ErrorNote, HealthSummary, Icon, Loading, PageHead, Panel,
  SuccessNote, Toggle, formatUptime, useLoad,
} from '../ui';

const LOG_LINE_OPTIONS = [50, 100, 250, 500, 1000];

export function MaintenancePage(props: { onChanged: () => void }) {
  const [includeMedia, setIncludeMedia] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ action: string; text: string } | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  async function downloadBackup() {
    setBackupBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.get<Response>(`/api/admin/backup${includeMedia ? '?media=1' : ''}`, { raw: true });
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `slop-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setFeedback(`Backup downloaded: ${filename} (${fmtSize(blob.size)}). The event is audited.`);
      props.onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function maintenance(action: string) {
    setBusyAction(action);
    setError(null);
    setActionResult(null);
    try {
      const res = await api.post<Record<string, unknown> & { action: string }>('/api/admin/maintenance', { action });
      setActionResult({ action, text: describeMaintenance(action, res) });
      props.onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div class="admin-content">
      <PageHead title="Backup & maintenance" subtitle="Export the slop, squeeze the database, and tidy up the corners. Every operation is audited." />
      <ErrorNote message={error} />
      <SuccessNote message={feedback} />

      <div class="admin-grid-2">
        <Panel title="Download backup" class="admin-card-warning">
          <p class="admin-copy">
            Creates a ZIP containing a consistent SQLite snapshot (<code>slop.db</code>), <code>manifest.json</code> with counts,
            and the sanitized <code>settings.json</code>. Media files are optional and can make the archive large.
          </p>
          <div class="admin-toggle-row">
            <Toggle checked={includeMedia} onChange={setIncludeMedia} label="Include uploaded media" />
          </div>
          <p class="admin-hint">The backup endpoint is rate-limited to 3 downloads per minute. The download is produced by a VACUUM INTO snapshot, not by copying a live file.</p>
          <button class="btn btn-primary" onClick={downloadBackup} disabled={backupBusy}>
            {backupBusy ? <span class="spinner" /> : <Icon name="download" size={15} />} Download backup ZIP
          </button>
        </Panel>

        <HealthCard />
      </div>

      <Panel title="Maintenance operations">
        <div class="admin-maint-grid">
          <MaintCard
            title="Vacuum database"
            desc="Runs PRAGMA optimize then VACUUM. Reclaims free pages. Brief write lock; do it during a quiet moment."
            icon="settings"
            busy={busyAction === 'vacuum'}
            disabled={!!busyAction}
            onClick={() => maintenance('vacuum')}
          />
          <MaintCard
            title="Checkpoint WAL"
            desc="Truncates the write-ahead log into the main database. Cheap, safe, occasionally satisfying."
            icon="refresh"
            busy={busyAction === 'checkpoint'}
            disabled={!!busyAction}
            onClick={() => maintenance('checkpoint')}
          />
          <MaintCard
            title="Prune login attempts"
            desc="Deletes failed/successful login attempt records older than 30 days. Keeps recent rate-limit history."
            icon="trash"
            busy={busyAction === 'prune_login_attempts'}
            disabled={!!busyAction}
            onClick={() => maintenance('prune_login_attempts')}
          />
          <MaintCard
            title="Clean up orphan uploads"
            desc="Removes upload rows (and files) whose message vanished, plus old unattached attachments. Destructive-ish."
            icon="alert"
            busy={busyAction === 'cleanup_orphan_uploads'}
            disabled={!!busyAction}
            onClick={() => setConfirmCleanup(true)}
            danger
          />
        </div>
        <SuccessNote message={actionResult ? `${actionResult.action.replace(/_/g, ' ')}: ${actionResult.text}` : null} />
      </Panel>

      <LogsViewer />

      <ConfirmDialog
        open={confirmCleanup}
        title="Clean up orphan uploads?"
        danger
        confirmLabel="Run cleanup"
        busy={busyAction === 'cleanup_orphan_uploads'}
        onClose={() => setConfirmCleanup(false)}
        onConfirm={async () => { await maintenance('cleanup_orphan_uploads'); setConfirmCleanup(false); }}
      >
        <p>This deletes upload rows and physical files that no longer belong to a message, plus attachments older than 24h with no message. It cannot be undone; restore from a backup if you regret it.</p>
      </ConfirmDialog>
    </div>
  );
}

export function LogsHealthPage() {
  return (
    <div class="admin-content">
      <PageHead title="Logs & health" subtitle="Local process health and the tail of logs/app.log. No external monitoring, no telemetry, no opinions." />
      <HealthCard />
      <LogsViewer tall />
    </div>
  );
}

function HealthCard() {
  const health = useLoad((signal) => api.get<HealthInfo>('/api/admin/health', { signal }), []);
  return (
    <Panel
      title="Instance health"
      actions={<button class="btn btn-xs" onClick={health.reload} disabled={health.loading}><Icon name="refresh" size={13} /> Refresh</button>}
    >
      <ErrorNote message={health.error} />
      {health.loading && !health.data ? <Loading label="Reading the pulse…" /> : health.data ? (
        <>
          <HealthSummary health={health.data} />
          <p class="admin-hint" style={{ marginTop: 12 }}>Uptime {formatUptime(health.data.uptime)} · heap {fmtSize(health.data.memory.heapUsed)} / {fmtSize(health.data.memory.heapTotal)} · Node {health.data.node}</p>
        </>
      ) : null}
    </Panel>
  );
}

export function LogsViewer(props: { tall?: boolean }) {
  const [lines, setLines] = useState(100);
  const logs = useLoad((signal) => api.get<LogsPayload>(`/api/admin/logs?lines=${lines}`, { signal }), [lines]);
  const text = (logs.data?.lines ?? []).join('\n');

  return (
    <Panel
      title="Application log tail"
      actions={(
        <>
          <select class="select admin-select-sm" value={lines} onChange={(e) => setLines(Number((e.target as HTMLSelectElement).value))} aria-label="Log line count">
            {LOG_LINE_OPTIONS.map((n) => <option key={n} value={n}>{n} lines</option>)}
          </select>
          <button class="btn btn-xs" onClick={logs.reload} disabled={logs.loading}><Icon name="refresh" size={13} /> Refresh</button>
          <CopyButton value={text} label="Copy log" />
        </>
      )}
    >
      <ErrorNote message={logs.error} />
      {logs.loading && !logs.data ? <Loading label="Tailing logs…" /> : !logs.data?.lines.length ? (
        <Empty emoji="📜" title="Log file is empty">Either everything is fine or logging fell in the slop.</Empty>
      ) : (
        <>
          <div class="admin-log-meta"><code>{logs.data.file}</code> · {logs.data.lines.length} lines</div>
          <pre class={`admin-log-view ${props.tall ? 'tall' : ''}`} aria-label="Application log contents">{text}</pre>
        </>
      )}
    </Panel>
  );
}

function MaintCard(props: { title: string; desc: string; icon: string; busy: boolean; disabled: boolean; onClick: () => void; danger?: boolean }) {
  return (
    <div class={`admin-maint-card ${props.danger ? 'danger' : ''}`}>
      <div class="admin-maint-icon"><Icon name={props.icon} size={18} /></div>
      <div class="grow">
        <h3>{props.title}</h3>
        <p class="admin-hint">{props.desc}</p>
      </div>
      <button class={`btn btn-sm ${props.danger ? 'btn-danger' : ''}`} disabled={props.disabled} onClick={props.onClick}>
        {props.busy ? <span class="spinner" /> : <Icon name="chevronRight" size={13} />} Run
      </button>
    </div>
  );
}

function describeMaintenance(action: string, res: Record<string, unknown>): string {
  if (action === 'vacuum') return `${fmtSize(Number(res.sizeBefore ?? 0))} → ${fmtSize(Number(res.sizeAfter ?? 0))} after VACUUM.`;
  if (action === 'checkpoint') return `WAL ${fmtSize(Number(res.walBefore ?? 0))} → ${fmtSize(Number(res.walAfter ?? 0))}.`;
  if (action === 'prune_login_attempts') return `${Number(res.removed ?? 0).toLocaleString()} login attempt rows removed.`;
  if (action === 'cleanup_orphan_uploads') return `${Number(res.rowsRemoved ?? 0).toLocaleString()} upload rows and ${Number(res.filesRemoved ?? 0).toLocaleString()} files removed.`;
  return 'Done.';
}
