import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { Field } from '../components/Ui';
import { fmtSize } from '../lib/format';

type Mode = 'login' | 'register';

export function AuthView() {
  const state = useApp();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [accountInvite, setAccountInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const instance = state.instance;
  const inviteCode = useMemo(() => {
    const m = location.pathname.match(/^\/invite\/([\w-]+)/);
    return m?.[1] ?? '';
  }, []);
  const [invite, setInvite] = useState<any>(null);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    if (state.user) return;
    if (inviteCode) api.get(`/api/invites/${inviteCode}`).then((r) => setInvite(r)).catch((e) => setInviteError(errorMessage(e)));
    else api.get('/api/instance').then((i) => { if (!store.state.instance) store.set({ instance: i }); }).catch(() => {});
  }, [inviteCode, state.user]);

  if (!state.authReady) {
    return <BootScreen />;
  }
  if (state.user) return null;

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setError(''); setFields({});
    try {
      if (mode === 'login') {
        await api.post('/api/auth/login', { username, password, ...(totp ? { totp } : {}) });
      } else {
        await api.post('/api/auth/register', { username, displayName: displayName || username, password, ...(accountInvite ? { accountInvite } : {}) });
      }
      // Full boot keeps session, WS and bootstrap ordering boringly reliable.
      location.assign(inviteCode ? `/invite/${inviteCode}` : (location.pathname.startsWith('/invite') ? '/' : location.pathname + location.search));
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.code === 'TOTP_REQUIRED') { setNeedTotp(true); setError('Two-factor code required. Check your authenticator.'); }
        else setError(err.message);
        setFields(err.fields ?? {});
      } else setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div class="landing">
      <div class="landing-left">
        <div class="ticker" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <div class="ticker-inner">{TICKER.concat(TICKER).map((t, i) => <span key={i}>{t}</span>)}</div>
        </div>
        <div class="landing-brand">
          <img src="/static/assets/brand/mascot.svg" alt="Slop Goblin" />
          <div>
            <div class="wordmark"><span class="ai">AISlop</span>MemeCord</div>
            <div class="tagline">Certified organic free-range slop</div>
          </div>
        </div>
        <h1 class="landing-title">Discord, but it fell into the <span class="highlight">slop pit.</span></h1>
        <p class="landing-sub">
          A <strong>privacy-first, single-container</strong> chat platform with servers, threads, forums, voice, DMs and an unreasonable
          amount of unresolved meme energy. No telemetry. No cloud. No adults.
        </p>
        <div class="feature-grid">
          <Feature emoji="🔒" title="Privacy absolutist" desc="Everything lives in /data. Zero telemetry, zero third-party CDNs, zero fed." />
          <Feature emoji="📦" title="One container" desc="SQLite + Bun + Preact. docker run, expose 3000, done. No Kubernetes cosplay." />
          <Feature emoji="💩" title="Meme native" desc="Slop Points, awards, copypastas, soundboard, shitpost meter. Functionally unhinged." />
          <Feature emoji="🛡️" title="Real admin console" desc="Separate /admin interface for users, servers, reports, backups and chaos." />
          <Feature emoji="🧵" title="Everything works" desc="Roles, permissions, threads, forums, reactions, polls, search, DMs, E2EE, voice." />
          <Feature emoji="🫡" title="AI slop, proud" desc="Vibe-coded with love, tests and a documentation that refuses to apologize." />
        </div>
        <div class="landing-stats">
          <Stat value={instance?.userCount ?? 0} label="Slop goblins" />
          <Stat value={instance?.serverCount ?? 0} label="Servers" />
          <Stat value={instance?.messageCount ?? 0} label="Shitposts" />
          <Stat value={instance?.onlineCount ?? 0} label="Online now" />
        </div>
        <div class="landing-memes">
          <div class="lm"><img src="/static/assets/memes/this-is-slop.svg" alt="This is slop meme" /><div class="cap">this is slop</div></div>
          <div class="lm"><img src="/static/assets/memes/touch-grass.svg" alt="Touch grass meme" /><div class="cap">touch grass</div></div>
          <div class="lm"><img src="/static/assets/memes/ratio.svg" alt="Ratio meme" /><div class="cap">skill issue</div></div>
        </div>
        <div class="landing-footer">
          <span class="privacy-pill">● no telemetry</span>
          <span>v{instance?.version ?? '1.0.0-slop'}</span>
          <span>{instance?.privacy?.vendors?.join(' · ')}</span>
          <span>Built by a goblin with a keyboard</span>
        </div>
      </div>
      <div class="landing-right">
        <div class="auth-card">
          <span class="auth-hero-badge badge purple">AI SLOP INSIDE</span>
          <img class="auth-mascot" src="/static/assets/brand/mascot.svg" alt="" />
          {invite ? (
            <div class="invite-preview mb-16">
              <div class="invite-server">
                {invite.server?.icon ? <img src={invite.server.icon} alt="" /> : <div class="avatar sq" style={{ width: 48, height: 48, fontSize: 20, background: 'linear-gradient(135deg, var(--purple), var(--pink))' }}>{(invite.server?.name ?? '?').charAt(0)}</div>}
                <div class="grow">
                  <div class="is-name">{invite.server?.name}</div>
                  <div class="is-desc">{invite.server?.description || 'A place of questionable vibes.'}</div>
                  <div class="faint" style={{ fontSize: 11 }}>{invite.server?.memberCount ?? 0} members · {invite.channel ? `#${invite.channel.name}` : 'the void'}</div>
                </div>
              </div>
              <div class="muted" style={{ fontSize: 12 }}>Log in or join the slop to accept this invite.</div>
            </div>
          ) : inviteCode && inviteError ? <div class="auth-error">{inviteError}</div> : null}
          <div class="auth-tabs">
            <button class={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
            <button class={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Register</button>
          </div>
          <h2>{mode === 'login' ? 'Welcome back, goblin' : 'Join the slop pit'}</h2>
          <p class="auth-sub">{mode === 'login' ? 'Your shitposts missed you.' : 'No email. No phone number. No algorithmic feed. Just slop.'}</p>
          {error ? <div class="auth-error">{error}</div> : null}
          {instance?.registration === 'closed' && mode === 'register' && (instance?.userCount ?? 0) > 0 ? <div class="auth-notice">Registration is closed on this instance. Ask an admin for an account invite, or log in if you already have an account.</div> : null}
          <form onSubmit={submit}>
            <Field label="Username" error={fields.username}>
              <input class="input" autocomplete="username" value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} placeholder="slop_goblin_69" required />
            </Field>
            {mode === 'register' ? (
              <>
                <Field label="Display name" error={fields.displayName} hint="The name people see. Choose chaos.">
                  <input class="input" value={displayName} onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)} placeholder="Goblin Mode" maxLength={32} />
                </Field>
               {(instance?.registration === 'invite') ? (
                  <Field label="Account invite" error={fields._} hint="This instance is invite-only. Ask an admin for a code.">
                    <input class="input" value={accountInvite} onInput={(e) => setAccountInvite((e.target as HTMLInputElement).value)} placeholder="invite code" />
                  </Field>
                ) : null}
              </>
            ) : null}
            <Field label="Password" error={fields.password} hint={mode === 'register' ? 'At least 8 characters. Even slop deserves Argon2id.' : undefined}>
              <div class="input-group">
                <input class="input" type={showPassword ? 'text' : 'password'} autocomplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} placeholder="••••••••••••" required minLength={8} />
                <button type="button" class="btn-icon" title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}><Icon name={showPassword ? 'eyeOff' : 'eye'} size={17} /></button>
              </div>
            </Field>
            {needTotp ? <Field label="Two-factor code" error={fields.totp}>
              <input class="input mono" inputMode="numeric" autocomplete="one-time-code" value={totp} onInput={(e) => setTotp((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
            </Field> : null}
            <button class="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
              {busy ? <><span class="spinner" style={{ width: 16, height: 16 }} /> {mode === 'login' ? 'Logging in…' : 'Creating slop…'}</> : mode === 'login' ? 'Enter the slop pit' : 'Create my slop account'}
            </button>
          </form>
          {mode === 'register' && instance?.userCount === 0 ? <div class="auth-notice mt-16">You are the <strong>first user</strong>. That makes you the instance admin. Use this power irresponsibly.</div> : null}
          <div class="auth-alt">
            {mode === 'login' ? <>No account? <button onClick={() => setMode('register')}>Make one</button></> : <>Already slop? <button onClick={() => setMode('login')}>Log in</button></>}
          </div>
          <div class="legal">By entering you accept that this is AI-generated nonsense, not a serious product.<br />No cookies except the one that keeps you logged in. No analytics. No cap.</div>
        </div>
      </div>
    </div>
  );
}

function Feature({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return <div class="feature"><div class="feature-emoji">{emoji}</div><div><div class="feature-title">{title}</div><div class="feature-desc">{desc}</div></div></div>;
}
function Stat({ value, label }: { value: number; label: string }) {
  return <div class="ls"><div class="value">{value.toLocaleString()}</div><div class="label">{label}</div></div>;
}
function BootScreen() {
  return <div class="center col" style={{ height: '100dvh', gap: 16 }}>
    <img src="/static/assets/brand/mascot.svg" alt="" style={{ width: 100, height: 100, animation: 'float 3s ease-in-out infinite' }} />
    <div class="spinner" />
    <p class="muted mono">booting the slop…</p>
  </div>;
}

const TICKER = [
  'BREAKING: local man discovers chat app, immediately regrets it',
  'Scientists confirm slop levels are at an all-time high',
  'The council will decide your fate (it is a Discord bot with a stutter)',
  'Area server has big "last place in group project" energy',
  'You have been visited by the Slop Goblin. Reply "slop" within 5 seconds.',
  'Sources: vibes are immaculate, grass remains untouched',
  'Ratio + L + no bitches + ratio again',
  'AI slop is the highest form of art, says nobody with a job',
];
