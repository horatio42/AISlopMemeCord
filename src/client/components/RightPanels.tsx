import { useEffect, useState } from 'preact/hooks';
import { useApp, store } from '../lib/use-store';
import { api, errorMessage } from '../lib/api';
import { Icon } from './Icons';
import { Avatar, EmptyState } from './Avatar';
import { Markdown } from '../lib/markdown';
import { MessageRow } from './Message';
import { Composer } from './Composer';
import { fmtRelative } from '../lib/format';
import type { Message } from '../../shared/types';

export function RightPanels({ onReport }: { onReport: (m: Message) => void }) {
  const state = useApp();
  const panel = state.ui.rightPanel;
  const close = () => store.updateUi({ rightPanel: null });
  if (!panel) return null;
  const title = panel.kind === 'threads' ? 'Threads' : panel.kind === 'pins' ? 'Pinned messages' : panel.kind === 'thread' ? 'Thread' : 'Soundboard';
  return <aside class="right-panel">
    <div class="right-panel-head">
      <Icon name={panel.kind === 'threads' ? 'thread' : panel.kind === 'pins' ? 'pin' : 'thread'} size={17} />
      <span class="grow truncate">{panel.kind === 'thread' ? state.channels[panel.threadId]?.name ?? 'Thread' : title}</span>
      <button class="btn-icon sm" onClick={close}><Icon name="close" size={16} /></button>
    </div>
    <div class="right-panel-body">
      {panel.kind === 'threads' ? <ThreadsPanel channelId={panel.channelId} /> : panel.kind === 'pins' ? <PinsPanel channelId={panel.channelId} /> : panel.kind === 'thread' ? <ThreadPanel threadId={panel.threadId} parentId={panel.parentId} onReport={onReport} /> : null}
    </div>
  </aside>;
}

function ThreadsPanel({ channelId }: { channelId: string }) {
  const [threads, setThreads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/api/channels/${channelId}/threads`).then((r) => setThreads(r.threads ?? [])).catch((e) => store.toast(errorMessage(e), 'error')).finally(() => setLoading(false));
  }, [channelId]);
  if (loading) return <div class="empty"><span class="spinner" /></div>;
  if (!threads.length) return <EmptyState emoji="🧵" title="No active threads">Right-click a message (or use its menu) to start a thread. Extremely online behavior.</EmptyState>;
  return <div class="thread-list">{threads.map((t) => <button class="thread-item" key={t.id} onClick={() => {
    store.state.channels[t.id] = t;
    store.updateUi({ rightPanel: { kind: 'thread', threadId: t.id, parentId: channelId } });
    void store.loadMessages(t.id);
  }}>
    <div class="ti-name"><Icon name="thread" size={13} />{t.name}</div>
    <div class="ti-meta">{t.archived ? '🧊 archived · ' : ''}{t.lastMessageId ? `active ${fmtRelative(lastMsgTime(t.lastMessageId))}` : 'no messages'}</div>
  </button>)}</div>;
}
function lastMsgTime(id: string): number { const part = id.split('_')[1]?.slice(0, 9) ?? ''; return parseInt(part, 36) || Date.now(); }

function PinsPanel({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>(`/api/channels/${channelId}/pins`).then((r) => setMessages(r.messages ?? [])).catch((e) => store.toast(errorMessage(e), 'error')).finally(() => setLoading(false));
  }, [channelId]);
  if (loading) return <div class="empty"><span class="spinner" /></div>;
  if (!messages.length) return <EmptyState emoji="📌" title="Nothing pinned">No bangers have been pinned yet. The council is disappointed.</EmptyState>;
  return <div style={{ padding: 8 }}>{messages.map((m) => <div class="card flat mb-8" key={m.id} style={{ padding: 10 }}>
    <div class="row gap-6" style={{ fontSize: 11, color: 'var(--muted)' }}><Avatar user={m.author} size={18} status={false} /><strong style={{ color: 'var(--text-soft)' }}>{m.author.displayName}</strong><span>{fmtRelative(m.createdAt)}</span>
      <button class="btn-link" style={{ marginLeft: 'auto' }} onClick={() => {
        store.updateUi({ rightPanel: null });
        const el = document.getElementById(`message-${m.id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }}>Jump</button>
    </div>
    <div class="mt-8" style={{ fontSize: 12.5 }}><Markdown content={m.encrypted ? '🔒 encrypted message' : m.content} /></div>
  </div>)}</div>;
}

function ThreadPanel({ threadId, parentId, onReport }: { threadId: string; parentId: string; onReport: (m: Message) => void }) {
  const state = useApp();
  const thread = state.channels[threadId];
  const cache = state.messages[threadId];
  const [reply, setReply] = useState<Message | null>(null);
  const [edit, setEdit] = useState<Message | null>(null);
  useEffect(() => { if (threadId) void store.loadMessages(threadId); }, [threadId]);
  if (!thread) return <div class="empty"><span class="spinner" /><p>Thread loading…</p></div>;
  const onSent = (m: Message) => {
    const c = store.state.messages[threadId];
    if (c && !c.messages.find((x) => x.id === m.id)) c.messages.push(m);
    store.emit(); setReply(null); setEdit(null);
  };
  return <div class="thread-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
      <button class="btn-link" onClick={() => store.updateUi({ rightPanel: { kind: 'threads', channelId: parentId } })}>← All threads</button>
      <span class="grow" />
      <button class="btn-icon sm" title="Open as full channel" onClick={() => { store.updateUi({ rightPanel: null }); void store.openChannel(thread.serverId, thread.id); }}><Icon name="link" size={14} /></button>
    </div>
    <div class="messages-scroll grow">
      {(cache?.messages ?? []).map((m, i) => {
        const prev = cache?.messages[i - 1];
        const grouped = !!prev && prev.author.id === m.author.id && m.createdAt - prev.createdAt < 300_000 && !m.replyTo;
        return <MessageRow key={m.id} message={m} channel={thread} grouped={grouped} onReply={setReply} onEdit={setEdit} onReport={onReport} />;
      })}
      {cache?.loading && !cache.loaded ? <div class="empty"><span class="spinner" /></div> : null}
    </div>
    <Composer channel={thread} replyTo={reply} editing={edit} onSent={onSent} onCancelReply={() => setReply(null)} onCancelEdit={() => setEdit(null)} />
  </div>;
}
