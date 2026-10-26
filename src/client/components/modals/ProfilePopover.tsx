import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { api, errorMessage } from '../../lib/api';
import { store, useApp } from '../../lib/use-store';
import { Icon } from '../Icons';
import { Avatar } from '../Avatar';
import { Spinner } from '../Ui';
import { fmtDate, fmtRelative } from '../../lib/format';

export function ProfilePopover() {
  const state = useApp();
  const profile = state.ui.profile;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.closeProfile(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const close = () => store.closeProfile();
  const act = async (fn: () => Promise<any>, message?: string) => {
    setBusy(true); setError('');
    try { await fn(); if (message) store.toast(message, 'success'); await store.showProfile(profile!.id); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const openDm = async () => {
    setBusy(true); setError('');
    try { const res: any = await api.post('/api/dms', { recipientIds: [profile!.id] }); store.mergeDm(res.channel); close(); await store.openChannel(null, res.channel.id); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const isSelf = profile?.id === state.user?.id;
  const friendStatus = profile?.friendStatus ?? 'none';
  const servers = (profile?.serverIds ?? []).map((id) => store.state.servers[id]).filter((s): s is NonNullable<typeof s> => !!s);
  return createPortal(
    <div class="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="profile-card" style={{ width: 'min(480px, 94vw)', maxHeight: '88vh', overflowY: 'auto', animation: 'popIn .2s' }}>
        {state.ui.profileLoading || !profile ? <div class="center col" style={{ padding: 60, gap: 12 }}><Spinner /><p class="muted mono">summoning profile…</p></div> : <>
          <div class="profile-banner" style={{ background: profile.bannerColor ? `linear-gradient(120deg, ${profile.bannerColor}, color-mix(in srgb, ${profile.bannerColor} 40%, var(--bg-void)))` : undefined, height: 100 }}>
            <button class="btn-icon" style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,.35)' }} onClick={close} aria-label="Close profile"><Icon name="close" size={18} /></button>
            <div class="profile-avatar"><Avatar user={profile} size={82} /></div>
          </div>
          <div class="profile-body" style={{ paddingTop: 46 }}>
            <div class="profile-name">{profile.displayName} {profile.isBot ? <span class="bot-tag">BOT</span> : null} {profile.isAdmin ? <span title="Instance admin" style={{ fontSize: 15 }}>🛠️</span> : null}</div>
            <div class="profile-handle">@{profile.username}{profile.pronouns ? ` · ${profile.pronouns}` : ''}</div>
            {profile.customStatus ? <div class="badge mt-8">{profile.customStatus}</div> : null}
            {profile.bio ? <div class="profile-bio">{profile.bio}</div> : null}
            <div class="profile-meta">
              <div class="meta-row"><span class="label">Member since</span><span>{fmtDate(profile.createdAt)}</span></div>
              <div class="meta-row"><span class="label">Slop Points</span><span class="text-accent mono">{profile.karma.toLocaleString()}</span></div>
              <div class="meta-row"><span class="label">Status</span><span style={{ textTransform: 'capitalize' }}>{profile.status}</span></div>
              {servers.length ? <div class="meta-row"><span class="label">Mutual servers</span><span class="row gap-4 wrap">{servers.slice(0, 6).map((s) => <span class="badge" key={s.server.id}>{s.server.name}</span>)}</span></div> : null}
            </div>
            {profile.achievements?.length ? <div class="mb-16"><div class="label mb-8">Achievements</div><div class="profile-achieves">{profile.achievements.slice(0, 8).map((a) => <span class="achievement" key={a.key} title={a.description}><span class="emoji">{a.emoji}</span>{a.name}</span>)}</div></div> : null}
            {error ? <div class="auth-error">{error}</div> : null}
            <div class="profile-actions">
              {isSelf ? <button class="btn btn-primary btn-sm" onClick={() => { close(); store.updateUi({ userSettingsOpen: true }); }}><Icon name="edit" size={14} /> Edit profile</button> : <>
                {friendStatus === 'friends' ? <button class="btn btn-primary btn-sm" onClick={openDm} disabled={busy}><Icon name="send" size={14} /> Message</button> : null}
                {friendStatus === 'pending_in' ? <button class="btn btn-primary btn-sm" onClick={() => act(async () => api.post(`/api/friends/${profile.id}/accept`), 'Friend accepted.')} disabled={busy}><Icon name="check" size={14} /> Accept request</button> : null}
                {friendStatus === 'none' || friendStatus === 'blocked_by' ? <button class="btn btn-sm" onClick={() => act(async () => api.post(`/api/friends/${profile.id}`), 'Friend request sent.')} disabled={busy}><Icon name="friends" size={14} /> Add friend</button> : null}
                {friendStatus === 'pending_out' ? <button class="btn btn-sm" disabled><Icon name="clock" size={14} /> Request sent</button> : null}
                {friendStatus === 'friends' ? <button class="btn btn-ghost btn-sm" onClick={() => act(async () => api.del(`/api/friends/${profile.id}`), 'Friend removed.')} disabled={busy}>Remove friend</button> : null}
                {friendStatus === 'blocked' ? <button class="btn btn-sm" onClick={() => act(async () => api.del(`/api/users/${profile.id}/block`), 'Unblocked.')} disabled={busy}>Unblock</button> : <button class="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => { if (confirm(`Block ${profile.displayName}? They cannot DM or friend you.`)) void act(async () => api.post(`/api/users/${profile.id}/block`), 'Blocked.'); }} disabled={busy}>Block</button>}
                {friendStatus !== 'friends' && friendStatus !== 'pending_in' && friendStatus !== 'blocked' ? <button class="btn btn-ghost btn-sm" onClick={openDm} disabled={busy}>Send DM</button> : null}
              </>}
              <button class="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(profile.id); store.toast('User ID copied', 'success'); } catch { /* ignore */ } }}><Icon name="copy" size={13} /> ID</button>
            </div>
            {profile.topMessages?.length ? <div class="mt-16"><div class="label mb-8">Top slop</div>{profile.topMessages.slice(0, 3).map((m) => <div class="card flat mb-4" key={m.id} style={{ padding: 8, fontSize: 12 }}><span class="faint">{m.serverName ?? 'DM'} {m.channelName ? `/ #${m.channelName}` : ''} · </span>{m.content.slice(0, 160)} <span class="badge accent" style={{ marginLeft: 4 }}>{m.score}</span></div>)}</div> : null}
            <div class="faint text-center mt-16" style={{ fontSize: 10 }}>Profile views are not tracked. Obviously.</div>
          </div>
        </>}
      </div>
    </div>, document.body,
  );
}
