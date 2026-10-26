import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { ACHIEVEMENTS } from '../../shared/memes';
import { fmtDate } from '../lib/format';

export function AchievementsView() {
  const state = useApp();
  const [data, setData] = useState<any>({ achievements: ACHIEVEMENTS, leaderboard: [], mine: [] });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get<any>('/api/achievements').then((r) => setData({ achievements: r.achievements ?? ACHIEVEMENTS, leaderboard: r.leaderboard ?? [], mine: r.mine ?? [] }))
      .catch((e) => store.toast(errorMessage(e), 'error')).finally(() => setLoading(false));
  }, []);
  const earned = new Map((data.mine ?? []).map((a: any) => [a.key, a.earnedAt]));
  const defs = data.achievements?.length ? data.achievements : ACHIEVEMENTS;
  return (
    <main class="home-main">
      <div class="page-head"><Icon name="star" size={22} class="text-warning" /><h1>Achievements</h1><span class="badge">imaginary trophies</span></div>
      <div class="home-scroll"><div class="home-container" style={{ maxWidth: 1000 }}>
        <div class="home-hero"><img class="hero-mascot" src="/static/assets/memes/ceo-slop.svg" alt="" style={{ width: 120, animation: 'none', borderRadius: 8 }} /><div class="grow"><h1 style={{ fontSize: 24 }}>You have {earned.size} / {defs.length} imaginary trophies.</h1><p>They mean nothing. They also mean everything. The council is watching.</p><div class="progress" style={{ height: 10, background: 'var(--bg-void)', borderRadius: 99, overflow: 'hidden', marginTop: 12, maxWidth: 400 }}><div style={{ width: `${(earned.size / Math.max(1, defs.length)) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--purple))' }} /></div></div></div>
        {loading ? <div class="empty"><span class="spinner" /></div> : <div class="discover-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {defs.map((a: any) => {
            const got = earned.has(a.key);
            return <div class="card" key={a.key} style={{ opacity: got ? 1 : .55, borderColor: got ? 'color-mix(in srgb, var(--accent) 40%, var(--border))' : undefined }}>
              <div class="row gap-12"><div style={{ fontSize: 34, filter: got ? 'none' : 'grayscale(1)' }}>{a.emoji}</div><div class="grow"><div style={{ fontWeight: 750, fontFamily: 'var(--font-display)' }}>{a.name}</div><div class="faint" style={{ fontSize: 11 }}>{got ? `Earned ${fmtDate(earned.get(a.key) as number)}` : 'Locked'}</div></div>{got ? <Icon name="check" size={18} class="text-success" /> : <Icon name="lock" size={15} class="faint" />}</div>
              <p class="muted mt-8" style={{ fontSize: 12.5 }}>{a.description}</p>
            </div>;
          })}
        </div>}
        {data.leaderboard?.length ? <div class="panel mt-24"><div class="panel-head"><h3><Icon name="crown" size={16} /> Trophy hoarders</h3></div><div class="panel-body" style={{ padding: 0 }}>{data.leaderboard.slice(0, 10).map((row: any, i: number) => <div class="friend-row" key={row.user?.id ?? i}><span class="rank" style={{ width: 26, color: i < 3 ? 'var(--accent)' : 'var(--faint)', fontWeight: 800 }}>#{i + 1}</span>{row.user ? <><img src={row.user.avatar ?? '/static/assets/avatars/avatar-2.svg'} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} /><div class="fr-info"><div class="fr-name" style={{ fontSize: 13 }}>{row.user.displayName}</div></div></> : null}<span class="badge accent">{row.count ?? row.achievementCount ?? 0} trophies</span></div>)}</div></div> : null}
        <p class="faint text-center mt-24" style={{ fontSize: 11 }}>Achievements are stored locally in your profile. No external gaming service. No NFTs. Please stop asking.</p>
      </div></div>
    </main>
  );
}
