import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../../lib/api';
import { store, useApp } from '../../lib/use-store';
import { Modal, Field, Toggle } from '../Ui';
import { Icon } from '../Icons';

const TYPES = [
  { id: 'text', label: 'Text channel', icon: 'hash', desc: 'Messages, memes, chaos.' },
  { id: 'voice', label: 'Voice channel', icon: 'volume', desc: 'WebRTC mesh + soundboard.' },
  { id: 'forum', label: 'Forum channel', icon: 'forum', desc: 'Reddit-style posts and votes.' },
  { id: 'announcement', label: 'Announcement', icon: 'announcement', desc: 'For important slop only.' },
  { id: 'category', label: 'Category', icon: 'folder', desc: 'Group channels together.' },
];

export function CreateChannelModal({ open, parentId, initialType, onClose }: { open: boolean; parentId?: string; initialType?: string; onClose: () => void }) {
  const state = useApp();
  const serverId = state.activeServerId;
  const bundle = serverId ? state.servers[serverId] : null;
  const [type, setType] = useState(initialType ?? 'text');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [parent, setParent] = useState(parentId ?? '');
  const [nsfw, setNsfw] = useState(false);
  const [slowmode, setSlowmode] = useState(0);
  const [votingEnabled, setVotingEnabled] = useState(true);
  const [defaultSort, setDefaultSort] = useState('hot');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setType(initialType ?? 'text'); setName(''); setTopic(''); setParent(parentId ?? ''); setNsfw(false); setSlowmode(0); setVotingEnabled(true); setDefaultSort('hot'); setTags(''); setError(''); } }, [open, initialType, parentId]);
  const categories = (bundle?.channels ?? []).filter((c) => c.type === 'category').sort((a, b) => a.position - b.position);
  const submit = async () => {
    if (!serverId) { setError('No active server.'); return; }
    if (!name.trim()) { setError('Channel name required.'); return; }
    setBusy(true); setError('');
    try {
      const res: any = await api.post(`/api/servers/${serverId}/channels`, {
        name: name.trim().replace(/\s+/g, '-').toLowerCase(), type, parentId: parent || null,
        topic: topic.trim() || null, nsfw, slowmode: Number(slowmode), votingEnabled,
        defaultSort: type === 'forum' ? defaultSort : null,
        tags: type === 'forum' ? tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) : [],
      });
      store.state.channels[res.channel.id] = res.channel;
      if (bundle) { bundle.channels.push(res.channel); bundle.channels.sort((a, b) => a.position - b.position); }
      store.emit();
      onClose();
      store.toast(`#${res.channel.name} created. Fill it with regret.`, 'success', '✨');
      if (res.channel.type !== 'category') await store.openChannel(serverId, res.channel.id);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Create channel" footer={<><button class="btn btn-ghost" onClick={onClose}>Cancel</button><button class="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create channel'}</button></>}>
    <div class="modal-body">
      {error ? <div class="auth-error">{error}</div> : null}
      <Field label="Channel type">
        <div class="discover-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {TYPES.map((t) => <button key={t.id} class={`card flat ${type === t.id ? 'active' : ''}`} style={{ padding: 10, textAlign: 'left', borderColor: type === t.id ? 'var(--accent)' : undefined }} onClick={() => setType(t.id)}>
            <div class="row gap-8"><Icon name={t.icon === 'folder' ? 'hash' : t.icon} size={16} /><strong style={{ fontSize: 13 }}>{t.label}</strong></div>
            <div class="faint" style={{ fontSize: 10.5, marginTop: 3 }}>{t.desc}</div>
          </button>)}
        </div>
      </Field>
      <Field label="Channel name"><input class="input" value={name} maxLength={100} placeholder={type === 'voice' ? 'General VC' : 'certified-bangers'} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus /></Field>
      {type !== 'category' && type !== 'voice' ? <Field label="Topic" hint="Shown at the top of the channel."><input class="input" value={topic} maxLength={1024} placeholder="No thoughts, just vibes." onInput={(e) => setTopic((e.target as HTMLInputElement).value)} /></Field> : null}
      {type !== 'category' ? <Field label="Category"><select class="select" value={parent} onChange={(e) => setParent((e.target as HTMLSelectElement).value)}><option value="">No category</option>{categories.map((c) => <option value={c.id}>{c.name}</option>)}</select></Field> : null}
      {type === 'forum' ? <>
        <Field label="Forum tags" hint="Comma-separated; max 20. Used to filter posts."><input class="input" value={tags} placeholder="meme, hot take, help, copypasta" onInput={(e) => setTags((e.target as HTMLInputElement).value)} /></Field>
        <div class="row gap-12 wrap">
          <Field label="Default sort"><select class="select" value={defaultSort} onChange={(e) => setDefaultSort((e.target as HTMLSelectElement).value)}><option value="hot">Hot</option><option value="new">New</option><option value="top">Top</option></select></Field>
          <div class="mt-16"><Toggle checked={votingEnabled} onChange={setVotingEnabled} label="Enable voting" /></div>
        </div>
      </> : null}
      {type === 'text' ? <div class="row gap-16 wrap">
        <Field label="Slowmode"><select class="select" value={slowmode} onChange={(e) => setSlowmode(Number((e.target as HTMLSelectElement).value))}><option value={0}>Off</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={300}>5 minutes</option></select></Field>
        <div class="mt-16"><Toggle checked={nsfw} onChange={setNsfw} label="NSFW channel" /></div>
      </div> : null}
    </div>
  </Modal>;
}
