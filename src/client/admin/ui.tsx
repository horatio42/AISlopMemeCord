import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Modal, Spinner, Toggle, Field } from '../components/Ui';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icons';
import { errorMessage } from '../lib/api';
import { fmtDateTime, fmtRelative, fmtSize } from '../lib/format';
import type { User } from '../../shared/types';
import type { HealthInfo } from './types';

/* ------------------------------------------------------------------ hooks */

export function useLoad<T>(loader: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError(null);
    loader(controller.signal)
      .then((next) => { if (alive) { setData(next); setLoading(false); } })
      .catch((err) => {
        if (!alive || controller.signal.aborted) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => { alive = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1), setData };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* --------------------------------------------------------------- primitives */

export function PageHead(props: { title: string; subtitle?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class="admin-page-head">
      <div>
        <h1 class="admin-page-title">{props.title}</h1>
        {props.subtitle ? <p class="admin-page-sub">{props.subtitle}</p> : null}
      </div>
      {props.actions ? <div class="admin-page-actions">{props.actions}</div> : null}
    </div>
  );
}

export function Panel(props: { title?: ComponentChildren; actions?: ComponentChildren; children: ComponentChildren; class?: string; bodyClass?: string }) {
  return (
    <section class={`admin-panel ${props.class ?? ''}`}>
      {props.title !== undefined || props.actions ? (
        <header class="admin-panel-head">
          {props.title ? <h2>{props.title}</h2> : <span />}
          {props.actions ? <div class="row gap-8">{props.actions}</div> : null}
        </header>
      ) : null}
      <div class={`admin-panel-body ${props.bodyClass ?? ''}`}>{props.children}</div>
    </section>
  );
}

export function ErrorNote(props: { message?: string | null; onDismiss?: () => void }) {
  if (!props.message) return null;
  return (
    <div class="admin-error" role="alert">
      <Icon name="alert" size={15} />
      <span class="grow">{props.message}</span>
      {props.onDismiss ? <button class="btn-icon sm" onClick={props.onDismiss} aria-label="Dismiss error"><Icon name="close" size={14} /></button> : null}
    </div>
  );
}

export function SuccessNote(props: { message?: string | null }) {
  if (!props.message) return null;
  return (
    <div class="admin-success" role="status">
      <Icon name="check" size={15} />
      <span>{props.message}</span>
    </div>
  );
}

export function Loading(props: { label?: string }) {
  return <div class="admin-loading"><Spinner /> <span>{props.label ?? 'Consulting the slop ledger…'}</span></div>;
}

export function SkeletonRows(props: { rows?: number; cols?: number }) {
  const rows = props.rows ?? 6;
  const cols = props.cols ?? 5;
  return (
    <div class="admin-skeleton" aria-busy="true" aria-label="Loading table">
      {Array.from({ length: rows }, (_, r) => (
        <div class="admin-skeleton-row" key={r}>
          {Array.from({ length: cols }, (_, c) => <span class="admin-skeleton-cell" style={{ flex: c === 0 ? 1.6 : 1 }} key={c} />)}
        </div>
      ))}
    </div>
  );
}

export function Empty(props: { emoji?: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty admin-empty">
      <div class="empty-emoji" aria-hidden="true">{props.emoji ?? '🫠'}</div>
      <h3>{props.title}</h3>
      {props.children ? <p>{props.children}</p> : null}
    </div>
  );
}

export function Pager(props: { page: number; total: number; limit: number; onPage: (page: number) => void; loading?: boolean }) {
  const pages = Math.max(1, Math.ceil(props.total / Math.max(1, props.limit)));
  if (props.total === 0) return null;
  const from = (props.page - 1) * props.limit + 1;
  const to = Math.min(props.total, props.page * props.limit);
  return (
    <nav class="admin-pager" aria-label="Pagination">
      <span class="admin-pager-info">{from}–{to} of {props.total}</span>
      <div class="row gap-8">
        <button class="btn btn-sm" disabled={props.page <= 1 || props.loading} onClick={() => props.onPage(props.page - 1)} aria-label="Previous page">
          <Icon name="chevronLeft" size={15} /> Prev
        </button>
        <span class="admin-pager-page">Page {props.page} / {pages}</span>
        <button class="btn btn-sm" disabled={props.page >= pages || props.loading} onClick={() => props.onPage(props.page + 1)} aria-label="Next page">
          Next <Icon name="chevronRight" size={15} />
        </button>
      </div>
    </nav>
  );
}

export function Pill(props: { kind?: 'admin' | 'banned' | 'disabled' | 'open' | 'resolved' | 'dismissed' | 'public' | 'private'; children: ComponentChildren }) {
  return <span class={`admin-pill ${props.kind ?? ''}`}>{props.children}</span>;
}

export function StatusPills(props: { isAdmin?: boolean; disabled?: boolean; bannedUntil?: number | null }) {
  const now = Date.now();
  return (
    <span class="admin-pills">
      {props.isAdmin ? <Pill kind="admin"><Icon name="shield" size={10} /> Admin</Pill> : null}
      {props.disabled ? <Pill kind="disabled">Disabled</Pill> : null}
      {props.bannedUntil && props.bannedUntil > now ? <Pill kind="banned"><Icon name="ban" size={10} /> Suspended</Pill> : null}
      {!props.isAdmin && !props.disabled && !(props.bannedUntil && props.bannedUntil > now) ? <Pill>Member</Pill> : null}
    </span>
  );
}

/* ---------------------------------------------------------------- clipboard */

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton(props: { value: string; label?: string; class?: string; ariaLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      class={`btn btn-xs ${props.class ?? ''}`}
      aria-label={props.ariaLabel ?? `Copy ${props.label ?? 'value'}`}
      onClick={async () => {
        const ok = await copyText(props.value);
        setCopied(ok);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : props.label ?? 'Copy'}
    </button>
  );
}

/* ------------------------------------------------------------ confirmations */

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children?: ComponentChildren;
  confirmLabel?: string;
  expected?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (props.open) setTyped(''); }, [props.open]);
  const blocked = props.expected !== undefined && typed !== props.expected;
  return (
    <Modal
      open={props.open}
      onClose={() => { if (!props.busy) props.onClose(); }}
      title={props.title}
      small
      footer={
        <>
          <button class="btn" disabled={props.busy} onClick={props.onClose}>Cancel</button>
          <button class={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} disabled={blocked || props.busy} onClick={props.onConfirm}>
            {props.busy ? <Spinner size={14} /> : <Icon name={props.danger ? 'alert' : 'check'} size={15} />}
            {props.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div class="modal-body admin-confirm-body">
        <ErrorNote message={props.error} />
        {props.children}
        {props.expected !== undefined ? (
          <Field label={`Type “${props.expected}” to continue`} hint="This is the only speed bump between you and regret.">
            <input
              class="input"
              value={typed}
              onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
              aria-label={`Type ${props.expected} to confirm`}
              autoFocus
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- dashboards */

export function StatCard(props: { label: string; value: ComponentChildren; sub?: ComponentChildren; icon: string }) {
  return (
    <div class="admin-stat">
      <span class="as-icon" aria-hidden="true"><Icon name={props.icon} size={19} /></span>
      <div class="as-label">{props.label}</div>
      <div class="as-value">{props.value}</div>
      {props.sub ? <div class="as-sub">{props.sub}</div> : null}
    </div>
  );
}

export function BarChart(props: { points: { date: string; count: number }[]; label: string; tone?: 'signup' | 'message' }) {
  const max = Math.max(1, ...props.points.map((p) => p.count));
  const total = props.points.reduce((sum, p) => sum + p.count, 0);
  const first = props.points[0]?.date;
  const last = props.points[props.points.length - 1]?.date;
  return (
    <div class={`admin-chart ${props.tone === 'message' ? 'messages' : ''}`}>
      <div class="admin-chart-meta">
        <span>{total.toLocaleString()} total</span>
        <span>{first} → {last}</span>
      </div>
      <div class="admin-bar-chart" role="img" aria-label={`${props.label}: ${total} over ${props.points.length} days`}>
        {props.points.map((p) => (
          <div
            key={p.date}
            class="admin-bar"
            style={{ height: `${Math.max(2, Math.round((p.count / max) * 100))}%` }}
            aria-label={`${p.date}: ${p.count}`}
            title={`${p.date}: ${p.count}`}
          >
            <span class="bar-tip">{p.date.slice(5)}: {p.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UserCell(props: { user: { id?: string; username: string; displayName: string; avatar: string | null; status?: User['status'] } | null; size?: number }) {
  if (!props.user) return <span class="muted">unknown</span>;
  return (
    <div class="admin-user-cell">
      <Avatar user={props.user} size={props.size ?? 26} status={false} />
      <div class="min-w-0">
        <div class="name truncate">{props.user.displayName}</div>
        <div class="handle truncate">@{props.user.username}</div>
      </div>
    </div>
  );
}

export function HealthSummary(props: { health: HealthInfo | null; compact?: boolean }) {
  const h = props.health;
  if (!h) return <Loading label="Waking the health goblin…" />;
  return (
    <div class={`admin-health ${props.compact ? 'compact' : ''}`}>
      <div class="admin-health-status">
        <span class="admin-health-dot" aria-hidden="true" />
        <div>
          <div class="admin-health-label">Status</div>
          <div class="admin-health-value">{h.status === 'ok' ? 'Operational' : h.status}</div>
        </div>
      </div>
      <div><div class="admin-health-label">Version</div><div class="admin-health-value">{h.version}</div></div>
      <div><div class="admin-health-label">Uptime</div><div class="admin-health-value">{formatUptime(h.uptime)}</div></div>
      <div><div class="admin-health-label">Database</div><div class="admin-health-value">{fmtSize(h.dbSize)} <span class="muted">+ {fmtSize(h.walSize)} WAL</span></div></div>
      <div><div class="admin-health-label">RSS memory</div><div class="admin-health-value">{fmtSize(h.memory.rss)}</div></div>
      <div><div class="admin-health-label">Runtime</div><div class="admin-health-value">Bun {h.bun}</div></div>
    </div>
  );
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function TimeCell(props: { ts: number; relative?: boolean }) {
  return <time datetime={new Date(props.ts).toISOString()} title={fmtDateTime(props.ts)}>{props.relative === false ? fmtDateTime(props.ts) : fmtRelative(props.ts)}</time>;
}

export { Toggle, Field, Spinner, Modal, Icon, Avatar };
