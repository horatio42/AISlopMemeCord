import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Channel, Message } from '../../shared/types';
import { useApp, store } from '../lib/use-store';
import { api, errorMessage, uploadFile } from '../lib/api';
import { gateway } from '../lib/gateway';
import { Icon } from './Icons';
import { EmojiPicker } from './EmojiPicker';
import { Modal, Field, Toggle, Spinner } from './Ui';
import { COPYPASTAS, generateSlop } from '../../shared/memes';
import { encryptMessage } from '../lib/e2ee';
import { fmtSize } from '../lib/format';

const SLASH = [
  { cmd: '/shrug', desc: 'Append ¯\\_(ツ)_/¯' }, { cmd: '/tableflip', desc: '(╯°□°)╯︵ ┻━┻' },
  { cmd: '/unflip', desc: '┬─┬ノ( º _ ºノ)' }, { cmd: '/me', desc: 'Emote-style italic action' },
  { cmd: '/spoiler', desc: 'Wrap text in a spoiler' }, { cmd: '/roll', desc: 'Roll 1-100' },
  { cmd: '/coinflip', desc: 'Flip a coin' }, { cmd: '/8ball', desc: 'Ask the slop oracle' },
  { cmd: '/poll', desc: 'Create a poll' }, { cmd: '/slop', desc: 'Generate fresh AI-ish slop' },
  { cmd: '/meme', desc: 'Random copypasta' }, { cmd: '/memepick', desc: 'Local meme image' }, { cmd: '/spoiler', desc: 'Spoiler tag' },
];
const MEMES = ['this-is-slop', 'touch-grass', 'ratio', 'brain-empty', 'ceo-slop'];

