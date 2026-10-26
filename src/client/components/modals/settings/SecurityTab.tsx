import { useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../../../lib/api';
import { store } from '../../../lib/use-store';
import { Field, Spinner } from '../../Ui';
import { Icon } from '../../Icons';

export function SecurityTab() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const changePassword = async () => {
    setError(''); setOk('');
    if (next !== confirm) { setError('New passwords do not match. Classic.'); return; }
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/password', { currentPassword: current, newPassword: next });
      setCurrent(''); setNext(''); setConfirm(''); setOk('Password changed. Other sessions were revoke-ified.');
      store.toast('Password updated. You are slightly safer now.', 'success', '🔐');
    } catch (e) { setError(e instanceof HttpError ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  };
  const startTotp = async () => {
    setError('');
    try { const res: any = await api.post('/api/auth/2fa/setup'); setTotpSetup(res); }
    catch (e) { setError(e instanceof HttpError ? e.message : errorMessage(e)); }
  };
  const enableTotp = async () => {
    setError('');
    try {
      await api.post('/api/auth/2fa/enable', { code });
      setTotpEnabled(true); setTotpSetup(null); setCode('');
      store.toast('Two-factor enabled. Your slop is now double-locked.', 'success', '🛡️');
    } catch (e) { setError(e instanceof HttpError ? e.message : errorMessage(e)); }
  };
  const disableTotp = async () => {
    setError('');
    try { await api.post('/api/auth/2fa/disable', { password: disablePassword }); setTotpEnabled(false); setDisablePassword(''); store.toast('2FA disabled. Bold move.', 'info'); }
    catch (e) { setError(e instanceof HttpError ? e.message : errorMessage(e)); }
  };
  return <div>
    <h3>Password & two-factor</h3>
    <p class="settings-desc">Local password hashing uses Argon2id. TOTP two-factor is compatible with any authenticator app, no SMS, no email, no "trusted device" cloud.</p>
    {error ? <div class="auth-error">{error}</div> : null}
    {ok ? <div class="auth-notice" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>{ok}</div> : null}
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="card-title">Change password</div>
      <Field label="Current password"><input class="input" type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent((e.target as HTMLInputElement).value)} /></Field>
      <div class="row gap-12 wrap">
        <div class="grow" style={{ minWidth: 180 }}><Field label="New password"><input class="input" type="password" autocomplete="new-password" value={next} onInput={(e) => setNext((e.target as HTMLInputElement).value)} /></Field></div>
        <div class="grow" style={{ minWidth: 180 }}><Field label="Confirm new password"><input class="input" type="password" autocomplete="new-password" value={confirm} onInput={(e) => setConfirm((e.target as HTMLInputElement).value)} /></Field></div>
      </div>
      <button class="btn btn-primary" disabled={busy || !current || !next} onClick={changePassword}>{busy ? <Spinner size={14} /> : 'Update password'}</button>
    </div>
    <div class="card flat" style={{ padding: 16 }}>
      <div class="row-between"><div class="card-title">Two-factor authentication (TOTP)</div><span class={`badge ${totpEnabled ? 'accent' : ''}`}>{totpEnabled ? 'enabled' : 'not confirmed'}</span></div>
      <p class="muted" style={{ fontSize: 12.5, margin: '4px 0 12px' }}>Adds a 6-digit rotating code to login. The secret never leaves this instance. No recovery codes yet — don't lose your authenticator.</p>
      {totpSetup ? <div>
        <div class="card" style={{ background: 'var(--bg-void)', padding: 12, marginBottom: 12 }}>
          <div class="label">Secret (enter manually)</div>
          <div class="mono" style={{ fontSize: 15, letterSpacing: '.08em', wordBreak: 'break-all', margin: '6px 0', color: 'var(--accent)' }}>{totpSetup.secret}</div>
          <div class="faint" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{totpSetup.uri}</div>
        </div>
        <div class="row gap-8">
          <input class="input mono" style={{ maxWidth: 160 }} inputMode="numeric" placeholder="123456" maxLength={6} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
          <button class="btn btn-primary" onClick={enableTotp} disabled={code.length !== 6}><Icon name="shield" size={14} /> Enable 2FA</button>
          <button class="btn btn-ghost" onClick={() => setTotpSetup(null)}>Cancel</button>
        </div>
      </div> : totpEnabled ? <div class="row gap-8"><input class="input" style={{ maxWidth: 220 }} type="password" placeholder="Password to disable" value={disablePassword} onInput={(e) => setDisablePassword((e.target as HTMLInputElement).value)} /><button class="btn btn-danger" onClick={disableTotp}>Disable 2FA</button></div> : <button class="btn" onClick={startTotp}><Icon name="lock" size={14} /> Set up 2FA</button>}
    </div>
    <div class="auth-notice mt-16">Instance admins: enable 2FA. The slop goblin does not want your admin account compromised.</div>
  </div>;
}
