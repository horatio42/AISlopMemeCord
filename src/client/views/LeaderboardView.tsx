import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icons';
import type { LeaderboardEntry } from '../lib/store-types';

export function LeaderboardView() {
  const state = useApp();
  const [range, setRange] = useState<'week' | 'month' | 'all'>('week');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api.get<{ entries: LeaderboardEntry[] }>(`/api/leaderboard?range=${range}&limit=50`)
      .then((r) => { if (!cancel) setEntries(r.entries ?? []); })
      .catch((e) => store.toast(errorMessage(e), 'error'))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [range]);
  const top = entries.slice(0, 3);
  return (
    <main class="home-main">
      <div class="page-head"><Icon name="award" size={22} class="text-accent" /><h1>Slop leaderboard</h1><span class="badge">the aristocracy of nonsense</span>
        <div class="segmented" style={{ marginLeft: 'auto' }}>
          {(['week', 'month', 'all'] as const).map((r) => <button key={r} class={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r === 'all' ? 'All time' : r === 'week' ? 'This week' : 'This month'}</button>)}
        </div>
      </div>
      <div class="home-scroll"><div class="home-container" style={{ maxWidth: 860 }}>
        <div class="home-hero" style={{ padding: 20 }}>
          <img class="hero-mascot" src="/static/assets/brand/mascot.svg" alt="" style={{ width: 80, height: 80 }} />
          <div class="grow"><h1 style={{ fontSize: 24 }}>Karma is fake. Slop Points are real.</h1><p>Points come from upvotes on your messages. Downvote responsibly. Or don’t. We are not your dad.</p></div>
        </div>
        {loading ? <div class="empty"><span class="spinner" /></div> : entries.length ? <>
          {top.length >= 3 ? <div class="discover-grid mb-16" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[top[1], top[0], top[2]].map((e, i) => e && (
              <div class="card text-center" key={e.user.id} style={{ transform: i === 1 ? 'translateY(-10px)' : undefined, borderColor: i === 1 ? 'var(--accent)' : undefined }}>
                <div style={{ fontSize: 30 }}>{i === 1 ? '👑' : i === 0 ? '🥈' : '🥉'}</div>
                <Avatar user={e.user} size={i === 1 ? 64 : 50} class="center" />
                <div style={{ marginTop: 8, fontWeight: 750 }}>{e.user.displayName}</div>
                <div class="text-accent" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800 }}>{e.karma.toLocaleString()}</div>
                <div class="faint" style={{ fontSize: 11 }}>Slop Points · {e.messageCount} messages</div>
              </div>
            ))}
          </div> : null}
          <div class="list-card">
            {entries.map((e) => (
              <div class="friend-row" key={e.user.id} style={{ background: e.user.id === state.user?.id ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : undefined }}>
                <div class="rank" style={{ width: 34, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, color: e.rank <= 3 ? 'var(--accent)' : 'var(--faint)' }}>#{e.rank}</div>
                <Avatar user={e.user} size={34} onClick={() => void store.showProfile(e.user.id)} />
                <div class="fr-info"><div class="fr-name">{e.user.displayName} {e.user.id === state.user?.id ? <span class="badge accent">you</span> : null}</div><div class="fr-status">{e.user.customStatus || `@${e.user.username}`}</div></div>
                <div class="text-accent mono" style={{ fontWeight: 700 }}>{e.karma.toLocaleString()} pts</div>
                <div class="faint" style={{ fontSize: 11, width: 80, textAlign: 'right' }}>{e.messageCount} msgs</div>
              </div>
            ))}
          </div>
        </> : <div class="empty"><div class="empty-emoji">📉</div><h3>No slop points yet</h3><p>Vote on messages. Give someone the dopamine hit they deserve.</p></div>}
      </div></div>
    </main>
  );
}
