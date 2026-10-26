import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../../lib/api';
import type { AdminSettings } from '../types';
import {
  Empty, ErrorNote, Icon, Loading, PageHead, Panel, SuccessNote, Toggle, useLoad,
} from '../ui';

const REGISTRATION_COPY: Record<AdminSettings['registration'], string> = {
  open: 'Open registration: anyone who can reach the instance can create an account. Account invite codes are optional but still usable.',
  invite: 'Invite-only registration: creating an account requires a valid account invite code. Mint these in the Invites page. Existing unused codes stay valid.',
  closed: 'Closed registration: no new accounts can be created. The first-user bootstrap is already spent. Account invites cannot currently open the door.',
};

export function SettingsPage() {
  const load = useLoad((signal) => api.get<{ settings: AdminSettings }>('/api/admin/settings', { signal }), []);
  const [form, setForm] = useState<AdminSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (load.data) setForm({ ...load.data.settings });
  }, [load.data]);

  function set<K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  function validate(f: AdminSettings): Record<string, string> {
    const out: Record<string, string> = {};
    if (!f.instance_name.trim()) out.instance_name = 'The instance needs a name. Even the void has branding.';
    else if (f.instance_name.trim().length > 64) out.instance_name = '64 characters max.';
    if (f.instance_description.length > 500) out.instance_description = '500 characters max.';
    if (f.motd.length > 500) out.motd = '500 characters max.';
    if (!Number.isInteger(f.max_upload_mb) || f.max_upload_mb < 1 || f.max_upload_mb > 500) out.max_upload_mb = 'Use a whole number between 1 and 500.';
    if (!f.meme_mode.trim() || f.meme_mode.trim().length > 32) out.meme_mode = 'Meme mode needs 1–32 characters of pure attitude.';
    if (f.slop_of_the_day.length > 500) out.slop_of_the_day = '500 characters max.';
    return out;
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!form) return;
    const nextFields = validate(form);
    setFields(nextFields);
    setError(null);
    setFeedback(null);
    if (Object.keys(nextFields).length) {
      setError('Some fields need attention before the slop can be saved.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        instance_name: form.instance_name.trim(),
        instance_description: form.instance_description,
        motd: form.motd,
        registration: form.registration,
        max_upload_mb: form.max_upload_mb,
        e2ee_enabled: form.e2ee_enabled,
        soundboard_enabled: form.soundboard_enabled,
        voice_enabled: form.voice_enabled,
        forum_enabled: form.forum_enabled,
        webhooks_enabled: form.webhooks_enabled,
        public_discovery: form.public_discovery,
        meme_mode: form.meme_mode.trim(),
        slop_of_the_day: form.slop_of_the_day,
      };
      const res = await api.patch<{ settings: AdminSettings; changed: string[] }>('/api/admin/settings', payload);
      setForm({ ...res.settings });
      setFeedback(res.changed.length
        ? `Saved ${res.changed.length} change${res.changed.length === 1 ? '' : 's'}: ${res.changed.join(', ')}. Audit entry written.`
        : 'No changes to save. The slop is already exactly this sloppy.');
    } catch (err) {
      if (err instanceof HttpError && err.fields) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (load.loading && !form) return <div class="admin-content"><Loading label="Fetching instance settings from the vault…" /></div>;
  if (load.error && !form) return <div class="admin-content"><ErrorNote message={load.error} /><button class="btn" onClick={load.reload}>Retry</button></div>;
  if (!form) return <div class="admin-content"><Empty emoji="⚙️" title="No settings">The settings table is empty. Inexplicable, but on-brand.</Empty></div>;

  return (
    <div class="admin-content admin-narrow">
      <PageHead title="Instance settings" subtitle="Change the vibe. Every save is validated server-side and written to the audit log." />
      <ErrorNote message={error} />
      <ErrorNote message={load.error} />
      <SuccessNote message={feedback} />

      <form onSubmit={save}>
        <Panel title="Identity" class="admin-settings-group">
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Instance name</div><div class="hint">Shown in the client, landing page and browser title. 1–64 characters.</div></div>
            <div>
              <input class="input" value={form.instance_name} maxLength={64} onInput={(e) => set('instance_name', (e.target as HTMLInputElement).value)} aria-label="Instance name" />
              {fields.instance_name ? <div class="admin-field-error">{fields.instance_name}</div> : null}
            </div>
          </div>
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Description</div><div class="hint">Public-facing sales pitch for the slop. 500 characters max.</div></div>
            <div>
              <textarea class="textarea" rows={3} maxLength={500} value={form.instance_description} onInput={(e) => set('instance_description', (e.target as HTMLTextAreaElement).value)} aria-label="Instance description" />
              {fields.instance_description ? <div class="admin-field-error">{fields.instance_description}</div> : null}
            </div>
          </div>
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Message of the day</div><div class="hint">Broadcast on the landing page and to fresh logins. Keep it legally distinct.</div></div>
            <div>
              <textarea class="textarea" rows={2} maxLength={500} value={form.motd} onInput={(e) => set('motd', (e.target as HTMLTextAreaElement).value)} aria-label="Message of the day" />
              {fields.motd ? <div class="admin-field-error">{fields.motd}</div> : null}
            </div>
          </div>
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Meme mode</div><div class="hint">House style keyword. Free text, 1–32 chars, no functional guarantee.</div></div>
            <div>
              <input class="input" value={form.meme_mode} maxLength={32} onInput={(e) => set('meme_mode', (e.target as HTMLInputElement).value)} aria-label="Meme mode" />
              {fields.meme_mode ? <div class="admin-field-error">{fields.meme_mode}</div> : null}
            </div>
          </div>
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Slop of the day</div><div class="hint">Optional editorial slop. 500 characters max.</div></div>
            <div>
              <textarea class="textarea" rows={2} maxLength={500} value={form.slop_of_the_day} onInput={(e) => set('slop_of_the_day', (e.target as HTMLTextAreaElement).value)} aria-label="Slop of the day" />
              {fields.slop_of_the_day ? <div class="admin-field-error">{fields.slop_of_the_day}</div> : null}
            </div>
          </div>
        </Panel>

        <Panel title="Registration & uploads" class="admin-settings-group">
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Registration mode</div><div class="hint">Controls account creation only. Server invites are managed separately.</div></div>
            <div>
              <select class="select" value={form.registration} onChange={(e) => set('registration', (e.target as HTMLSelectElement).value as AdminSettings['registration'])} aria-label="Registration mode">
                <option value="open">Open — anyone can register</option>
                <option value="invite">Invite only — account code required</option>
                <option value="closed">Closed — no new accounts</option>
              </select>
              {fields.registration ? <div class="admin-field-error">{fields.registration}</div> : null}
            </div>
          </div>
          <div class="admin-registration-effect"><Icon name="info" size={15} /> {REGISTRATION_COPY[form.registration]}</div>
          <div class="admin-settings-row">
            <div class="label-wrap"><div class="label">Max upload size (MB)</div><div class="hint">Per-file cap enforced by the upload service. 1–500 MB. Existing files are unaffected.</div></div>
            <div>
              <input class="input" type="number" min={1} max={500} value={form.max_upload_mb} onInput={(e) => set('max_upload_mb', Number((e.target as HTMLInputElement).value) || 0)} aria-label="Maximum upload size in megabytes" />
              {fields.max_upload_mb ? <div class="admin-field-error">{fields.max_upload_mb}</div> : null}
            </div>
          </div>
        </Panel>

        <Panel title="Feature toggles" class="admin-settings-group">
          <div class="admin-toggle-list">
            <ToggleRow label="End-to-end encryption" hint="Client-side encrypted DMs. Off means plaintext-at-rest for newly sent DMs; old ciphertext stays opaque." checked={form.e2ee_enabled} onChange={(v) => set('e2ee_enabled', v)} />
            <ToggleRow label="Voice channels" hint="WebRTC voice rooms. Off hides voice UI and rejects joins." checked={form.voice_enabled} onChange={(v) => set('voice_enabled', v)} />
            <ToggleRow label="Soundboard" hint="Allows soundboards and sound clips. Off mutes the meme cannon." checked={form.soundboard_enabled} onChange={(v) => set('soundboard_enabled', v)} />
            <ToggleRow label="Forum channels" hint="Threaded forum-style channels. Off hides forum creation and posting." checked={form.forum_enabled} onChange={(v) => set('forum_enabled', v)} />
            <ToggleRow label="Webhooks" hint="Server webhooks for bots and integrations. Off blocks new deliveries." checked={form.webhooks_enabled} onChange={(v) => set('webhooks_enabled', v)} />
            <ToggleRow label="Public server discovery" hint="Lists public servers in discovery. Off keeps the directory closed." checked={form.public_discovery} onChange={(v) => set('public_discovery', v)} />
          </div>
        </Panel>

        <div class="admin-save-bar">
          <div class="admin-hint"><Icon name="shield" size={14} /> Settings are audited. No telemetry, no external call-home.</div>
          <div class="row gap-8">
            <button type="button" class="btn" disabled={busy || !load.data} onClick={() => load.data && setForm({ ...load.data.settings })}>Reset</button>
            <button class="btn btn-primary" disabled={busy}>
              {busy ? <span class="spinner" /> : <Icon name="check" size={15} />} Save settings
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ToggleRow(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div class="admin-toggle-item">
      <div><div class="label">{props.label}</div><div class="hint">{props.hint}</div></div>
      <Toggle checked={props.checked} onChange={props.onChange} label={props.checked ? 'On' : 'Off'} />
    </div>
  );
}
