import { useEffect, useRef, useState } from 'preact/hooks';
import { api, errorMessage, uploadFile } from '../../lib/api';
import { store } from '../../lib/use-store';
import { Modal, Field, Spinner } from '../Ui';
import { Icon } from '../Icons';

export function CreateServerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setName(''); setDescription(''); setIcon(null); setError(''); } }, [open]);
  const pickIcon = async (file?: File) => {
    if (!file) return;
    setIconUploading(true);
    try { const up = await uploadFile(file, 'server_icon'); setIcon(up.url); }
    catch (e) { setError(errorMessage(e)); }
    finally { setIconUploading(false); }
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) { setError('A server needs a name. Even the void has branding.'); return; }
    setBusy(true); setError('');
    try {
      const res: any = await api.post('/api/servers', { name: name.trim(), description: description.trim() || undefined, icon: icon ?? undefined });
      const server = res.server;
      store.state.servers[server.id] = {
        server, channels: res.channels ?? [], roles: res.roles ?? [], member: res.member ?? null,
        members: res.member ? [res.member] : [], emojis: [], stickers: [], sounds: [],
      };
      if (!store.state.serverOrder.includes(server.id)) store.state.serverOrder.push(server.id);
      for (const ch of res.channels ?? []) store.state.channels[ch.id] = ch;
      store.emit();
      onClose();
      const channel = (res.channels ?? []).find((c: any) => c.type === 'text') ?? (res.channels ?? []).find((c: any) => c.type !== 'category');
      if (channel) await store.openChannel(server.id, channel.id);
      store.toast(`Welcome to ${server.name}. You are now a landlord.`, 'success', '🏠');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Create a server" footer={<><button class="btn btn-ghost" onClick={onClose}>Cancel</button><button class="btn btn-primary" disabled={busy || iconUploading} onClick={submit}>{busy ? <Spinner size={14} /> : 'Create server'}</button></>}>
    <form onSubmit={submit}>
      <div class="modal-body">
        {error ? <div class="auth-error">{error}</div> : null}
        <div class="row gap-16 mb-16">
          <button type="button" class="avatar sq" style={{ width: 72, height: 72, fontSize: 24, border: '1px dashed var(--border)', background: icon ? 'none' : 'var(--bg-card)' }} onClick={() => fileRef.current?.click()}>
            {icon ? <img src={icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : iconUploading ? <Spinner /> : <Icon name="image" size={24} />}
          </button>
          <div class="grow">
            <Field label="Server name"><input class="input" value={name} maxLength={100} placeholder="The Slop Pit: After Dark" onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus /></Field>
            <button type="button" class="btn btn-ghost btn-xs" onClick={() => fileRef.current?.click()}>{icon ? 'Change icon' : 'Upload an icon (optional)'}</button>
            <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => void pickIcon((e.target as HTMLInputElement).files?.[0])} />
          </div>
        </div>
        <Field label="Description" hint="Public servers show this in Discovery. Keep it unhinged but accurate.">
          <textarea class="textarea" rows={3} value={description} maxLength={500} placeholder="A safe place for unsafe thoughts." onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <div class="card flat" style={{ padding: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text)' }}>Starter pack included:</strong> categories, #welcome, #general, #shitpost, a forum board, a voice channel, @everyone and a Founder role. You can rename or delete all of it.
        </div>
      </div>
    </form>
  </Modal>;
}
