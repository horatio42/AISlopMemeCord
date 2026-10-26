import { useState } from 'preact/hooks';
import { api, errorMessage, downloadUrl } from '../../../lib/api';
import { store, useApp } from '../../../lib/use-store';
import { Field, Spinner } from '../../Ui';
import { Icon } from '../../Icons';
import { exportPrivateKey, importPrivateKey } from '../../../lib/e2ee';

export function PrivacyTab() {
  const state = useApp();
  const user = state.user!;
  const [exportPassword, setExportPassword] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [keyReveal, setKeyReveal] = useState(false);
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const privateKey = exportPrivateKey(user.id);
  const doExport = async () => {
    setExporting(true); setError('');
    try {
      const res = await api.post<Response>('/api/auth/export', exportPassword ? { password: exportPassword } : {}, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `aislopmemecord-export-${user.username}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      store.toast('Data export downloaded. Contains 100% of your slop.', 'success', '📦');
    } catch (e) { setError(errorMessage(e)); }
    finally { setExporting(false); }
  };
  const doDelete = async () => {
    if (deleteConfirm !== 'DELETE MY SLOP') { setError('Type the exact phrase to confirm.'); return; }
    if (!confirm('Permanently delete your account, owned servers and messages? This cannot be undone.')) return;
    setDeleting(true); setError('');
    try {
      await api.post('/api/auth/delete', { password: deletePassword });
      location.assign('/');
    } catch (e) { setError(errorMessage(e)); setDeleting(false); }
  };
  const copyKey = async () => {
    if (!privateKey) return;
    try { await navigator.clipboard.writeText(privateKey); store.toast('Private key copied. Do NOT paste it in chat.', 'success', '🔑'); }
    catch { /* ignore */ }
  };
  const downloadKey = () => {
    if (!privateKey) return;
    const blob = new Blob([privateKey], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `slop-e2ee-key-${user.username}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const doImport = async () => {
    setError('');
    try {
      importPrivateKey(user.id, importText.trim());
      const parsed = JSON.parse(importText.trim());
      const pub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: parsed.x, y: parsed.y });
      await api.post('/api/users/@me/keys', { publicKey: pub });
      setImportText(''); store.toast('E2EE key imported and public key synced.', 'success', '🔑');
    } catch (e) { setError('Invalid key backup: ' + errorMessage(e)); }
  };
  return <div>
    <h3>Privacy & data</h3>
    <p class="settings-desc">No ads, no trackers, no selling your data because there is nobody to sell it to. Everything lives in <span class="mono">/data</span> on the instance host.</p>
    {error ? <div class="auth-error">{error}</div> : null}
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="card-title"><Icon name="download" size={16} /> Export your data</div>
      <p class="muted" style={{ fontSize: 12.5, margin: '4px 0 12px' }}>A ZIP containing profile, messages, servers, friendships, DM metadata and your uploaded files as plain JSON and originals. No proprietary format, no lock-in.</p>
      <div class="row gap-8"><input class="input" style={{ maxWidth: 240 }} type="password" placeholder="Password (optional)" value={exportPassword} onInput={(e) => setExportPassword((e.target as HTMLInputElement).value)} /><button class="btn btn-primary" disabled={exporting} onClick={doExport}>{exporting ? <Spinner size={14} /> : 'Download export'}</button></div>
      <div class="faint" style={{ fontSize: 10.5, marginTop: 6 }}>Password is only checked if you supply one. Exports contain sensitive content by definition.</div>
    </div>
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="card-title"><Icon name="lock" size={16} /> End-to-end encryption keys</div>
      <p class="muted" style={{ fontSize: 12.5, margin: '4px 0 12px' }}>Your E2EE private key lives in this browser's localStorage and never reaches the server. Back it up before clearing site data, or old encrypted DMs become permanent noise.</p>
      {privateKey ? <div>
        <div class="auth-notice" style={{ color: 'var(--warning)' }}>Treat this key like a password. Anyone with it can decrypt your encrypted DMs.</div>
        <div class="row gap-8 wrap">
          <button class="btn btn-sm" onClick={() => setKeyReveal(!keyReveal)}><Icon name="eye" size={13} /> {keyReveal ? 'Hide' : 'Reveal'} private key</button>
          <button class="btn btn-sm" onClick={copyKey}><Icon name="copy" size={13} /> Copy</button>
          <button class="btn btn-sm" onClick={downloadKey}><Icon name="download" size={13} /> Download backup</button>
        </div>
        {keyReveal ? <pre class="md-codeblock" style={{ marginTop: 10, padding: 10, fontSize: 10.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 150, overflow: 'auto' }}>{privateKey}</pre> : null}
      </div> : <div class="auth-notice">No private key found on this device. Encrypted messages from before this device will not decrypt.</div>}
      <div class="divider" />
      <div class="label mb-4">Restore a key backup</div>
      <textarea class="textarea mono" rows={3} style={{ fontSize: 11 }} placeholder='Paste the private JWK backup here…' value={importText} onInput={(e) => setImportText((e.target as HTMLTextAreaElement).value)} />
      <button class="btn btn-sm mt-8" disabled={!importText.trim()} onClick={doImport}>Import & sync</button>
    </div>
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="card-title">What the server knows</div>
      <ul class="muted" style={{ fontSize: 12.5, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Your username, Argon2id password hash, profile fields and content you post in server channels.</li>
        <li>DM ciphertext for E2EE conversations. The plaintext is never transmitted.</li>
        <li>Session token hashes, login attempt counts, and a browser user-agent for session display.</li>
        <li>No IP history beyond short-lived login-attempt throttling and optional session IP hashes.</li>
        <li>No telemetry, no analytics vendor, no third-party requests. The CSP forbids it.</li>
      </ul>
    </div>
    <div class="card flat" style={{ padding: 16, borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)' }}>
      <div class="card-title text-danger"><Icon name="alert" size={16} /> Delete account</div>
      <p class="muted" style={{ fontSize: 12.5, margin: '4px 0 12px' }}>Deletes your account, owned servers, messages, memberships, uploads and sessions via database cascades. There is no undo, no grace period and no customer support goblin.</p>
      <div class="row gap-8 wrap">
        <input class="input" style={{ maxWidth: 220 }} type="password" placeholder="Password" value={deletePassword} onInput={(e) => setDeletePassword((e.target as HTMLInputElement).value)} />
        <input class="input mono" style={{ maxWidth: 200 }} placeholder="DELETE MY SLOP" value={deleteConfirm} onInput={(e) => setDeleteConfirm((e.target as HTMLInputElement).value)} />
        <button class="btn btn-danger" disabled={deleting || !deletePassword || deleteConfirm !== 'DELETE MY SLOP'} onClick={doDelete}>{deleting ? <Spinner size={14} /> : 'Delete forever'}</button>
      </div>
    </div>
    {user.isAdmin ? <div class="admin-card-warning card mt-16" style={{ padding: 14 }}><strong>You are an instance admin.</strong> You can access Slop Control at <a href="/admin">/admin</a>. Instance admins can manage accounts/servers and read reported message context, but not encrypted DM plaintext.</div> : null}
  </div>;
}
