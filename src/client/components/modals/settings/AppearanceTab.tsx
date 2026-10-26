import { useState } from 'preact/hooks';
import { api, errorMessage } from '../../../lib/api';
import { store, useApp } from '../../../lib/use-store';
import { Toggle } from '../../Ui';
import { Icon } from '../../Icons';
import type { ThemeName } from '../../../../shared/types';

const THEMES: { id: ThemeName; name: string; desc: string; colors: string[] }[] = [
  { id: 'slop', name: 'Slop Dark', desc: 'The default. Neon lime, questionable decisions.', colors: ['#0d0914', '#1d1429', '#b8ff35'] },
  { id: 'corporate', name: 'Corporate Slop', desc: 'For when HR is watching. Still unhinged inside.', colors: ['#0c1320', '#1b2738', '#4f8cff'] },
  { id: 'deepfried', name: 'Deep Fried', desc: 'Maximum saturation. Retinas will be harmed.', colors: ['#130000', '#2c0800', '#ffe600'] },
  { id: 'terminal', name: 'Terminal', desc: 'Green on black. You are hacking the mainframe.', colors: ['#000000', '#04140a', '#38ff7a'] },
  { id: 'light', name: 'Slop Lite', desc: 'Bright mode for the mentally stable (allegedly).', colors: ['#ece7f8', '#fbf9ff', '#6b21d8'] },
];

export function AppearanceTab() {
  const state = useApp();
  const [compact, setCompact] = useState(localStorage.getItem('slop-compact') === '1');
  const [largeText, setLargeText] = useState(localStorage.getItem('slop-large-text') === '1');
  const [reduceMotion, setReduceMotion] = useState(localStorage.getItem('slop-reduce-motion') === '1');
  const [favicon, setFavicon] = useState(localStorage.getItem('slop-favicon') !== '0');
  const apply = (fn: () => void) => { fn(); store.emit(); };
  const setTheme = async (theme: ThemeName) => {
    store.applyTheme(theme);
    try { await api.patch('/api/users/@me', { theme }); } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const toggleCompact = (v: boolean) => {
    setCompact(v); localStorage.setItem('slop-compact', v ? '1' : '0');
    document.documentElement.classList.toggle('compact-messages', v);
  };
  const toggleLarge = (v: boolean) => {
    setLargeText(v); localStorage.setItem('slop-large-text', v ? '1' : '0');
    document.documentElement.classList.toggle('large-text', v);
  };
  const toggleMotion = (v: boolean) => {
    setReduceMotion(v); localStorage.setItem('slop-reduce-motion', v ? '1' : '0');
    document.documentElement.classList.toggle('reduced-motion', v);
  };
  return <div>
    <h3>Appearance</h3>
    <p class="settings-desc">Make the slop feel like home. All themes are local CSS; no external fonts or tracking pixels.</p>
    <div class="label mb-8">Theme</div>
    <div class="discover-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', marginBottom: 24 }}>
      {THEMES.map((t) => <button key={t.id} class="card" style={{ textAlign: 'left', padding: 12, borderColor: state.theme === t.id ? 'var(--accent)' : undefined, background: 'var(--bg-raised)' }} onClick={() => void setTheme(t.id)}>
        <div class="row gap-4 mb-8">{t.colors.map((c, i) => <span key={i} style={{ width: i === 2 ? 24 : 18, height: 24, borderRadius: 4, background: c, border: '1px solid rgba(255,255,255,.12)' }} />)}</div>
        <div class="row gap-8"><strong style={{ fontSize: 13.5 }}>{t.name}</strong>{state.theme === t.id ? <span class="badge accent" style={{ fontSize: 9 }}>active</span> : null}</div>
        <div class="faint" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.35 }}>{t.desc}</div>
      </button>)}
    </div>
    <div class="card flat" style={{ padding: 16 }}>
      <div class="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}><div><div style={{ fontWeight: 650 }}>Compact message mode</div><div class="faint" style={{ fontSize: 11 }}>Denser chat. Avatars hide on grouped messages.</div></div><Toggle checked={compact} onChange={toggleCompact} /></div>
      <div class="row-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border-soft)' }}><div><div style={{ fontWeight: 650 }}>Large text</div><div class="faint" style={{ fontSize: 11 }}>Bumps the base font size for readability.</div></div><Toggle checked={largeText} onChange={toggleLarge} /></div>
      <div class="row-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border-soft)' }}><div><div style={{ fontWeight: 650 }}>Reduce motion</div><div class="faint" style={{ fontSize: 11 }}>Disables wobbles, floats and most animations.</div></div><Toggle checked={reduceMotion} onChange={toggleMotion} /></div>
      <div class="row-between" style={{ padding: '12px 0' }}><div><div style={{ fontWeight: 650 }}>Show the goblin favicon</div><div class="faint" style={{ fontSize: 11 }}>If you hate joy, disable it.</div></div><Toggle checked={favicon} onChange={(v) => { setFavicon(v); localStorage.setItem('slop-favicon', v ? '1' : '0'); const link = document.querySelector('link[rel=icon]') as HTMLLinkElement; if (link) link.href = v ? '/static/assets/brand/favicon.svg' : '/static/assets/brand/logo.svg'; }} /></div>
    </div>
    <div class="card-sticker mt-24" style={{ display: 'flex', gap: 14, alignItems: 'center', maxWidth: 430 }}>
      <Icon name="sparkles" size={28} class="text-accent" />
      <div><strong>Style tip</strong><p class="muted" style={{ fontSize: 12 }}>Deep Fried + Bangers font is the intended viewing experience. We will not be taking questions.</p></div>
    </div>
  </div>;
}
