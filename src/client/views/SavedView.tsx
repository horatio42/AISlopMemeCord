import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { EmptyState } from '../components/Avatar';
import { Markdown } from '../lib/markdown';
import { fmtRelative } from '../lib/format';

export function SavedView() {
  const state = useApp();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { const res = await api.get<{ messages: any[] }>('/api/users/@me/saved'); setMessages(res.messages ?? []); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const jump = async (msg: any) => {
    try {
      if (msg.serverId) {
        await store.loadServer(msg.serverId);
        await store.openChannel(msg.serverId, msg.channelId);
      } else await store.openChannel(null, msg.channelId);
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const unsave = async (msg: any) => {
    try { await api.del(`/api/messages/${msg.id}/save`); setMessages((m) => m.filter((x) => x.id !== msg.id)); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  return (
    <main class="home-main">
      <div class="page-head"><Icon name="bookmark" size={22} class="text-accent" /><h1>Saved slop</h1><span class="badge">private to you</span></div>
      <div class="home-scroll"><div class="home-container" style={{ maxWidth: 860 }}>
        {loading ? <div class="empty"><span class="spinner" /></div> : messages.length ? messages.map((msg) => (
          <div class="card mb-8" key={msg.id} style={{ padding: 14 }}>
            <div class="row gap-8" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {msg.author ? <><img src={msg.author.avatar ?? `/static/assets/avatars/avatar-1.svg`} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} /><strong style={{ color: 'var(--text-soft)' }}>{msg.author.displayName}</strong></> : null}
              <span>{fmtRelative(msg.createdAt)}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button class="btn-link" onClick={() => jump(msg)}>Jump <Icon name="link" size={11} /></button>
                <button class="btn-link" onClick={() => unsave(msg)}>Unsave</button>
              </span>
            </div>
            {msg.encrypted ? <p class="muted mt-8" style={{ fontSize: 13 }}>🔒 Encrypted message. Saved ciphertext only; decrypt it on the original device.</p> : <div class="mt-8"><Markdown content={msg.content} /></div>}
          </div>
        )) : <EmptyState emoji="🔖" title="No saved slop">Save a message from its hover menu and it will appear here. Unlike your ex, it stays.</EmptyState>}
      </div></div>
    </main>
  );
}
