import { useState } from 'preact/hooks';
import type { Message } from '../../../shared/types';
import { api, errorMessage } from '../../lib/api';
import { store } from '../../lib/use-store';
import { Modal, Field } from '../Ui';
import { Icon } from '../Icons';

const REASONS = [
  { id: 'spam', label: 'Spam or flooding', desc: 'Repeated nonsense, unsolicited ads, copy-paste attacks.' },
  { id: 'harassment', label: 'Harassment or hate', desc: 'Targeted abuse, threats, hateful conduct.' },
  { id: 'nsfw', label: 'NSFW / illegal', desc: 'Unmarked adult content, illegal content, gore.' },
  { id: 'doxxing', label: 'Doxxing / privacy', desc: 'Sharing private info without consent.' },
  { id: 'other', label: 'Other', desc: 'Something else that makes the pit worse.' },
];

export function ReportModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submit = async () => {
    setBusy(true); setError('');
    const picked = REASONS.find((r) => r.id === reason)!;
    try {
      await api.post(`/api/messages/${message.id}/report`, { reason: `${picked.label}${details.trim() ? ': ' + details.trim() : ''}`.slice(0, 1000) });
      setDone(true);
      store.toast('Report filed. The janitor will investigate.', 'success', '🚨');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title="Report this message" small footer={done ? <button class="btn btn-primary" onClick={onClose}>Close</button> : <><button class="btn btn-ghost" onClick={onClose}>Cancel</button><button class="btn btn-danger" onClick={submit} disabled={busy}>{busy ? 'Filing…' : 'Submit report'}</button></>}>
    <div class="modal-body">
      {done ? <div class="empty"><div class="empty-emoji">🚨</div><h3>Report received</h3><p>Server moderators and instance admins can review this message. Reports are private; the reported user is not told who reported them.</p></div> : <>
        {error ? <div class="auth-error">{error}</div> : null}
        <div class="card flat mb-16" style={{ padding: 10, fontSize: 12.5, borderLeft: '3px solid var(--border)' }}>
          <div class="row gap-8 mb-4"><strong>{message.author.displayName}</strong><span class="faint">{message.author.username}</span></div>
          <div class="muted" style={{ maxHeight: 80, overflow: 'hidden' }}>{message.encrypted ? '🔒 Encrypted message. Admins can see ciphertext context only.' : message.content.slice(0, 400) || '(attachment-only message)'}</div>
        </div>
        <Field label="Why are you reporting this?">
          <div class="col gap-4">{REASONS.map((r) => <label class="row gap-8 card flat" style={{ padding: '7px 10px', cursor: 'pointer', borderColor: reason === r.id ? 'var(--danger)' : undefined }} key={r.id}>
            <input type="radio" name="report-reason" checked={reason === r.id} onChange={() => setReason(r.id)} />
            <div><div style={{ fontSize: 12.5, fontWeight: 650 }}>{r.label}</div><div class="faint" style={{ fontSize: 10.5 }}>{r.desc}</div></div>
          </label>)}</div>
        </Field>
        <Field label="Extra context (optional)"><textarea class="textarea" rows={3} maxLength={800} placeholder="What should the moderator know?" value={details} onInput={(e) => setDetails((e.target as HTMLTextAreaElement).value)} /></Field>
        <p class="faint" style={{ fontSize: 10.5 }}><Icon name="shield" size={11} /> Report data is stored locally in /data. No external trust-and-safety vendor receives it.</p>
      </>}
    </div>
  </Modal>;
}
