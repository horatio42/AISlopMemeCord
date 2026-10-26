import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, errorMessage, HttpError, onUnauthorized, setCsrfToken } from '../lib/api';
import type { InstanceInfo, User } from '../../shared/types';
import type { AdminUser, Overview } from './types';
import { Avatar, ErrorNote, Field, Icon, Modal, SuccessNote } from './ui';
import { DashboardPage } from './pages/dashboard';
import { UsersPage } from './pages/users';
import { ServersPage } from './pages/servers';
import { ReportsPage } from './pages/reports';
import { AuditPage } from './pages/audit';
import { InvitesPage } from './pages/invites';
import { SettingsPage } from './pages/settings';
import { AssetsPage } from './pages/assets';
import { LogsHealthPage, MaintenancePage } from './pages/system';

/* The build emits /static/styles/admin.css (slop + corporate overrides), but admin.html
   only links slop.css. Load the admin layer here so the corporate theme actually applies.
   Skip if the build ever learns to link it itself, and reuse the admin JS hash as a
   cache-busting version because the CSS file is served immutable. */
function ensureAdminStylesheet() {
  if (document.querySelector('link[href*="/styles/admin.css"]')) return;
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/admin-"]');
  const version = script?.src.split('admin-')[1]?.split('.')[0] ?? '1';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `/static/styles/admin.css?v=${encodeURIComponent(version)}`;
  link.dataset.adminStyles = '1';
  document.head.appendChild(link);
}
ensureAdminStylesheet();

interface MeResponse { user: User | null; csrfToken: string | null; instance: InstanceInfo }
interface LoginResponse { user: User | null; csrfToken: string | null; instance: InstanceInfo }

type Phase = 'boot' | 'login' | 'forbidden' | 'ready';

function AdminRoot() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [blockedUser, setBlockedUser] = useState<User | null>(null);
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);

  async function boot() {
    setPhase('boot');
    setGateError(null);
    try {
      const me = await api.get<MeResponse>('/api/auth/me');
      setCsrfToken(me.csrfToken);
      setInstance(me.instance);
      if (!me.user) { setPhase('login'); return; }
      if (!me.user.isAdmin) { setBlockedUser(me.user); setPhase('forbidden'); return; }
      try {
        const session = await api.get<{ user: AdminUser }>('/api/admin/session');
        setAdmin(session.user);
        setBlockedUser(null);
        setPhase('ready');
      } catch (e) {
        if (e instanceof HttpError && e.status === 403) {
          setBlockedUser(me.user);
          setPhase('forbidden');
        } else {
          setGateError(errorMessage(e));
          setPhase('login');
        }
      }
    } catch (e) {
      setGateError(errorMessage(e));
      setPhase('login');
    }
  }

  useEffect(() => { void boot(); }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setAdmin(null);
      setGateError('Your session expired or was revoked. Log back in to keep slopping.');
      setPhase('login');
    });
  }, []);

  async function signOut() {
    try { await api.post('/api/auth/logout'); } catch { /* cookie may already be gone */ }
    setAdmin(null);
    setBlockedUser(null);
    setGateError(null);
    setPhase('login');
  }

  if (phase === 'boot') return <BootScreen />;

  if (phase === 'login') {
    return (
      <LoginGate
        instance={instance}
        bootError={gateError}
        onReady={(next, nextInstance) => {
          setAdmin(next);
          setInstance(nextInstance);
          setGateError(null);
          setPhase('ready');
        }}
        onForbidden={(user, nextInstance) => {
          setBlockedUser(user);
          setInstance(nextInstance);
          setPhase('forbidden');
        }}
      />
    );
  }

  if (phase === 'forbidden') {
    return <ForbiddenGate user={blockedUser} onSignOut={signOut} onRetry={() => void boot()} />;
  }

  if (!admin) return <BootScreen />;
  return <AdminShell admin={admin} onSignOut={signOut} />;
}

function BootScreen() {
  return (
    <div class="admin-login">
      <div class="admin-boot" role="status" aria-live="polite">
        <img src="/static/assets/brand/logo.svg" alt="" />
        <div class="admin-boot-title">SLOP CONTROL</div>
        <div class="admin-boot-sub">Booting the compliance engine…</div>
        <span class="spinner" />
      </div>
    </div>
  );
}