export function Composer({ channel, replyTo, editing, onSent, onCancelReply, onCancelEdit }: {
  channel: Channel; replyTo: Message | null; editing: Message | null; onSent: (m: Message) => void;
  onCancelReply: () => void; onCancelEdit: () => void;
}) {
  const state = useApp();
  const [text, setText] = useState(editing?.content ?? '');
  const [attachments, setAttachments] = useState<{ id: string; filename: string; contentType: string; size: number; url: string; preview: string | null }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [memeOpen, setMemeOpen] = useState(false);
  const [stickerId, setStickerId] = useState<string | null>(null);
  const [e2ee, setE2ee] = useState(() => localStorage.getItem(`slop-e2ee-${channel.id}`) === '1');
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef(0);
  const otherUser = channel.type === 'dm' || channel.type === 'group_dm' ? state.dms.find((d) => d.id === channel.id)?.members.find((m) => m.id !== state.user?.id) : null;
  const canE2ee = !!otherUser?.publicKey && channel.type === 'dm';
  const isThread = channel.type === 'thread';

  useEffect(() => {
    setText(editing?.content ?? '');
    setAttachments([]); setStickerId(null);
    if (editing) setTimeout(() => textareaRef.current?.focus(), 30);
  }, [editing]);
  useEffect(() => { setE2ee(localStorage.getItem(`slop-e2ee-${channel.id}`) === '1'); }, [channel.id]);
  useEffect(() => { autoSize(); }, [text]);
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);
  useEffect(() => {
    if (channel.type === 'dm' && !canE2ee && e2ee) { setE2ee(false); }
  }, [canE2ee, channel.type]);

  function autoSize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(220, Math.max(36, el.scrollHeight)) + 'px';
  }
  const slashMatches = useMemo(() => {
    if (!text.startsWith('/') || text.includes(' ') || editing) return [];
    return SLASH.filter((s) => s.cmd.startsWith(text.toLowerCase())).slice(0, 6);
  }, [text, editing]);

  const toggleE2ee = () => {
    if (!canE2ee) { store.toast('E2EE needs a 1:1 DM where both users have local keys.', 'error', '🔒'); return; }
    const next = !e2ee;
    setE2ee(next);
    localStorage.setItem(`slop-e2ee-${channel.id}`, next ? '1' : '0');
    store.toast(next ? 'E2EE on. The server sees ciphertext and vibes only.' : 'E2EE off. The server can read your slop.', next ? 'success' : 'info', next ? '🔒' : '🔓');
  };

  const onInput = (value: string) => {
    setText(value);
    setSlashIndex(0);
    if (Date.now() - typingRef.current > 3000) { gateway.type(channel.id); typingRef.current = Date.now(); }
  };

  const addFiles = async (files: File[]) => {
    for (const file of files.slice(0, 10 - attachments.length)) {
      setUploading((n) => n + 1);
      try {
        const up = await uploadFile(file, 'attachment');
        setAttachments((a) => [...a, { id: up.id, filename: up.filename, contentType: up.contentType, size: up.size, url: up.url, preview: up.contentType.startsWith('image/') ? up.url : null }]);
      } catch (e) { store.toast(errorMessage(e), 'error'); }
      finally { setUploading((n) => n - 1); }
    }
  };
  const removeAttachment = async (id: string) => {
    setAttachments((a) => a.filter((x) => x.id !== id));
    try { await api.del(`/api/uploads/${id}`); } catch { /* may already be consumed */ }
  };

  const applyCommand = (cmd: string) => {
    setText('');
    if (cmd === '/poll') { setPollOpen(true); return; }
    if (cmd === '/memepick') { setMemeOpen(true); return; }
    const canned: Record<string, string> = {
      '/shrug': ' ¯\\_(ツ)_/¯', '/tableflip': ' (╯°□°)╯︵ ┻━┻', '/unflip': ' ┬─┬ノ( º _ ºノ)',
      '/lenny': ' ( ͡° ͜ʖ ͡°)', '/slop': '\n\n' + generateSlop('', 2), '/meme': ' ' + COPYPASTAS[Math.floor(Math.random() * COPYPASTAS.length)],
      '/roll': ` 🎲 ${Math.floor(Math.random() * 100) + 1}`, '/coinflip': ` 🪙 ${Math.random() < .5 ? 'Heads' : 'Tails'}`,
      '/8ball': ` 🎱 ${['It is certain.', 'Ask again later.', 'Absolutely not.', 'The slop says yes.', 'Ratioed by fate.', 'No thoughts, head empty.'][Math.floor(Math.random() * 6)]}`,
    };
    if (canned[cmd]) setText(canned[cmd]);
    else if (cmd === '/me') setText('*' + '*' );
    else if (cmd === '/spoiler') setText('||' + '||');
    setTimeout(() => textareaRef.current?.focus(), 30);
  };

  const send = async () => {
    let content = text.trim();
    if ((!content && !attachments.length && !stickerId && !pollOpen) || sending) return;
    if (editing) {
      if (!content) { store.toast('Message cannot be empty.', 'error'); return; }
      setSending(true);
      try {
        const res = await api.patch<{ message: Message }>(`/api/messages/${editing.id}`, { content });
        onSent(res.message); setText(''); onCancelEdit();
      } catch (e) { store.toast(errorMessage(e), 'error'); }
      finally { setSending(false); }
      return;
    }
    // local slash expansion for prose commands
    if (/^\/me\s/.test(content)) content = '*' + content.slice(4) + '*';
    if (/^\/spoiler\s/.test(content)) content = '||' + content.slice(9) + '||';
    let body: any = { content, attachmentIds: attachments.map((a) => a.id), nonce: crypto.randomUUID(), stickerId: stickerId ?? undefined };
    if (replyTo) body.replyToId = replyTo.id;
    if (content.length > 4000) { store.toast('Message is too long. Even slop has limits (4000 chars).', 'error'); return; }
    if ((e2ee || localStorage.getItem(`slop-e2ee-${channel.id}`) === '1') && !editing) {
      if (!canE2ee) { store.toast('Cannot encrypt: no recipient public key on this device.', 'error', '🔒'); return; }
      try {
        const other = state.dms.find((d) => d.id === channel.id)?.members.find((m) => m.id !== state.user?.id);
        const enc = await encryptMessage(state.user!.id, content, other!.publicKey!);
        body = { ...body, content: enc.content, cryptoMeta: enc.cryptoMeta, encrypted: true };
      } catch (err) { store.toast(errorMessage(err), 'error'); return; }
    }
    if (pollOpen) { store.toast('Build your poll first, then send.', 'info'); }
    setSending(true);
    try {
      const res = await api.post<{ message: Message }>(`/api/channels/${channel.id}/messages`, body);
      setText(''); setAttachments([]); setStickerId(null); onCancelReply(); onSent(res.message);
    } catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setSending(false); }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLTextAreaElement;
    if (slashMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && slashMatches.length && text.trim() === slashMatches[slashIndex]?.cmd)) {
        e.preventDefault(); applyCommand(slashMatches[slashIndex]!.cmd); return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
    if (e.key === 'Escape') { if (editing) onCancelEdit(); if (replyTo) onCancelReply(); setEmojiOpen(false); setMemeOpen(false); setSlashIndex(0); }
  };

  const insertAtCursor = (value: string) => {
    const el = textareaRef.current;
    if (!el) { setText((t) => t + value); return; }
    const start = el.selectionStart ?? text.length, end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + value.length; });
  };
  const onEmojiPick = (emoji: string) => {
    if (emoji.includes(':') && !emoji.includes(' ') && emoji.split(':').length === 2) {
      const [name, id] = emoji.split(':');
      insertAtCursor(`<:${name}:${id}>`);
    } else insertAtCursor(emoji);
    setEmojiOpen(false);
  };

  return <div class="composer-wrap"
    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles([...e.dataTransfer!.files]); }}>
    {dragging ? <div class="composer-drop">DROP THE SLOP HERE</div> : null}
    <div class={`composer ${editing ? 'composer-editing' : ''}`}>
      {replyTo ? <div class="composer-reply"><Icon name="reply" size={13} /><span>Replying to <span class="reply-label">{replyTo.author.displayName}</span></span><span class="reply-close" onClick={onCancelReply}><Icon name="close" size={13} /></span></div> : null}
      {editing ? <div class="composer-reply"><Icon name="edit" size={13} /><span>Editing message</span><span class="reply-close" onClick={onCancelEdit}><Icon name="close" size={13} /></span></div> : null}
      {attachments.length ? <div class="upload-list">{attachments.map((a) => <div class="upload-chip" key={a.id}>
        {a.preview ? <img src={a.preview} alt="" /> : <Icon name="file" size={16} />}
        <span class="truncate">{a.filename}</span><span class="faint" style={{ fontSize: 10 }}>{fmtSize(a.size)}</span>
        <span class="up-close" onClick={() => void removeAttachment(a.id)}><Icon name="close" size={12} /></span>
      </div>)}</div> : null}
      {stickerId ? <div class="upload-list"><div class="upload-chip"><Icon name="sticker" size={14} /><span>sticker attached</span><span class="up-close" onClick={() => setStickerId(null)}><Icon name="close" size={12} /></span></div></div> : null}
      <div class="composer-main">
        <button class="btn-icon attach-btn" title="Upload a file" onClick={() => fileRef.current?.click()}><Icon name="plus" size={20} /></button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void addFiles([...(e.target as HTMLInputElement).files ?? []]); (e.target as HTMLInputElement).value = ''; }} />
        <textarea ref={textareaRef} class="composer-input" rows={1} value={text} placeholder={isThread ? `Reply in thread…#${channel.name}` : `Message #${channel.name}`}
          onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)} onKeyDown={onKeyDown}
          onPaste={(e) => { const files = [...(e.clipboardData?.files ?? [])]; if (files.length) { e.preventDefault(); void addFiles(files); } }} />
        <div class="composer-actions">
          {channel.type === 'dm' || channel.type === 'group_dm' ? <button class={`btn-icon ${e2ee ? 'lock-on' : ''}`} title={canE2ee ? (e2ee ? 'E2EE on' : 'Encrypt this DM (E2EE)') : 'E2EE unavailable'} onClick={toggleE2ee}><Icon name={e2ee ? 'lock' : 'unlock'} size={17} /></button> : null}
          <button class="btn-icon" title="Emoji" onClick={() => setEmojiOpen((v) => !v)}><Icon name="smile" size={18} /></button>
          <button class="btn-icon secondary" title="Sticker" onClick={() => setEmojiOpen((v) => !v)}><Icon name="sticker" size={17} /></button>
          <button class="btn-icon secondary" title="Meme" onClick={() => setMemeOpen((v) => !v)}><Icon name="image" size={17} /></button>
          <button class="btn-icon secondary" title="Poll" onClick={() => setPollOpen(true)}><Icon name="poll" size={17} /></button>
          <button class="btn-icon composer-more" title="More message tools" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            store.openMenu({ clientX: r.left, clientY: r.bottom }, [
              { label: 'Sticker', icon: 'sticker', action: () => setEmojiOpen(true) },
              { label: 'Meme', icon: 'image', action: () => setMemeOpen(true) },
              { label: 'Poll', icon: 'poll', action: () => setPollOpen(true) },
            ], 'Message tools');
          }}><Icon name="more" size={17} /></button>
          <button class="btn-icon send" title="Send (Enter)" disabled={sending || uploading > 0} onClick={() => void send()}><Icon name={sending ? 'refresh' : 'send'} size={18} /></button>
        </div>
      </div>
      <div class="composer-tools">
        <button class="tool-chip" onClick={() => store.openMenu({ clientX: window.innerWidth / 2, clientY: window.innerHeight - 180 }, COPYPASTAS.slice(0, 10).map((c) => ({ label: c.slice(0, 60) + (c.length > 60 ? '…' : ''), action: () => insertAtCursor(c) })), 'Copypasta machine')}>🍝 copypasta</button>
        <button class="tool-chip" onClick={() => insertAtCursor(generateSlop('', 1))}>🧠 generate slop</button>
        <span class="faint" style={{ marginLeft: 'auto', fontSize: 10 }}>{uploading > 0 ? <span class="row gap-4"><Spinner size={10} /> uploading…</span> : channel.slowmode ? <span class="slowmode-hint">slowmode {channel.slowmode}s</span> : 'Enter to send · Shift+Enter newline'}</span>
      </div>
    </div>
    <div class="composer-hint">{text.length > 3500 ? `${text.length}/4000 — calm down` : ''}</div>
    {slashMatches.length ? <div class="menu" style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 16, right: 16, maxWidth: 420 }}>
      <div class="menu-header">Slash commands</div>
      {slashMatches.map((s, i) => <button key={s.cmd + i} class={`menu-item ${i === slashIndex ? 'active' : ''}`} style={i === slashIndex ? { background: 'var(--bg-hover)' } : undefined} onClick={() => applyCommand(s.cmd)}><span class="mono">{s.cmd}</span><span class="shortcut">{s.desc}</span></button>)}
    </div> : null}
    {emojiOpen ? <EmojiPicker stickers onSticker={(s) => { setStickerId(s.id); setEmojiOpen(false); }} onPick={onEmojiPick} onClose={() => setEmojiOpen(false)} anchor={{ x: window.innerWidth - 380, y: window.innerHeight - 500 }} /> : null}
    {memeOpen ? <MemePicker onClose={() => setMemeOpen(false)} onPick={(name) => { insertAtCursor(` ![](/static/assets/memes/${name}.svg)`); setMemeOpen(false); }} /> : null}
    <PollModal open={pollOpen} onClose={() => setPollOpen(false)} onSend={async (poll) => {
      try {
        const res = await api.post<{ message: Message }>(`/api/channels/${channel.id}/messages`, { content: '', poll, nonce: crypto.randomUUID(), replyToId: replyTo?.id });
        onSent(res.message); setPollOpen(false); onCancelReply();
      } catch (e) { store.toast(errorMessage(e), 'error'); }
    }} />
  </div>;
}

