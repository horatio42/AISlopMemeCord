import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { api, errorMessage } from '../../lib/api';
import { store, useApp } from '../../lib/use-store';
import { Icon } from '../Icons';
import { Avatar } from '../Avatar';
import { Spinner } from '../Ui';
import { Markdown } from '../../lib/markdown';
import { fmtRelative } from '../../lib/format';
import type { Message, User } from '../../../shared/types';

function takeOperator(text: string, name: string): { value: string | null; text: string } {
  const match = text.match(new RegExp(`(?:^|\\s)${name}:(\\S+)`, 'i'));
  if (!match) return { value: null, text };
  return { value: match[1]!, text: text.replace(match[0], ' ').replace(/\s+/g, ' ').trim() };
}

function timestampOperator(raw: string): number | null {
  if (/^\d{10,}$/.test(raw)) return Number(raw);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function SearchModal() {
  const state = useApp();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'channel' | 'server' | 'all'>('channel');
  const [has, setHas] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const directory = useMemo(() => {
    const users = new Map<string, User>();
    if (state.user) users.set(state.user.id, state.user);
    for (const b of Object.values(state.servers)) for (const m of b.members) users.set(m.user.id, m.user);
    for (const d of state.dms) for (const m of d.members) users.set(m.id, m);
    for (const f of [...state.friends.friends, ...state.friends.incoming, ...state.friends.outgoing]) users.set(f.user.id, f.user);
    return [...users.values()];
  }, [state.user, state.servers, state.dms, state.friends]);
  const close = () => store.updateUi({ searchOpen: false, searchQuery: '' });
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 40); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!query.trim()) { setResults([]); setTotal(0); setError(''); return; }
    let cancelled = false;
    setLoading(true); setError('');
    const timer = setTimeout(async () => {
      try {
        let text = query;
        const from = takeOperator(text, 'from'); text = from.text;
        const before = takeOperator(text, 'before'); text = before.text;
        const after = takeOperator(text, 'after'); text = after.text;
        const hasOp = takeOperator(text, 'has'); text = hasOp.text;
        if (!text.trim()) throw new Error('Add some words alongside those filters. Even slop needs a subject.');
        let authorId: string | undefined;
        if (from.value) {
          const needle = from.value.replace(/^@/, '').toLowerCase();
          const found = directory.find((u) => u.username.toLowerCase() === needle || u.displayName.toLowerCase() === needle);
          if (!found) throw new Error(`No visible user matches from:${from.value}.`);
          authorId = found.id;
        }
        const params = new URLSearchParams({ q: text.trim(), limit: '25', offset: String(offset) });
        if (scope === 'channel' && state.activeChannelId) params.set('channelId', state.activeChannelId);
        if (scope === 'server' && state.activeServerId) params.set('serverId', state.activeServerId);
        if (authorId) params.set('authorId', authorId);
        for (const [key, op] of [['before', before.value], ['after', after.value]] as const) {
          if (!op) continue;
          const ts = timestampOperator(op);
          if (!ts) throw new Error(`${key}:${op} is not a date or epoch timestamp.`);
          params.set(key, String(ts));
        }
        const effectiveHas = hasOp.value && ['image', 'file', 'link'].includes(hasOp.value) ? hasOp.value : has;
        if (effectiveHas) params.set('has', effectiveHas);
        const res: any = await api.get(`/api/search?${params}`);
        if (!cancelled) { setResults(res.messages ?? []); setTotal(res.total ?? (res.messages?.length ?? 0)); }
      } catch (e) { if (!cancelled) { setError(errorMessage(e)); setResults([]); setTotal(0); } }
      finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope, has, offset, state.activeChannelId, state.activeServerId, directory]);
  const jump = async (m: Message) => {
    try {
      store.updateUi({ searchOpen: false });
      if (m.serverId) { await store.loadServer(m.serverId); await store.openChannel(m.serverId, m.channelId); }
      else await store.openChannel(null, m.channelId);
      setTimeout(() => { location.hash = `message-${m.id}`; document.getElementById(`message-${m.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 400);
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const channelName = (m: Message) => state.channels[m.channelId]?.name ?? (state.dms.find((d) => d.id === m.channelId)?.name || 'conversation');
  const serverName = (m: Message) => m.serverId ? state.servers[m.serverId]?.server.name : 'DM';
  return createPortal(<div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="search-panel card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div class="search-bar">
        <Icon name="search" size={18} class="text-accent" />
        <input ref={inputRef} value={query} onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setOffset(0); }} placeholder="Search messages, slop, regrets…" />
        {loading ? <Spinner size={16} /> : null}
        <button class="btn-icon sm" onClick={close}><Icon name="close" size={17} /></button>
      </div>
      <div class="search-filters">
        {(['channel', 'server', 'all'] as const).map((s) => <button key={s} class={`chip ${scope === s ? 'active' : ''}`} onClick={() => { setScope(s); setOffset(0); }}>{s === 'channel' ? 'This channel' : s === 'server' ? 'This server' : 'Everything'}</button>)}
        <select class="select" style={{ width: 'auto', padding: '3px 8px', fontSize: 12 }} value={has} onChange={(e) => { setHas((e.target as HTMLSelectElement).value); setOffset(0); }}>
          <option value="">Any content</option><option value="image">Has image</option><option value="file">Has file</option><option value="link">Has link</option>
        </select>
        <span class="faint" style={{ marginLeft: 'auto', fontSize: 11 }}>{query ? `${total} result${total === 1 ? '' : 's'}` : 'FTS5, local only'}</span>
      </div>
      <div class="search-results">
        {error ? <div class="auth-error">{error}</div> : !query.trim() ? <div class="search-empty"><div style={{ fontSize: 34 }}>🔎</div><p class="mt-8">Type at least something. Search runs entirely on this instance's SQLite FTS index. No Algolia, no telemetry.</p><div class="row gap-4 center mt-16 wrap"><span class="kbd">from:username</span><span class="kbd">has:image</span><span class="kbd">before:2026-01-01</span><span class="kbd">after:2026-01-01</span></div></div> :
          results.length ? results.map((m) => <div class="search-result" key={m.id} onClick={() => void jump(m)}>
            <Avatar user={m.author} size={32} status={false} />
            <div class="sr-body">
              <div class="sr-head"><span class="sr-author">{m.author.displayName}</span><span>in {serverName(m)} · #{channelName(m)}</span><span>{fmtRelative(m.createdAt)}</span>{m.score ? <span class="badge accent" style={{ fontSize: 9 }}>{m.score} pts</span> : null}</div>
              <div class="sr-content"><Markdown content={m.encrypted ? '🔒 encrypted message (not searchable on server)' : m.content} /></div>
            </div>
          </div>) : <div class="search-empty"><div style={{ fontSize: 32 }}>🫠</div><p class="mt-8">No messages matched. The slop you seek is in another channel.</p></div>}
      </div>
      {total > 25 ? <div class="row-between" style={{ padding: '8px 14px', borderTop: '1px solid var(--border-soft)' }}><button class="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span class="faint" style={{ fontSize: 11 }}>{offset + 1}–{Math.min(offset + 25, total)} of {total}</span><button class="btn btn-sm" disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Next</button></div> : null}
    </div>
  </div>, document.body);
}