function LoginGate(props: {
  instance: InstanceInfo | null;
  bootError: string | null;
  onReady: (admin: AdminUser, instance: InstanceInfo | null) => void;
  onForbidden: (user: User, instance: InstanceInfo | null) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(props.bootError);

  async function login(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/api/auth/login', {
        username: username.trim(),
        password,
        ...(needsTotp && totp.trim() ? { totp: totp.trim() } : {}),
      });
      setCsrfToken(res.csrfToken);
      if (!res.user) {
        setError('Login succeeded but the instance returned no user. Deeply suspicious.');
        return;
      }
      if (!res.user.isAdmin) {
        props.onForbidden(res.user, res.instance);
        return;
      }
      const session = await api.get<{ user: AdminUser }>('/api/admin/session');
      props.onReady(session.user, res.instance);
    } catch (err) {
      if (err instanceof HttpError && err.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError('Two-factor code required. Open your authenticator and try again.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="admin-login">
      <div class="admin-login-card">
        <div class="admin-login-brand">
          <img src="/static/assets/brand/logo.svg" alt="" />
          <div>
            <div class="admin-word">SLOP CONTROL</div>
            <div class="admin-sub">AISlopMemeCord instance administration</div>
          </div>
        </div>
        <h1 class="admin-login-title">Attendance is mandatory</h1>
        <p class="admin-copy admin-login-copy">
          {props.instance?.name ?? 'This instance'} is administered from this cold, blue room. Sign in with the same account you use in the chat.
        </p>
        <ErrorNote message={error} />
        <form onSubmit={login} class="admin-login-form">
          <Field label="Username">
            <input class="input" value={username} autocomplete="username" required onInput={(e) => setUsername((e.target as HTMLInputElement).value)} aria-label="Admin username" />
          </Field>
          <Field label="Password">
            <input class="input" type="password" value={password} autocomplete="current-password" required onInput={(e) => setPassword((e.target as HTMLInputElement).value)} aria-label="Admin password" />
          </Field>
          {needsTotp ? (
            <Field label="Two-factor code" hint="6-digit code from your authenticator app.">
              <input class="input" value={totp} inputMode="numeric" autocomplete="one-time-code" maxLength={8} onInput={(e) => setTotp((e.target as HTMLInputElement).value)} aria-label="Two-factor authentication code" autoFocus />
            </Field>
          ) : null}
          <button class="btn btn-primary btn-block" disabled={busy || !username.trim() || !password}>
            {busy ? <span class="spinner" /> : <Icon name="lock" size={15} />} Enter Slop Control
          </button>
        </form>

        {!needsTotp ? <button class="btn btn-link" onClick={() => setNeedsTotp(true)}>Have a 2FA code?</button> : null}

        <div class="admin-login-warning">
          <Icon name="shield" size={17} />
          <div>
            <strong>Audited, private, and local.</strong>
            <p>Every admin action is written to this instance's audit log with your account attached. There is no telemetry, no external analytics, and no outbound call-home. This console only talks to this server.</p>
          </div>
        </div>
        <a class="admin-login-back" href="/"><Icon name="chevronLeft" size={14} /> Back to the slop (chat)</a>
      </div>
    </div>
  );
}

function ForbiddenGate(props: { user: User | null; onSignOut: () => void; onRetry: () => void }) {
  return (
    <div class="admin-login">
      <div class="admin-login-card admin-forbidden">
        <div class="admin-forbidden-icon"><Icon name="shield" size={30} /></div>
        <div class="admin-boot-sub">403 · ADMINISTRATORS ONLY</div>
        <h1 class="admin-login-title">Not your slop.</h1>
        <p class="admin-copy">
          {props.user ? <>You are signed in as <strong>@{props.user.username}</strong>, but this account is not an instance administrator.</> : 'There is no admin session attached to this browser.'}
          {' '}This door is locked and the sign is written in a font you cannot argue with.
        </p>
        <div class="admin-forbidden-actions">
          <a class="btn btn-primary" href="/">Back to chat</a>
          <button class="btn" onClick={props.onRetry}><Icon name="refresh" size={14} /> Re-check session</button>
          <button class="btn btn-ghost" onClick={props.onSignOut}><Icon name="logout" size={14} /> Sign out</button>
        </div>
        <p class="admin-hint">If this is a mistake, ask an existing instance admin to promote you. Promotion is audited.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

const NAV = [
  { group: 'Overview', items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'home' },
    { key: 'users', label: 'Users', icon: 'users' },
    { key: 'servers', label: 'Servers', icon: 'hash' },
    { key: 'reports', label: 'Reports', icon: 'gavel' },
  ] },
  { group: 'Governance', items: [
    { key: 'audit', label: 'Audit log', icon: 'shield' },
    { key: 'invites', label: 'Invites', icon: 'gift' },
    { key: 'settings', label: 'Instance settings', icon: 'settings' },
  ] },
  { group: 'Operations', items: [
    { key: 'assets', label: 'Assets', icon: 'smile' },
    { key: 'maintenance', label: 'Backup & maintenance', icon: 'download' },
    { key: 'logs', label: 'Logs & health', icon: 'file' },
  ] },
] as const;

type RouteKey = typeof NAV[number]['items'][number]['key'];

const ROUTE_LABELS: Record<RouteKey, string> = {
  dashboard: 'Dashboard',
  users: 'Users',
  servers: 'Servers',
  reports: 'Reports',
  audit: 'Audit log',
  invites: 'Invites',
  settings: 'Instance settings',
  assets: 'Assets',
  maintenance: 'Backup & maintenance',
  logs: 'Logs & health',
};

function routeFromHash(): RouteKey {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  return raw && raw in ROUTE_LABELS ? raw as RouteKey : 'dashboard';
}

function AdminShell(props: { admin: AdminUser; onSignOut: () => void }) {
  const [route, setRoute] = useState<RouteKey>(routeFromHash);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  async function loadOverview(initial: boolean, silent = false) {
    if (initial) setOverviewLoading(true);
    else if (!silent) setRefreshing(true);
    try {
      const next = await api.get<Overview>('/api/admin/overview');
      setOverview(next);
      setOverviewError(null);
    } catch (e) {
      setOverviewError(errorMessage(e));
    } finally {
      if (initial) setOverviewLoading(false);
      if (!silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadOverview(true);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadOverview(false, true); }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash()); mainRef.current?.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(page: string) {
    const next = page in ROUTE_LABELS ? page as RouteKey : 'dashboard';
    if (location.hash.replace(/^#\/?/, '') !== next) location.hash = next;
    setRoute(next);
    mainRef.current?.scrollTo({ top: 0 });
  }

  const changeToken = () => { void loadOverview(false); };

  const page = (() => {
    switch (route) {
      case 'users': return <UsersPage adminId={props.admin.id} onChanged={changeToken} />;
      case 'servers': return <ServersPage onChanged={changeToken} />;
      case 'reports': return <ReportsPage onChanged={changeToken} />;
      case 'audit': return <AuditPage navigate={navigate} />;
      case 'invites': return <InvitesPage onChanged={changeToken} />;
      case 'settings': return <SettingsPage />;
      case 'assets': return <AssetsPage />;
      case 'maintenance': return <MaintenancePage onChanged={changeToken} />;
      case 'logs': return <LogsHealthPage />;
      default: return (
        <DashboardPage
          admin={props.admin}
          overview={overview}
          loading={overviewLoading}
          error={overviewError}
          refreshBusy={refreshing}
          onRefresh={() => void loadOverview(overview ? false : true)}
          navigate={navigate}
        />
      );
    }
  })();

  return (
    <div class="admin-app">
      <aside class="admin-sidebar" aria-label="Admin navigation">
        <div class="admin-brand">
          <img src="/static/assets/brand/logo.svg" alt="" />
          <div>
            <div class="admin-word">SLOP CONTROL</div>
            <div class="admin-sub">Internal affairs</div>
          </div>
        </div>
        <nav class="admin-nav">
          {NAV.map((group) => (
            <div key={group.group}>
              <div class="admin-nav-group">{group.group}</div>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  class={`admin-nav-item ${route === item.key ? 'active' : ''}`}
                  onClick={() => navigate(item.key)}
                  aria-current={route === item.key ? 'page' : undefined}
                >
                  <Icon name={item.icon} size={16} />
                  <span class="grow truncate">{item.label}</span>
                  {item.key === 'reports' && overview?.counts.openReports ? (
                    <span class="count" aria-label={`${overview.counts.openReports} open reports`}>{overview.counts.openReports > 99 ? '99+' : overview.counts.openReports}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div class="admin-sidebar-foot">
          <div class="admin-sidebar-admin">
            <Avatar user={props.admin} size={30} status={false} />
            <div class="min-w-0 grow">
              <div class="truncate admin-sidebar-name">{props.admin.displayName}</div>
              <div class="truncate admin-handle">@{props.admin.username}</div>
            </div>
            <button class="btn-icon sm" onClick={props.onSignOut} title="Sign out" aria-label="Sign out of admin"><Icon name="logout" size={15} /></button>
          </div>
          <div class="admin-sidebar-meta">No telemetry · All actions audited</div>
        </div>
      </aside>

      <main class="admin-main" ref={mainRef}>
        <header class="admin-topbar">
          <div class="admin-breadcrumb">
            <span>Slop Control</span>
            <Icon name="chevronRight" size={13} />
            <strong>{ROUTE_LABELS[route]}</strong>
          </div>
          <span class="grow" />
          <span class="admin-online" title="Connected gateway sessions">
            <span class="admin-online-dot" aria-hidden="true" />
            {overview ? `${overview.onlineCount.toLocaleString()} online` : '— online'}
          </span>
          <button class="btn btn-sm" onClick={() => setAnnounceOpen(true)}><Icon name="announcement" size={14} /> Announcement</button>
          <a class="btn btn-sm" href="/">Back to chat <Icon name="chevronRight" size={13} /></a>
          <div class="admin-topbar-user" title={props.admin.displayName}>
            <Avatar user={props.admin} size={28} status={false} />
            <span class="truncate">{props.admin.username}</span>
          </div>
          <button class="btn-icon sm" onClick={props.onSignOut} aria-label="Sign out of admin" title="Sign out"><Icon name="logout" size={15} /></button>
        </header>
        {page}
      </main>

      <AnnounceModal open={announceOpen} onClose={() => setAnnounceOpen(false)} onSent={changeToken} />
    </div>
  );
}

function AnnounceModal(props: { open: boolean; onClose: () => void; onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (props.open) { setError(null); setSent(null); }
  }, [props.open]);

  async function send() {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await api.post<{ count: number }>('/api/admin/announce', { title: title.trim(), body: body.trim() });
      setSent(`Sent to ${res.count.toLocaleString()} enabled user${res.count === 1 ? '' : 's'}. The instance audit log has receipts.`);
      setTitle('');
      setBody('');
      props.onSent();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={props.open}
      onClose={() => { if (!busy) props.onClose(); }}
      title="Announcement to every enabled user"
      footer={(
        <>
          <button class="btn" onClick={props.onClose} disabled={busy}>Close</button>
          <button class="btn btn-primary" onClick={send} disabled={busy || !title.trim() || !body.trim()}>
            {busy ? <span class="spinner" /> : <Icon name="announcement" size={15} />} Send announcement
          </button>
        </>
      )}
    >
      <div class="modal-body">
        <ErrorNote message={error} />
        <SuccessNote message={sent} />
        <div class="admin-card-warning admin-announce-warning">
          <Icon name="alert" size={16} />
          <span>This notifies <strong>every non-disabled account</strong> on the instance. There is no undo and no unsend button. Keep it short, clear, and at least 60% slop.</span>
        </div>
        <Field label="Title" hint="1–100 characters.">
          <input class="input" value={title} maxLength={100} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} aria-label="Announcement title" />
        </Field>
        <Field label="Message" hint="1–1000 characters. Plain text; no HTML or markdown pipeline.">
          <textarea class="textarea" rows={5} maxLength={1000} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} aria-label="Announcement message" />
        </Field>
        <p class="admin-hint">Sending is audited and rate limits from the notification service still apply.</p>
      </div>
    </Modal>
  );
}

render(<AdminRoot />, document.getElementById('admin-root')!);