function MemePicker({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  return <div class="emoji-picker" style={{ position: 'absolute', bottom: 'calc(100% + 8px)', right: 16, height: 'auto', zIndex: 1000 }}>
    <div class="emoji-picker-head"><strong style={{ flex: 1 }}>Local memes</strong><button class="btn-icon sm" onClick={onClose}><Icon name="close" size={14} /></button></div>
    <div class="sticker-grid">{MEMES.map((m) => <button key={m} class="sticker-cell" onClick={() => onPick(m)}><img src={`/static/assets/memes/${m}.svg`} alt={m} /><div class="faint text-center" style={{ fontSize: 10 }}>{m.replace(/-/g, ' ')}</div></button>)}</div>
    <div class="emoji-picker-foot">Bundled art. No external GIF API. No tracking pixels.</div>
  </div>;
}

function PollModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (poll: any) => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [duration, setDuration] = useState(0);
  useEffect(() => { if (open) { setQuestion(''); setOptions(['', '']); setMultiple(false); setDuration(0); } }, [open]);
  const submit = () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) { store.toast('Poll needs a question and at least 2 options.', 'error'); return; }
    void onSend({ question: question.trim(), options: opts, multiple, durationHours: duration || undefined });
  };
  return <Modal open={open} onClose={onClose} title="Create a poll" small footer={<><button class="btn btn-ghost" onClick={onClose}>Cancel</button><button class="btn btn-primary" onClick={submit}>Send poll</button></>}>
    <div class="modal-body">
      <Field label="Question"><input class="input" value={question} onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} placeholder="Is cereal a soup?" maxLength={200} /></Field>
      <Field label="Options" hint="2–10 options.">
        {options.map((o, i) => <div class="input-group mb-8" key={i}><input class="input" value={o} maxLength={80} placeholder={`Option ${i + 1}`} onInput={(e) => setOptions(options.map((x, j) => j === i ? (e.target as HTMLInputElement).value : x))} />
          {options.length > 2 ? <button class="btn-icon" onClick={() => setOptions(options.filter((_, j) => j !== i))}><Icon name="trash" size={15} /></button> : null}</div>)}
        {options.length < 10 ? <button class="btn btn-sm btn-ghost" onClick={() => setOptions([...options, ''])}><Icon name="plus" size={14} /> Add option</button> : null}
      </Field>
      <Field label="Closes in"><select class="select" value={duration} onChange={(e) => setDuration(Number((e.target as HTMLSelectElement).value))}><option value={0}>Never (chaos)</option><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>1 week</option></select></Field>
      <Toggle checked={multiple} onChange={setMultiple} label="Allow multiple choices" />
    </div>
  </Modal>;
}
