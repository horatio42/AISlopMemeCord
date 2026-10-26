import { useEffect, useState } from 'preact/hooks';
import type { Channel } from '../../shared/types';
import { api, errorMessage, uploadFile } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Icon } from './Icons';
import { Avatar, AvatarStack, EmptyState } from './Avatar';
import { Modal, Field, Spinner } from './Ui';
import { fmtRelative, fmtSize } from '../lib/format';
import { canChannel } from '../lib/permissions';
import { Perm } from '../../shared/permissions';

function plainPreview(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<a?:([A-Za-z0-9_~]+):[A-Za-z0-9_-]+>/g, ':$1:')
    .replace(/<@[!&]?([^>]+)>/g, '@mention')
    .replace(/<#([^>]+)>/g, '#channel')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
    .replace(/\|\|([\s\S]+?)\|\|/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 240 ? text.slice(0, 239).trimEnd() + '…' : text;
}

export function ForumView({ channel }: { channel: Channel }) {
  const state = useApp();
  const [posts, setPosts] = useState<any[]>([]);
  const [sort, setSort] = useState<'hot' | 'new' | 'top'>(channel.defaultSort ?? 'hot');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const canPost = canChannel(state, channel, Perm.CREATE_THREADS);
  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/api/channels/${channel.id}/posts?sort=${sort}&limit=25${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`);
      setPosts(res.posts ?? []); setHasMore(!!res.hasMore);
    } catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [channel.id, sort, tag]);
  useEffect(() => {
    const onUpdate = (e: any) => { if (e.detail?.thread?.parentId === channel.id) void load(); };
    window.addEventListener('slop:thread-update', onUpdate);
    return () => window.removeEventListener('slop:thread-update', onUpdate);
  }, [channel.id, sort, tag]);
  const vote = async (post: any, value: -1 | 1) => {
    try {
      const res: any = await api.put(`/api/messages/${post.firstMessage.id}/vote`, { value: post.firstMessage.myVote === value ? 0 : value });
      setPosts((ps) => ps.map((p) => p.thread.id === post.thread.id ? { ...p, score: res.score, firstMessage: { ...p.firstMessage, myVote: res.myVote, score: res.score } } : p));
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const open = async (post: any) => {
    store.state.channels[post.thread.id] = post.thread;
    await store.loadServer(post.thread.serverId, { force: false });
    await store.openChannel(post.thread.serverId, post.thread.id);
  };
  return <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
    <div class="forum-head">
      <h2><Icon name="forum" size={22} class="text-purple" /> {channel.name} <span class="badge purple">forum</span></h2>
      <div class="forum-toolbar">
        <div class="segmented">{(['hot', 'new', 'top'] as const).map((s) => <button key={s} class={sort === s ? 'active' : ''} onClick={() => setSort(s)}>{s}</button>)}</div>
        {canPost ? <button class="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}><Icon name="plus" size={14} /> New post</button> : null}
      </div>
      {channel.topic ? <div class="forum-topic">{channel.topic}</div> : null}
      {channel.tags.length ? <div class="chip-row">{channel.tags.map((t) => <button class={`chip ${tag === t ? 'active' : ''}`} key={t} onClick={() => setTag(tag === t ? '' : t)}>{t}</button>)}</div> : null}
    </div>
    <div class="forum-grid">
      {loading ? [1, 2, 3, 4].map((i) => <div class="forum-post" key={i}><div class="post-votes"><div class="skeleton" style={{ width: 24, height: 20 }} /></div><div class="post-main"><div class="skeleton" style={{ width: '60%', height: 18, marginBottom: 8 }} /><div class="skeleton" style={{ width: '90%', height: 12 }} /></div></div>) :
        posts.length ? posts.map((p) => {
          const fm = p.firstMessage;
          return <div class="forum-post" key={p.thread.id} onClick={() => void open(p)}>
            <div class="post-votes" onClick={(e) => e.stopPropagation()}>
              <button class={fm.myVote === 1 ? 'active-up' : ''} onClick={() => void vote(p, 1)} title="Upvote"><Icon name="arrowUp" size={15} /></button>
              <div class="score" style={{ color: p.score > 0 ? 'var(--accent)' : p.score < 0 ? 'var(--danger)' : undefined }}>{p.score}</div>
              <button class={fm.myVote === -1 ? 'active-down' : ''} onClick={() => void vote(p, -1)} title="Downvote"><Icon name="arrowDown" size={15} /></button>
            </div>
            <div class="post-main">
              <div class="post-title">{p.thread.archived ? <span title="archived">🧊</span> : null}{p.thread.name}{p.thread.tags?.map((t: string) => <span class="post-tag" key={t}>{t}</span>)}</div>
              <div class="post-preview">{plainPreview(fm.content) || '(attachment-only post)'}</div>
              <div class="post-meta">
                <span class="row gap-4"><Avatar user={fm.author} size={18} status={false} /> {fm.author.displayName}</span>
                <span>{fmtRelative(p.lastActivityAt)}</span>
                <span><Icon name="thread" size={11} /> {p.replyCount} replies</span>
                {p.participants?.length ? <AvatarStack users={p.participants} size={18} max={5} /> : null}
              </div>
            </div>
          </div>;
        }) : <EmptyState emoji="🧵" title="No posts yet">This forum is a blank canvas of potential slop. Make the first post, coward.
          {canPost ? <button class="btn btn-primary btn-sm mt-8" onClick={() => setNewOpen(true)}>Create post</button> : null}
        </EmptyState>}
    </div>
    <NewPostModal open={newOpen} channel={channel} onClose={() => setNewOpen(false)} onCreated={async (res) => {
      store.state.channels[res.thread.id] = res.thread;
      await store.loadServer(channel.serverId!, { force: true }).catch(() => null);
      setNewOpen(false);
      await store.openChannel(channel.serverId!, res.thread.id);
    }} />
  </div>;
}

function NewPostModal({ open, channel, onClose, onCreated }: { open: boolean; channel: Channel; onClose: () => void; onCreated: (res: any) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<{ id: string; filename: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTitle(''); setContent(''); setTags([]); setFiles([]); } }, [open]);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of [...list].slice(0, 5)) { const up = await uploadFile(f, 'attachment'); setFiles((x) => [...x, { id: up.id, filename: up.filename, size: up.size }]); }
    } catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setUploading(false); }
  };
  const submit = async () => {
    if (!title.trim() || (!content.trim() && !files.length)) { store.toast('Title and content/attachment required.', 'error'); return; }
    setBusy(true);
    try {
      const res = await api.post<any>(`/api/channels/${channel.id}/posts`, { title: title.trim(), content, tags, attachmentIds: files.map((f) => f.id) });
      onCreated(res);
      store.toast('Post published to the slop board.', 'success', '🧵');
    } catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Create a forum post" wide footer={<><button class="btn btn-ghost" onClick={onClose}>Cancel</button><button class="btn btn-primary" disabled={busy} onClick={submit}>{busy ? <Spinner size={14} /> : 'Publish post'}</button></>}>
    <div class="modal-body">
      <Field label="Title"><input class="input" value={title} maxLength={100} placeholder="A title so good it gets 3 upvotes" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></Field>
      <Field label="Content" hint="Markdown supported. Memes encouraged."><textarea class="textarea" rows={7} value={content} maxLength={4000} placeholder="Tell us your worst take…" onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)} /></Field>
      {channel.tags.length ? <Field label="Tags"><div class="chip-row">{channel.tags.map((t) => <button key={t} class={`chip ${tags.includes(t) ? 'active' : ''}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : tags.length < 5 ? [...tags, t] : tags)}>{t}</button>)}</div></Field> : null}
      <Field label="Attachments">
        <div class="row gap-8 wrap">{files.map((f) => <span class="meme-chip" key={f.id}>{f.filename} <span class="faint">{fmtSize(f.size)}</span></span>)}
          <label class="btn btn-sm"><Icon name="image" size={14} /> Add file<input type="file" multiple hidden onChange={(e) => void upload((e.target as HTMLInputElement).files)} /></label>
          {uploading ? <Spinner size={14} /> : null}
        </div>
      </Field>
    </div>
  </Modal>;
}
