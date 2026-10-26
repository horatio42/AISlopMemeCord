import { useApp } from '../../../lib/use-store';
import { Icon } from '../../Icons';

export function AboutTab() {
  const state = useApp();
  const i = state.instance;
  return <div>
    <h3>About the slop</h3>
    <p class="settings-desc">AISlopMemeCord is intentionally over-engineered garbage. It is also a fully functional, single-container chat platform. Both things can be true.</p>
    <div class="row gap-16 mb-16" style={{ alignItems: 'center' }}>
      <img src="/static/assets/brand/mascot.svg" alt="" style={{ width: 82, height: 82 }} />
      <div><div class="profile-name">AISlopMemeCord {i?.version}</div><div class="muted">Discord, Reddit and 4chan raised it. The documentation is proud of this.</div></div>
    </div>
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="label mb-8">The stack</div>
      <div class="row gap-8 wrap"><span class="badge">Bun</span><span class="badge">TypeScript</span><span class="badge">SQLite (WAL + FTS5)</span><span class="badge">Preact</span><span class="badge">WebRTC</span><span class="badge">One Docker container</span></div>
      <p class="muted mt-12" style={{ fontSize: 12.5 }}>Runtime dependencies: Bun, SQLite, Preact, fflate. No external CDN, fonts, images, analytics or SaaS. Fonts and memes are bundled; all user state lives under <span class="mono">/data</span>.</p>
    </div>
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="label mb-8">Privacy promises</div>
      {['No telemetry, ever', 'No external HTTP requests from the browser or server', 'No email or phone number required', 'Local Argon2id passwords, optional TOTP 2FA', 'Client-side E2EE for 1:1 DMs', 'One-click full data export and hard account deletion'].map((p) => <div class="row gap-8 mb-4" key={p}><Icon name="check" size={13} class="text-success" /><span style={{ fontSize: 12.5 }}>{p}</span></div>)}
    </div>
    <div class="card flat mb-16" style={{ padding: 16 }}>
      <div class="label mb-8">Built with AI slop</div>
      <p class="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>This project was vibe-coded by an AI agent and a human with poor impulse control. There are tests. There is a privacy model. There is a soundboard with a synthesized fart. We contain multitudes.</p>
      <div class="row gap-8 mt-12"><span class="badge accent">100% AI slop</span><span class="badge purple">tested</span><span class="badge">single container</span><span class="badge">MIT</span></div>
    </div>
    <div class="row gap-8 wrap">
      <span class="badge purple">MIT licensed · self-hosted</span>
      <a class="btn btn-sm" href="https://github.com/horatio42/AISlopMemeCord" target="_blank" rel="noopener noreferrer"><Icon name="link" size={13} /> GitHub</a>
      {state.user?.isAdmin ? <a class="btn btn-sm" href="/admin"><Icon name="admin" size={13} /> Slop Control</a> : null}
      <span class="faint" style={{ fontSize: 11, marginLeft: 'auto' }}>Instance: {i?.name} · {i?.userCount} users · {i?.messageCount} messages</span>
    </div>
    <div class="faint text-center mt-24" style={{ fontSize: 10.5 }}>No goblins were harmed in the making of this software. Several were mildly inconvenienced.</div>
  </div>;
}
