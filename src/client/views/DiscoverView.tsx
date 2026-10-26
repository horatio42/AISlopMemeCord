import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, errorMessage } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { EmptyState } from '../components/Avatar';

export function DiscoverView() {
  const state = useApp();
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [joining, setJoining] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get<{ servers: any[] }>('/api/discover');
      setServers(res.servers ?? []);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => servers.filter((s) => !query || (s.name + ' ' + (s.description ?? '')).toLowerCase().includes(query.toLowerCase())), [servers, query]);

  const join = async (s: any) => {
    if (state.servers[s.id]) { const m = await import('../components/GuildRail'); await m.openServer(s.id); return; }
    setJoining(s.id);
    try {
      const res = await api.post<any>(`/api/discover/${s.id}/join`, {});
      store.toast(`Joined ${s.name}. Your life is now worse.`, 'success', '🫡');
      await store.loadWorkspace();
      await store.loadServer(s.id, { force: true });
      const channelId = res.channel?.id ?? store.state.servers[s.id]?.channels.find((c) => c.type === 'text')?.id;
      if (channelId) await store.openChannel(s.id, channelId);
      else { history.pushState({}, '', '/discover'); await store.applyRoute('/discover', false); }
    } catch (e) { store.toast(errorMessage(e), 'error'); }
    finally { setJoining(''); }
  };

  return (
    <main class="home-main">
      <div class="page-head">
        <Icon name="compass" size={22} class="text-purple" />
        <h1>Discover</h1>
        <span class="badge purple">public servers only</span>
        <div class="search-input" style={{ marginLeft: 'auto', width: 260 }}>
          <Icon name="search" size={14} />
          <input class="input" placeholder="Search public slop…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <div class="home-scroll">
        <div class="home-container">
          <div class="home-hero" style={{ minHeight: 130, background: 'radial-gradient(circle at 80% 30%, rgba(181,140,255,.22), transparent 45%), var(--bg-raised)' }}>
            <img class="hero-mascot" src="/static/assets/brand/mascot.svg" alt="" />
            <div class="grow">
              <h1 style={{ fontSize: 26 }}>Find your people. Regret it immediately.</h1>
              <p>Public servers listed by their owners. No algorithm, no promoted slop, no pay-to-win placement. Just vibes.</p>
            </div>
          </div>
          {error ? <div class="auth-error mb-16">{error}</div> : null}
          {loading ? <div class="empty"><span class="spinner" /><p>Scraping the barrel…</p></div> : filtered.length ? (
            <div class="discover-grid">
              {filtered.map((s) => {
                const member = !!state.servers[s.id];
                return <div class="server-card" key={s.id}>
                  <div class="sc-banner" style={s.bannerColor ? { background: s.bannerColor } : undefined} />
                  <div class="sc-body">
                    {s.icon ? <img class="sc-icon" src={s.icon} alt="" /> : <div class="sc-icon center" style={{ display: 'flex', fontSize: 22, fontWeight: 800, color: 'var(--accent-ink)', background: 'var(--accent)' }}>{s.name?.charAt(0)}</div>}
                    <div class="sc-name">{s.name}</div>
                    <div class="sc-desc">{s.description || 'No description. The mystery is the marketing.'}</div>
                    <div class="row gap-8 faint" style={{ fontSize: 11, marginBottom: 10 }}><Icon name="users" size={11} /> {s.memberCount ?? 0} members {s.onlineCount ? `· ${s.onlineCount} online` : ''}</div>
                    <button class={`btn btn-sm btn-block ${member ? '' : 'btn-primary'}`} disabled={joining === s.id} onClick={() => join(s)}>
                      {joining === s.id ? 'Joining…' : member ? 'Open server' : 'Enter the slop'}
                    </button>
                  </div>
                </div>;
              })}
            </div>
          ) : <EmptyState emoji="🌌" title="The void stares back">No public servers match that. Try something less niche, or make your own server public in server settings.</EmptyState>}
          <p class="faint text-center mt-24" style={{ fontSize: 11 }}>Discovery is opt-in per server. Private servers are never listed.</p>
        </div>
      </div>
    </main>
  );
}
