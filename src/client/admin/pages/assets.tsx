import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, uploadFile } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import type { AssetsPayload, EmojiAsset, SoundAsset, StickerAsset } from '../types';
import {
  ConfirmDialog, CopyButton, Empty, ErrorNote, Field, Icon, Loading, PageHead, Panel,
  SuccessNote, useLoad,
} from '../ui';

type AssetTab = 'all' | 'emojis' | 'stickers' | 'sounds';
type AssetType = 'emojis' | 'stickers' | 'sounds';
type Deletion = { type: AssetType; id: string; name: string };

export function AssetsPage() {
  const load = useLoad((signal) => api.get<AssetsPayload>('/api/admin/assets', { signal }), []);
  const [tab, setTab] = useState<AssetTab>('all');
  const [scope, setScope] = useState<'all' | 'global' | 'server'>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);

  const query = q.trim().toLowerCase();
  const keep = (serverId: string | null, name: string) =>
    (!query || name.toLowerCase().includes(query)) && (scope === 'all' || (scope === 'global' ? !serverId : !!serverId));

  const emojis = (load.data?.emojis ?? []).filter((a) => keep(a.serverId, a.name));
  const stickers = (load.data?.stickers ?? []).filter((a) => keep(a.serverId, a.name));
  const sounds = (load.data?.sounds ?? []).filter((a) => keep(a.serverId, a.name));
  const totalAssets = (load.data?.emojis.length ?? 0) + (load.data?.stickers.length ?? 0) + (load.data?.sounds.length ?? 0);

  async function remove() {
    if (!deletion) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/api/admin/assets/${deletion.type}/${deletion.id}`);
      setFeedback(`Deleted ${deletion.type.slice(0, -1)} “${deletion.name}”. The audit log remembers.`);
      setDeletion(null);
      load.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (load.loading && !load.data) return <div class="admin-content"><Loading label="Inventorying the meme cupboard…" /></div>;

  return (
    <div class="admin-content">
      <PageHead
        title="Assets"
        subtitle={<>Emojis, stickers and sounds from every server, plus global assets. {totalAssets.toLocaleString()} total. Deletions are audited.</>}
        actions={<button class="btn" onClick={load.reload} disabled={load.loading}><Icon name="refresh" size={15} /> Refresh</button>}
      />
      <ErrorNote message={load.error} />
      <ErrorNote message={error} />
      <SuccessNote message={feedback} />

      <GlobalEmojiUpload onDone={(message) => { setFeedback(message); load.reload(); }} />

      <div class="admin-toolbar">
        <div class="admin-segmented" role="group" aria-label="Asset type">
          {(['all', 'emojis', 'stickers', 'sounds'] as const).map((t) => (
            <button key={t} class={`admin-segment ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)} aria-pressed={tab === t}>
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <select class="select" value={scope} onChange={(e) => setScope((e.target as HTMLSelectElement).value as typeof scope)} aria-label="Asset scope">
          <option value="all">All assets</option>
          <option value="global">Global only</option>
          <option value="server">Server assets only</option>
        </select>
        <div class="admin-search">
          <Icon name="search" size={15} />
          <input class="input" type="search" placeholder="Search assets…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search assets" />
        </div>
      </div>

      {tab === 'all' || tab === 'emojis' ? (
        <Panel title={`Emojis (${emojis.length})`}>
          {emojis.length ? (
            <div class="admin-asset-grid">
              {emojis.map((emoji) => (
                <EmojiCard key={emoji.id} asset={emoji} onDelete={() => setDeletion({ type: 'emojis', id: emoji.id, name: emoji.name })} />
              ))}
            </div>
          ) : <Empty emoji="😐" title="No emojis match">The reaction economy is in recession.</Empty>}
        </Panel>
      ) : null}

      {tab === 'all' || tab === 'stickers' ? (
        <Panel title={`Stickers (${stickers.length})`}>
          {stickers.length ? (
            <div class="admin-asset-grid">
              {stickers.map((sticker) => (
                <StickerCard key={sticker.id} asset={sticker} onDelete={() => setDeletion({ type: 'stickers', id: sticker.id, name: sticker.name })} />
              ))}
            </div>
          ) : <Empty emoji="🩹" title="No stickers match">Nothing to slap onto a message.</Empty>}
        </Panel>
      ) : null}

      {tab === 'all' || tab === 'sounds' ? (
        <Panel title={`Sounds (${sounds.length})`}>
          {sounds.length ? (
            <div class="admin-asset-grid sounds">
              {sounds.map((sound) => (
                <SoundCard key={sound.id} asset={sound} onDelete={() => setDeletion({ type: 'sounds', id: sound.id, name: sound.name })} />
              ))}
            </div>
          ) : <Empty emoji="🔇" title="No sounds match">The soundboard is suspiciously quiet.</Empty>}
        </Panel>
      ) : null}

      <ConfirmDialog
        open={deletion !== null}
        title={`Delete ${deletion?.type.slice(0, -1) ?? 'asset'}?`}
        danger
        confirmLabel="Delete asset"
        busy={busy}
        error={error}
        onClose={() => setDeletion(null)}
        onConfirm={remove}
      >
        <p><strong>{deletion?.name}</strong> will be removed from the asset registry. Messages that already reference it may show a broken asset. This action is audited.</p>
      </ConfirmDialog>
    </div>
  );
}

