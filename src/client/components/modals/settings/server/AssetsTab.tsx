import { useEffect, useRef, useState } from 'preact/hooks';
import { api, errorMessage, uploadFile } from '../../../../lib/api';
import { store, useApp } from '../../../../lib/use-store';
import { can } from '../../../../lib/permissions';
import { Perm } from '../../../../../shared/permissions';
import type { Emoji, Sound, Sticker } from '../../../../../shared/types';
import { Icon } from '../../../Icons';
import { Field } from '../../../Ui';
import { EmptySlop, SettingsError, SettingsNotice, SettingsSection, SubCard } from './shared';

export function AssetsTab({ serverId }: { serverId: string }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const manage = can(state, Perm.MANAGE_EMOJIS, serverId);
  const [emojis, setEmojis] = useState<Emoji[]>(bundle?.emojis ?? []);
  const [stickers, setStickers] = useState<Sticker[]>(bundle?.stickers ?? []);
  const [sounds, setSounds] = useState<Sound[]>(bundle?.sounds ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [emojiName, setEmojiName] = useState('');
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [stickerName, setStickerName] = useState('');
  const [stickerDesc, setStickerDesc] = useState('');
  const [stickerTags, setStickerTags] = useState('');
  const [stickerFile, setStickerFile] = useState<File | null>(null);
  const [soundName, setSoundName] = useState('');
  const [soundEmoji, setSoundEmoji] = useState('🔊');
  const [soundFile, setSoundFile] = useState<File | null>(null);
  const emojiRef = useRef<HTMLInputElement>(null);
  const stickerRef = useRef<HTMLInputElement>(null);
  const soundRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ emojis: Emoji[] }>(`/api/servers/${serverId}/emojis`).catch(() => null),
      api.get<{ stickers: Sticker[] }>(`/api/servers/${serverId}/stickers`).catch(() => null),
      api.get<{ sounds: Sound[] }>(`/api/servers/${serverId}/sounds`).catch(() => null),
    ]).then(([e, s, n]) => {
      if (e) setEmojis(e.emojis ?? []);
      if (s) setStickers(s.stickers ?? []);
      if (n) setSounds(n.sounds ?? []);
    });
  }, [serverId]);

  if (!bundle) return <SettingsError message="Assets not found. The goblins took them." />;

  const afterChange = async () => {
    await store.loadServer(serverId, { force: true });
  };

  const addEmoji = async () => {
    if (!emojiFile || !emojiName.trim()) { setError('Choose a file and a name (2-32 letters/numbers/underscores).'); return; }
    setBusy(true); setError('');
    try {
      const up = await uploadFile(emojiFile, 'emoji');
      const res = await api.post<{ emoji: Emoji }>(`/api/servers/${serverId}/emojis`, { name: emojiName.trim(), uploadId: up.id });
      setEmojis((old) => [...old, res.emoji]);
      setEmojiName(''); setEmojiFile(null);
      if (emojiRef.current) emojiRef.current.value = '';
      await afterChange();
      store.toast('Emoji added. The slop vocabulary expands.', 'success', '😤');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const addSticker = async () => {
    if (!stickerFile || !stickerName.trim()) { setError('Stickers need a file and a name.'); return; }
    setBusy(true); setError('');
    try {
      const up = await uploadFile(stickerFile, 'sticker');
      const res = await api.post<{ sticker: Sticker }>(`/api/servers/${serverId}/stickers`, {
        name: stickerName.trim(), uploadId: up.id, description: stickerDesc.trim() || null,
        tags: stickerTags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5),
      });
      setStickers((old) => [...old, res.sticker]);
      setStickerName(''); setStickerDesc(''); setStickerTags(''); setStickerFile(null);
      if (stickerRef.current) stickerRef.current.value = '';
      await afterChange();
      store.toast('Sticker stuck to the server. No refunds.', 'success', '🩹');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const addSound = async () => {
    if (!soundFile || !soundName.trim()) { setError('Sounds need a file and a name.'); return; }
    setBusy(true); setError('');
    try {
      const up = await uploadFile(soundFile, 'sound');
      const res = await api.post<{ sound: Sound }>(`/api/servers/${serverId}/sounds`, { name: soundName.trim(), emoji: soundEmoji || '🔊', uploadId: up.id });
      setSounds((old) => [...old, res.sound]);
      setSoundName(''); setSoundEmoji('🔊'); setSoundFile(null);
      if (soundRef.current) soundRef.current.value = '';
      await afterChange();
      store.toast('Sound uploaded. The airhorn economy grows.', 'success', '🔊');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const remove = async (kind: 'emoji' | 'sticker' | 'sound', id: string) => {
    setBusy(true); setError('');
    try {
      await api.del(`/api/${kind}s/${id}`);
      if (kind === 'emoji') setEmojis((old) => old.filter((x) => x.id !== id));
      else if (kind === 'sticker') setStickers((old) => old.filter((x) => x.id !== id));
      else setSounds((old) => old.filter((x) => x.id !== id));
      setConfirm('');
      await afterChange();
      store.toast(`${kind} deleted. Its memory lingers.`, 'success', '🗑️');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const deleteButton = (kind: 'emoji' | 'sticker' | 'sound', id: string) => confirm === `${kind}:${id}`
    ? <div class="row gap-4"><button class="btn btn-xs btn-danger" disabled={busy} onClick={() => void remove(kind, id)}>Delete</button><button class="btn btn-xs btn-ghost" onClick={() => setConfirm('')}>Keep</button></div>
    : <button class="btn-icon sm" title={`Delete ${kind}`} disabled={!manage} onClick={() => setConfirm(`${kind}:${id}`)}><Icon name="trash" size={13} /></button>;

  return <SettingsSection title="Emojis, stickers & sounds" desc="Custom slop, hosted locally. Files never leave this instance and no third party gets a copy.">
    <SettingsError message={error} />
    {!manage ? <SettingsNotice kind="warn">You need <span class="mono">Manage Emojis & Stickers</span> to add or remove assets. Enjoy the gallery.</SettingsNotice> : null}

    <SubCard title={`Emojis — ${emojis.length}`}>
      {manage ? <div class="row gap-8 wrap mb-16">
        <input ref={emojiRef} hidden type="file" accept="image/*" onChange={(e) => setEmojiFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        <input class="input" style={{ maxWidth: 200 }} placeholder="emoji_name" value={emojiName} maxLength={32} onInput={(e) => setEmojiName((e.target as HTMLInputElement).value)} />
        <button class="btn btn-sm" onClick={() => emojiRef.current?.click()}><Icon name="image" size={13} /> {emojiFile ? emojiFile.name : 'Choose file'}</button>
        <button class="btn btn-sm btn-primary" disabled={busy || !emojiFile || !emojiName.trim()} onClick={() => void addEmoji()}>{busy ? 'Uploading…' : 'Add emoji'}</button>
        <span class="srv-hint">2-32 chars: letters, numbers, underscores. SVG allowed; everything else stays raster.</span>
      </div> : null}
      {emojis.length ? <div class="srv-asset-grid">{emojis.map((e) => <div class="srv-asset" key={e.id}>
        <div class="srv-asset-preview"><img src={e.url} alt={e.name} loading="lazy" /></div>
        <div class="srv-asset-meta"><span class="truncate mono">:{e.name}:</span>{e.animated ? <span class="badge">GIF</span> : null}{deleteButton('emoji', e.id)}</div>
      </div>)}</div> : <EmptySlop emoji="😤" title="No custom emojis">Your reactions are tragically standard.</EmptySlop>}
    </SubCard>

    <SubCard title={`Stickers — ${stickers.length}`}>
      {manage ? <div class="row gap-8 wrap mb-16">
        <input ref={stickerRef} hidden type="file" accept="image/*" onChange={(e) => setStickerFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        <input class="input" style={{ maxWidth: 160 }} placeholder="sticker name" value={stickerName} maxLength={32} onInput={(e) => setStickerName((e.target as HTMLInputElement).value)} />
        <input class="input" style={{ maxWidth: 200 }} placeholder="description (optional)" value={stickerDesc} maxLength={200} onInput={(e) => setStickerDesc((e.target as HTMLInputElement).value)} />
        <input class="input" style={{ maxWidth: 160 }} placeholder="tags, comma, separated" value={stickerTags} maxLength={120} onInput={(e) => setStickerTags((e.target as HTMLInputElement).value)} />
        <button class="btn btn-sm" onClick={() => stickerRef.current?.click()}><Icon name="sticker" size={13} /> {stickerFile ? stickerFile.name : 'Choose file'}</button>
        <button class="btn btn-sm btn-primary" disabled={busy || !stickerFile || !stickerName.trim()} onClick={() => void addSticker()}>{busy ? 'Uploading…' : 'Add sticker'}</button>
      </div> : null}
      {stickers.length ? <div class="srv-asset-grid">{stickers.map((s) => <div class="srv-asset" key={s.id}>
        <div class="srv-asset-preview"><img src={s.url} alt={s.name} loading="lazy" /></div>
        <div class="srv-asset-meta"><span class="truncate">{s.name}</span>{deleteButton('sticker', s.id)}</div>
        {s.description ? <div class="srv-hint truncate">{s.description}</div> : null}
        {s.tags.length ? <div class="chip-row">{s.tags.map((t) => <span class="chip">{t}</span>)}</div> : null}
      </div>)}</div> : <EmptySlop emoji="🩹" title="No stickers">A stickerless server is a joyless server.</EmptySlop>}
    </SubCard>

    <SubCard title={`Sounds — ${sounds.length}`}>
      {bundle && state.instance?.soundboardEnabled === false ? <SettingsNotice kind="warn">The soundboard is disabled instance-wide. Sounds can be stored but not deployed.</SettingsNotice> : null}
      {manage ? <div class="row gap-8 wrap mb-16">
        <input ref={soundRef} hidden type="file" accept="audio/*" onChange={(e) => setSoundFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
        <input class="input" style={{ maxWidth: 160 }} placeholder="airhorn" value={soundName} maxLength={32} onInput={(e) => setSoundName((e.target as HTMLInputElement).value)} />
        <input class="input" style={{ maxWidth: 70 }} placeholder="🔊" value={soundEmoji} maxLength={16} onInput={(e) => setSoundEmoji((e.target as HTMLInputElement).value)} />
        <button class="btn btn-sm" onClick={() => soundRef.current?.click()}><Icon name="volume" size={13} /> {soundFile ? soundFile.name : 'Choose audio'}</button>
        <button class="btn btn-sm btn-primary" disabled={busy || !soundFile || !soundName.trim()} onClick={() => void addSound()}>{busy ? 'Uploading…' : 'Add sound'}</button>
        <span class="srv-hint">Up to 8MB. Local only.</span>
      </div> : null}
      {sounds.length ? <div class="srv-sound-list">{sounds.map((s) => <div class="srv-sound-row" key={s.id}>
        <span style={{ fontSize: 20 }}>{s.emoji}</span>
        <div class="grow"><div class="truncate">{s.name}</div><audio controls preload="none" src={s.url} style={{ width: '100%', height: 30, marginTop: 4 }} /></div>
        {deleteButton('sound', s.id)}
      </div>)}</div> : <EmptySlop emoji="🔇" title="No sounds">The soundboard is a silent void.</EmptySlop>}
    </SubCard>
  </SettingsSection>;
}
