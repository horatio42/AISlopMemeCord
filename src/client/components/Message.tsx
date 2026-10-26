import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Attachment, Channel, Message, Poll } from '../../shared/types';
import { useApp, store } from '../lib/use-store';
import { api, errorMessage, qs } from '../lib/api';
import { Avatar } from './Avatar';
import { Icon } from './Icons';
import { Markdown } from '../lib/markdown';
import { fmtFullRelative, fmtSize, fmtTime, fmtRelative } from '../lib/format';
import { EmojiPicker } from './EmojiPicker';
import { AWARDS } from '../../shared/memes';
import { decryptMessage } from '../lib/e2ee';

interface Props {
  message: Message;
  channel: Channel;
  grouped: boolean;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  onReport: (m: Message) => void;
}

function findEmoji(state: any, emoji: string): { url: string; name: string } | null {
  const match = emoji.match(/^<a?:([A-Za-z0-9_~-]+):([A-Za-z0-9_-]+)>$/) ?? emoji.match(/^a?:([A-Za-z0-9_~-]+):([A-Za-z0-9_-]+)$/);
  if (match) {
    const [, name, id] = match;
    for (const b of Object.values(state.servers) as any[]) {
      const found = b.emojis.find((e: any) => e.id === id || e.name === name);
      if (found) return { url: found.url, name: found.name };
    }
  }
  return null;
}
export function renderReactionEmoji(state: any, emoji: string) {
  const custom = findEmoji(state, emoji);
  return custom ? <img class="emoji-inline" src={custom.url} alt={`:${custom.name}:`} title={`:${custom.name}:`} /> : <span>{emoji}</span>;
}

