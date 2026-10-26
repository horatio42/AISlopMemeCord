import { useEffect, useRef, useState } from 'preact/hooks';
import { api, errorMessage, HttpError, uploadFile } from '../../../lib/api';
import { store, useApp } from '../../../lib/use-store';
import { Field, Spinner } from '../../Ui';
import { Icon } from '../../Icons';
import { Avatar } from '../../Avatar';
import { fmtDate } from '../../../lib/format';

const PRONOUNS = ['', 'he/him', 'she/her', 'they/them', 'it/its', 'any/all', 'ask me', 'goblin/goblin'];

export function AccountTab({ onClose }: { onClose: () => void }) {
  const state = useApp();
  const user = state.user!;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [pronouns, setPronouns] = useState(user.pronouns ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [customStatus, setCustomStatus] = useState(user.customStatus ?? '');
  const [bannerColor, setBannerColor] = useState(user.bannerColor ?? '#b58cff');
  const [avatar, setAvatar] = useState(user.avatar);
  const [buddy, setBuddy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user.displayName); setPronouns(user.pronouns ?? ''); setBio(user.bio ?? '');
    setCustomStatus(user.customStatus ?? ''); setBannerColor(user.bannerColor ?? '#b58cff'); setAvatar(user.avatar);
  }, [user.id]);

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('Avatar must be under 2MB.'); return; }
    setUploading(true); setError('');
    try { const up = await uploadFile(file, 'avatar'); setAvatar(up.url); }
    catch (e) { setError(errorMessage(e)); }
    finally { setUploading(false); }
  };
  const save = async () => {
    setBusy(true); setError(''); setFields({}); setSaved(false);
    try {
      const res: any = await api.patch('/api/users/@me', {
        displayName, pronouns: pronouns || null, bio: bio || null, customStatus: customStatus || null,
        bannerColor, avatar,
      });
      const merged = { ...state.user!, ...res.user };
      store.state.user = merged;
      for (const b of Object.values(store.state.servers)) {
        for (const m of b.members) if (m.user.id === user.id) m.user = merged;
        if (b.member?.user.id === user.id) b.member.user = merged;
      }
      store.state.friends = { ...store.state.friends, friends: store.state.friends.friends.map((f) => f.user.id === user.id ? { ...f, user: merged } : f) };
      store.emit();
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      store.toast('Profile updated. The goblin within has evolved.', 'success', '✨');
    } catch (e) {
      if (e instanceof HttpError) { setError(e.message); setFields(e.fields ?? {}); }
      else setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return <div>
    <h3>My account</h3>
    <p class="settings-desc">This is you: no email, no phone number, no real name required. Your privacy is the entire point.</p>
    {error ? <div class="auth-error">{error}</div> : null}
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="row gap-16">
        <button class="avatar sq" style={{ width: 92, height: 92, border: '1px solid var(--border)', background: 'none', position: 'relative' }} onClick={() => fileRef.current?.click()} title="Change avatar">
          <Avatar user={{ ...user, avatar }} size={90} square status={false} />
          <span class="avatar-deco" style={{ borderRadius: 8 }}><span style={{ fontSize: 10, fontWeight: 750 }}>{uploading ? <Spinner size={12} /> : 'CHANGE'}</span></span>
        </button>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => void uploadAvatar((e.target as HTMLInputElement).files?.[0])} />
        <div class="grow">
          <div class="profile-name" style={{ fontSize: 20 }}>{displayName || user.displayName}</div>
          <div class="muted">@{user.username}</div>
          <div class="faint mt-4" style={{ fontSize: 11 }}>Join date: {fmtDate(user.createdAt)} · {user.karma.toLocaleString()} Slop Points</div>
          <div class="row gap-8 mt-8">
            <button class="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}><Icon name="image" size={13} /> Upload avatar</button>
            {avatar ? <button class="btn btn-ghost btn-sm" onClick={() => setAvatar(null)}>Remove</button> : null}
          </div>
        </div>
      </div>
      <div class="mt-16">
        <div class="label mb-4">Profile banner color</div>
        <div class="row gap-8"><input type="color" value={bannerColor} onInput={(e) => setBannerColor((e.target as HTMLInputElement).value)} style={{ width: 40, height: 34, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)' }} />
          <input class="input mono" style={{ width: 120 }} value={bannerColor} maxLength={7} onInput={(e) => setBannerColor((e.target as HTMLInputElement).value)} />
          <span class="faint" style={{ fontSize: 11 }}>Used for your profile card. Pure CSS, no image harvesting.</span>
        </div>
      </div>
    </div>
    <div class="row gap-12 wrap">
      <div class="grow" style={{ minWidth: 220 }}><Field label="Display name" error={fields.displayName}><input class="input" value={displayName} maxLength={32} onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)} /></Field></div>
      <div style={{ width: 190 }}><Field label="Pronouns"><select class="select" value={pronouns} onChange={(e) => setPronouns((e.target as HTMLSelectElement).value)}>{PRONOUNS.map((p) => <option key={p} value={p}>{p || 'not specified'}</option>)}</select></Field></div>
    </div>
    <Field label="Custom status" hint="Shown next to your name. 128 chars of pure vibes."><input class="input" value={customStatus} maxLength={128} placeholder="touching grass (lie)" onInput={(e) => setCustomStatus((e.target as HTMLInputElement).value)} /></Field>
    <Field label="Bio" error={fields.bio} hint="500 chars. Markdown-ish, but no HTML. We sanitize the slop."><textarea class="textarea" rows={4} maxLength={500} value={bio} onInput={(e) => setBio((e.target as HTMLTextAreaElement).value)} placeholder="I am once again asking for your financial support." /></Field>
    <div class="row-between mt-16">
      <span class="faint" style={{ fontSize: 11 }}>Username changes are not supported yet. Pick better next time.</span>
      <button class="btn btn-primary" onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : saved ? <><Icon name="check" size={15} /> Saved</> : 'Save changes'}</button>
    </div>
  </div>;
}