function EmojiCard(props: { asset: EmojiAsset; onDelete: () => void }) {
  return (
    <div class="admin-asset-card">
      <div class="admin-asset-preview">
        {props.asset.url ? <img src={props.asset.url} alt={`Emoji ${props.asset.name}`} loading="lazy" /> : <span class="admin-asset-missing">?</span>}
      </div>
      <div class="admin-asset-body">
        <div class="admin-asset-name truncate">:{props.asset.name}:</div>
        <div class="admin-asset-meta">
          {props.asset.serverId ? `${props.asset.serverName ?? 'server'} · server` : 'Global'}
          {props.asset.animated ? ' · animated' : ''}
        </div>
        <div class="row gap-4">
          {props.asset.url ? <CopyButton value={props.asset.url} label="URL" ariaLabel={`Copy URL for ${props.asset.name}`} /> : null}
          <button class="btn btn-xs btn-danger" onClick={props.onDelete} aria-label={`Delete emoji ${props.asset.name}`}><Icon name="trash" size={12} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

function StickerCard(props: { asset: StickerAsset; onDelete: () => void }) {
  return (
    <div class="admin-asset-card">
      <div class="admin-asset-preview">
        {props.asset.url ? <img src={props.asset.url} alt={`Sticker ${props.asset.name}`} loading="lazy" /> : <span class="admin-asset-missing">?</span>}
      </div>
      <div class="admin-asset-body">
        <div class="admin-asset-name truncate">{props.asset.name}</div>
        <div class="admin-asset-meta">{props.asset.serverId ? props.asset.serverName ?? 'server' : 'Global'} · {fmtRelative(props.asset.createdAt)}</div>
        {props.asset.description ? <div class="admin-asset-desc">{props.asset.description}</div> : null}
        <div class="row gap-4">
          {props.asset.url ? <CopyButton value={props.asset.url} label="URL" ariaLabel={`Copy URL for ${props.asset.name}`} /> : null}
          <button class="btn btn-xs btn-danger" onClick={props.onDelete} aria-label={`Delete sticker ${props.asset.name}`}><Icon name="trash" size={12} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

function SoundCard(props: { asset: SoundAsset; onDelete: () => void }) {
  return (
    <div class="admin-asset-card sound">
      <div class="admin-asset-preview sound" aria-hidden="true">{props.asset.emoji || '🔊'}</div>
      <div class="admin-asset-body">
        <div class="admin-asset-name truncate">{props.asset.name}</div>
        <div class="admin-asset-meta">{props.asset.serverId ? props.asset.serverName ?? 'server' : 'Global'} · {fmtRelative(props.asset.createdAt)}</div>
        {props.asset.url ? <audio class="admin-audio" controls preload="none" src={props.asset.url} aria-label={`Preview sound ${props.asset.name}`} /> : <span class="admin-hint">No audio file attached.</span>}
        <div class="row gap-4">
          {props.asset.url ? <CopyButton value={props.asset.url} label="URL" ariaLabel={`Copy URL for ${props.asset.name}`} /> : null}
          <button class="btn btn-xs btn-danger" onClick={props.onDelete} aria-label={`Delete sound ${props.asset.name}`}><Icon name="trash" size={12} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

function GlobalEmojiUpload(props: { onDone: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function upload(e: Event) {
    e.preventDefault();
    setError(null);
    const clean = name.trim();
    if (!file) { setError('Pick an image file first. The goblin cannot upload vibes.'); return; }
    if (!/^[a-z0-9_]{2,32}$/i.test(clean)) { setError('Emoji names are 2–32 letters, digits or underscores.'); return; }
    setBusy(true);
    try {
      const uploaded = await uploadFile(file, 'emoji');
      await api.post('/api/admin/emojis', { name: clean, uploadId: uploaded.id });
      props.onDone(`Global emoji :${clean}: uploaded and audited.`);
      setFile(null);
      setName('');
      const input = document.getElementById('global-emoji-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Upload a global emoji" actions={<span class="admin-panel-note">serverId omitted = global</span>}>
      <form class="admin-upload-form" onSubmit={upload}>
        <div class="admin-upload-preview" aria-hidden="true">
          {preview ? <img src={preview} alt="" /> : <Icon name="image" size={24} />}
        </div>
        <Field label="Image file" hint="PNG, JPEG, GIF, WebP or SVG. The upload must use the emoji purpose.">
          <input id="global-emoji-file" class="input admin-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} aria-label="Choose emoji image" />
        </Field>
        <Field label="Emoji name" hint="2–32 letters, digits or underscores. No colons." error={error ?? undefined}>
          <input class="input" value={name} maxLength={32} placeholder="slop_verified" onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Global emoji name" />
        </Field>
        <button class="btn btn-primary" disabled={busy}>
          {busy ? <span class="spinner" /> : <Icon name="plus" size={15} />} Upload global emoji
        </button>
      </form>
    </Panel>
  );
}