export function MessageRow({ message, channel, grouped, onReply, onEdit, onReport }: Props) {
  const state = useApp();
  const [emojiOpen, setEmojiOpen] = useState<null | { x: number; y: number }>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState(false);
  const [pollBusy, setPollBusy] = useState(false);
  const deleted = !!message.deletedAt;
  const bundle = message.serverId ? state.servers[message.serverId] : null;
  const member = bundle?.members.find((m) => m.user.id === message.author.id);
  const authorName = member?.nickname || message.author.displayName;
  const roleColor = useMemo(() => {
    if (!member || !bundle) return undefined;
    const rs = bundle.roles.filter((r) => member.roles.includes(r.id) && r.color && r.color !== '#99aab5' && r.color !== 'transparent').sort((a, b) => b.position - a.position);
    return rs[0]?.color;
  }, [member, bundle]);
  const dmChannel = channel.type === 'dm' || channel.type === 'group_dm' ? state.dms.find((d) => d.id === channel.id) : null;
  const otherUser = dmChannel?.members.find((m) => m.id !== state.user?.id);

  useEffect(() => {
    setDecrypted(null); setDecryptError(false);
    if (!message.encrypted || deleted) return;
    if (channel.type !== 'dm' || !state.user) return;
    const peerPub = message.author.id === state.user.id ? otherUser?.publicKey : message.author.publicKey;
    if (!peerPub) { setDecryptError(true); return; }
    let cancelled = false;
    decryptMessage(state.user.id, message.content, message.cryptoMeta, peerPub)
      .then((text) => { if (!cancelled) setDecrypted(text); })
      .catch(() => { if (!cancelled) setDecryptError(true); });
    return () => { cancelled = true; };
  }, [message.id, message.content, message.cryptoMeta, message.author.id, otherUser?.publicKey, state.user?.id, channel.type, deleted]);

  const isMine = message.author.id === state.user?.id;
  const updateMessage = (patch: Partial<Message>) => {
    const cache = state.messages[channel.id];
    if (cache) {
      const idx = cache.messages.findIndex((m) => m.id === message.id);
      if (idx >= 0) cache.messages[idx] = { ...cache.messages[idx]!, ...patch };
    }
    store.emit();
  };
  const vote = async (value: -1 | 0 | 1) => {
    const next = message.myVote === value ? 0 : value;
    try {
      const res: any = await api.put(`/api/messages/${message.id}/vote`, { value: next });
      updateMessage({ score: res.score ?? message.score + (next - message.myVote), myVote: (res.myVote ?? next) as -1 | 0 | 1 });
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const toggleReaction = async (emoji: string) => {
    const existing = message.reactions.find((r) => r.emoji === emoji);
    try {
      const path = `/api/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`;
      const res: any = existing?.me ? await api.del(path) : await api.put(path, {});
      if (res?.reactions) updateMessage({ reactions: res.reactions });
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const pin = async () => {
    try {
      if (message.pinned) await api.del(`/api/messages/${message.id}/pin`);
      else await api.post(`/api/messages/${message.id}/pin`);
      updateMessage({ pinned: !message.pinned, pinnedAt: message.pinned ? null : Date.now() });
      store.toast(message.pinned ? 'Unpinned' : 'Pinned to the hall of slop', 'success', '📌');
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const save = async () => {
    try {
      if (message.saved) await api.del(`/api/messages/${message.id}/save`);
      else await api.post(`/api/messages/${message.id}/save`);
      updateMessage({ saved: !message.saved });
      store.toast(message.saved ? 'Removed from saved' : 'Saved for later slop', 'success', '🔖');
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const remove = async () => {
    if (!confirm('Delete this message? It will vanish like your motivation.')) return;
    try {
      await api.del(`/api/messages/${message.id}`);
      const cache = state.messages[channel.id];
      if (cache) cache.messages = cache.messages.filter((m) => m.id !== message.id);
      store.emit();
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const award = async (key: string) => {
    try {
      const res: any = await api.post(`/api/messages/${message.id}/award`, { award: key });
      if (res?.message?.awards) updateMessage({ awards: res.message.awards });
      else if (res?.awards) updateMessage({ awards: res.awards });
      else {
        const existing = message.awards.find((a) => a.key === key);
        updateMessage({ awards: existing ? message.awards.map((a) => a.key === key ? { ...a, count: a.count + 1 } : a) : [...message.awards, { key, count: 1 }] });
      }
      store.toast('Award deployed. The council nods.', 'success', AWARDS.find((a) => a.key === key)?.emoji ?? '🏆');
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const startThread = async () => {
    try {
      const name = (message.content || 'Thread of the void').replace(/\s+/g, ' ').slice(0, 52);
      const res: any = await api.post(`/api/messages/${message.id}/thread`, { name });
      if (res.thread?.id) {
        store.state.channels[res.thread.id] = res.thread;
        store.updateUi({ rightPanel: { kind: 'thread', threadId: res.thread.id, parentId: channel.id } });
        void store.loadMessages(res.thread.id);
      }
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const copyLink = async () => {
    const url = channel.type === 'dm' || channel.type === 'group_dm'
      ? `${location.origin}/channels/@me/${channel.id}#message-${message.id}`
      : `${location.origin}/channels/${message.serverId}/${channel.id}#message-${message.id}`;
    try { await navigator.clipboard.writeText(url); store.toast('Message link copied', 'success', '🔗'); } catch { store.toast('Clipboard denied by browser', 'error'); }
  };
  const moreMenu = (e: MouseEvent) => {
    const items: any[] = [
      { label: 'Reply', icon: 'reply', action: () => onReply(message) },
      { label: message.pinned ? 'Unpin' : 'Pin message', icon: 'pin', action: pin },
      { label: message.saved ? 'Unsave' : 'Save message', icon: 'bookmark', action: save },
      { label: 'Copy link', icon: 'link', action: copyLink },
      { label: 'Create thread', icon: 'thread', action: startThread },
      { separator: true, label: '' },
      { label: 'Give award', icon: 'award', action: () => store.openMenu({ clientX: e.clientX + 140, clientY: e.clientY }, AWARDS.map((a) => ({ label: `${a.emoji} ${a.name}`, action: () => award(a.key) })), 'Slop awards') },
    ];
    if (isMine) items.push({ label: 'Edit message', icon: 'edit', action: () => onEdit(message) });
    if (isMine) items.push({ label: 'Delete message', icon: 'trash', danger: true, action: remove });
    items.push({ separator: true, label: '' }, { label: 'Report message', icon: 'alert', danger: true, action: () => onReport(message) });
    store.openMenu(e, items, 'Message actions');
  };

  if (message.system) {
    return <div class="system-msg" id={`message-${message.id}`}>
      <Icon name="sparkles" size={14} class="sys-icon" />
      <span>{message.author.displayName}</span>
      <Markdown content={message.content} />
      <span class="faint" style={{ fontSize: 10 }}>{fmtTime(message.createdAt)}</span>
    </div>;
  }

  const displayContent = message.encrypted ? (decrypted ?? '') : message.content;
  const emojiPickerAnchor = () => {
    const btn = document.querySelector(`#msg-actions-${message.id} button[data-react]`) as HTMLElement | null;
    const r = btn?.getBoundingClientRect();
    setEmojiOpen({ x: (r?.left ?? window.innerWidth - 360), y: (r?.top ?? 100) - 360 });
  };
  const isJumbo = !message.encrypted && displayContent.length < 120;

  return (
    <div id={`message-${message.id}`} class={`message ${grouped ? '' : 'group-start'} ${isMine ? 'own' : ''}`}>
      {grouped ? (
        <div class="msg-gutter"><span class="gutter-time">{fmtTime(message.createdAt)}</span></div>
      ) : (
        <div class="msg-avatar-col">
          <Avatar user={message.author} size={40} onClick={() => void store.showProfile(message.author.id)} />
        </div>
      )}
      <div class="msg-body">
        {message.replyTo ? (
          <div class="msg-reply" onClick={() => document.getElementById(`message-${message.replyTo!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} title="Jump to replied message">
            <span class="reply-author">{message.replyTo.authorName}</span>
            <span class="reply-text">{message.replyTo.deleted ? 'original message deleted' : message.replyTo.content}</span>
          </div>
        ) : null}
        {!grouped ? (
          <div class="msg-header">
            <span class="msg-author" style={roleColor ? { color: roleColor } : undefined} onClick={() => void store.showProfile(message.author.id)}>{authorName}</span>
            {message.author.isBot ? <span class="msg-tag">BOT</span> : null}
            <span class="msg-time" title={fmtFullRelative(message.createdAt)}>{fmtTime(message.createdAt)}</span>
            {message.pinned ? <span class="msg-tag" style={{ background: 'var(--warning)' }}>📌 pinned</span> : null}
            {message.encrypted ? <span class="msg-tag" style={{ background: 'var(--success)' }}><Icon name="lock" size={9} /> e2ee</span> : null}
          </div>
        ) : null}
        {message.encrypted ? (
          decrypted ? <div class={`msg-content ${isJumbo && /\p{Extended_Pictographic}/u.test(displayContent) ? 'jumbo' : ''}`}><Markdown content={displayContent} /></div> :
          <div class="msg-content muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            🔒 <span>{decryptError ? 'Encrypted message. The private key for this conversation is not on this device.' : 'Decrypting…'}</span>
          </div>
        ) : displayContent ? <Markdown content={displayContent} /> : null}
        {message.editedAt ? <span class="msg-edited">(edited)</span> : null}
        <AttachmentsList attachments={message.attachments} revealed={revealed} setRevealed={setRevealed} />
        {message.sticker ? <img class="sticker-img" src={message.sticker.url} alt={message.sticker.name} title={message.sticker.name} loading="lazy" /> : null}
        {message.poll ? <PollCard poll={message.poll} messageId={message.id} busy={pollBusy} setBusy={setPollBusy} onUpdate={(p) => updateMessage({ poll: p })} /> : null}
        {message.reactions.length ? <div class="reaction-row">
          {message.reactions.map((r) => <button key={r.emoji} class={`reaction ${r.me ? 'mine' : ''}`} onClick={() => toggleReaction(r.emoji)} title={r.userIds?.length ? `Reacted by ${r.userIds.length} goblin(s)` : undefined}>
            {renderReactionEmoji(state, r.emoji)}<span class="re-count">{r.count}</span>
          </button>)}
          <button class="reaction-add" title="Add reaction" onClick={emojiPickerAnchor}>+</button>
        </div> : null}
        {message.awards.length ? <div class="awards-row">{message.awards.map((a) => {
          const def = AWARDS.find((x) => x.key === a.key);
          return <span key={a.key} class="award-badge" style={{ '--award-color': def?.color } as any} title={def?.description}>{def?.emoji ?? '🏆'}{a.count > 1 ? <span class="a-count">{a.count}</span> : null}</span>;
        })}</div> : null}
      </div>
      {!deleted ? <div class="msg-actions" id={`msg-actions-${message.id}`}>
        <button class="btn-icon" title="Add reaction" data-react onClick={emojiPickerAnchor}><Icon name="smile" size={15} /></button>
        <button class="btn-icon" title="Reply" onClick={() => onReply(message)}><Icon name="reply" size={15} /></button>
        <button class="btn-icon" title="Create thread" onClick={startThread}><Icon name="thread" size={15} /></button>
        <span class="msg-score" title="Slop Points">{message.score}</span>
        <button class={`btn-icon ${message.myVote === 1 ? 'liked' : ''}`} title="Upvote (this totally matters)" onClick={() => vote(1)}><Icon name="arrowUp" size={15} /></button>
        <button class={`btn-icon ${message.myVote === -1 ? 'disliked' : ''}`} title="Downvote (L + ratio)" onClick={() => vote(-1)}><Icon name="arrowDown" size={15} /></button>
        <button class="btn-icon" title="More" onClick={moreMenu}><Icon name="more" size={15} /></button>
      </div> : null}
      {emojiOpen ? <EmojiPicker anchor={emojiOpen} onClose={() => setEmojiOpen(null)} onPick={(emoji) => { setEmojiOpen(null); void toggleReaction(emoji); }} /> : null}
    </div>
  );
}

function AttachmentsList({ attachments, revealed, setRevealed }: { attachments: Attachment[]; revealed: Record<string, boolean>; setRevealed: (r: Record<string, boolean>) => void }) {
  if (!attachments.length) return null;
  const images = attachments.filter((a) => a.contentType.startsWith('image/') || a.contentType.startsWith('video/'));
  const files = attachments.filter((a) => !images.includes(a));
  return <>
    {images.length ? <div class="attachment-grid" style={{ gridTemplateColumns: images.length === 1 ? 'minmax(0, 420px)' : undefined }}>
      {images.map((a) => {
        const hidden = a.spoiler && !revealed[a.id];
        const media = a.contentType.startsWith('video/')
          ? <video src={a.url} controls preload="metadata" />
          : <img src={a.url} alt={a.alt ?? a.filename} loading="lazy" />;
        return <div key={a.id} class={`attachment single ${hidden ? 'attachment-blur' : ''}`}>
          {hidden ? <>
            <img src={a.url} alt="" />
            <span class="spoiler-tag">SPOILER</span>
            <button class="reveal-btn" onClick={(e) => { e.preventDefault(); setRevealed({ ...revealed, [a.id]: true }); }}>Click to reveal cursed content</button>
          </> : <div onClick={(e) => { if (a.contentType.startsWith('image/')) { e.preventDefault(); store.openLightbox(a.url, a.alt ?? a.filename); } }}>{media}</div>}
          <div class="attachment-meta" style={{ padding: '4px 6px' }}>{a.spoiler ? 'spoiler · ' : ''}{fmtSize(a.size)} · {a.filename}</div>
        </div>;
      })}
    </div> : null}
    {files.map((a) => <a key={a.id} class="attachment attachment-file" href={a.url} download={a.filename} target="_blank" rel="noopener noreferrer">
      <Icon name="file" size={22} class="file-icon" />
      <div class="grow"><div class="truncate">{a.filename}</div><div class="file-meta">{fmtSize(a.size)} · {a.contentType}</div></div>
      <Icon name="download" size={16} />
    </a>)}
  </>;
}

function PollCard({ poll, messageId, busy, setBusy, onUpdate }: { poll: Poll; messageId: string; busy: boolean; setBusy: (v: boolean) => void; onUpdate: (p: Poll) => void }) {
  const [selected, setSelected] = useState<string[]>(poll.myVotes ?? []);
  const closed = !!poll.closesAt && poll.closesAt < Date.now();
  const submit = async (optionId: string) => {
    let ids = [optionId];
    if (poll.multiple) {
      ids = selected.includes(optionId) ? selected.filter((x) => x !== optionId) : [...selected, optionId];
      setSelected(ids);
    }
    setBusy(true);
    try {
      const res: any = await api.post(`/api/messages/${messageId}/poll/vote`, { optionIds: ids });
      if (res.poll) onUpdate(res.poll);
      else window.location.reload();
    } catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setBusy(false); }
  };
  return <div class="poll-card">
    <div class="poll-title"><Icon name="poll" size={16} class="poll-icon" />{poll.question}</div>
    <div class="poll-meta">{poll.totalVotes} vote{poll.totalVotes === 1 ? '' : 's'}{poll.multiple ? ' · multiple choice' : ''}{closed ? ' · closed' : poll.closesAt ? ` · closes ${fmtRelative(poll.closesAt)}` : ''}</div>
    {poll.options.map((o) => {
      const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
      const mine = (poll.multiple ? selected : poll.myVotes).includes(o.id);
      return <button key={o.id} class={`poll-option ${mine ? 'mine' : ''}`} disabled={closed || busy} onClick={() => submit(o.id)}>
        <span class="poll-bar" style={{ '--pct': `${pct}%` } as any} />
        {o.label}<span class="poll-count">{pct}% · {o.votes}</span>
      </button>;
    })}
    <div class="poll-footer"><Icon name="info" size={12} /> Votes are stored locally. No Russian bots were harmed.</div>
  </div>;
}
