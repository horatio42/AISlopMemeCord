import { useEffect, useState } from 'preact/hooks';
import { api, errorMessage, HttpError } from '../lib/api';
import { store, useApp } from '../lib/use-store';
import { Icon } from '../components/Icons';
import { Spinner } from '../components/Ui';

export function InviteView() {
  const state = useApp();
  const code = state.view.inviteCode ?? '';
  const preview = state.ui.pendingInvite;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (code && !preview) void store.loadInvite(code);
  }, [code, preview]);

  const join = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.post<any>(`/api/invites/${code}`, {});
      if (res.alreadyMember && res.server) {
        await store.loadServer(res.server.id, { force: true });
      }
      store.updateUi({ pendingInvite: null });
      const serverId = res.server?.id;
      const channelId = res.channel?.id ?? store.state.servers[serverId]?.channels.find((c) => c.type === 'text')?.id;
      if (serverId && channelId) {
        await store.loadServer(serverId, { force: true });
        await store.openChannel(serverId, channelId);
        history.replaceState({}, '', `/channels/${serverId}/${channelId}`);
      } else {
        history.replaceState({}, '', '/');
        await store.applyRoute('/', false);
      }
    } catch (e) {
      setError(e instanceof HttpError ? e.message : errorMessage(e));
    } finally { setBusy(false); }
  };

  if (!preview) {
    return <div class="center col" style={{ height: '100dvh', gap: 16 }}>
      <img src="/static/assets/brand/mascot.svg" alt="" style={{ width: 88, height: 88, animation: 'float 3s ease-in-out infinite' }} />
      {error ? <div class="auth-error">{error}</div> : <><Spinner /><p class="muted mono">sniffing the invite…</p></>}
      <button class="btn btn-ghost" onClick={() => { history.pushState({}, '', '/'); void store.applyRoute('/', false); }}>Back to safety</button>
    </div>;
  }

  const server = preview.server;
  const already = state.servers[server?.id ?? ''];
  return (
    <div class="center col" style={{ minHeight: '100dvh', padding: 24, background: 'radial-gradient(circle at 50% 0%, rgba(184,255,53,.1), transparent 45%), var(--bg-void)' }}>
      <div class="card" style={{ width: 'min(520px, 100%)', padding: 0, overflow: 'hidden', animation: 'popIn .25s' }}>
        <div style={{ height: 130, background: 'linear-gradient(130deg, var(--purple), var(--pink) 45%, var(--accent-2))', position: 'relative' }}>
          <div class="meme" style={{ position: 'absolute', right: 16, bottom: 8, fontSize: 42, transform: 'rotate(-4deg)', color: 'rgba(20,8,30,.7)' }}>you got slopped</div>
        </div>
        <div style={{ padding: '0 26px 26px' }}>
          <div class="row gap-16" style={{ marginTop: -34, alignItems: 'flex-end' }}>
            {server.icon ? <img src={server.icon} alt="" style={{ width: 82, height: 82, borderRadius: 20, border: '4px solid var(--bg-raised)', objectFit: 'cover' }} /> : (
              <div class="avatar sq" style={{ width: 82, height: 82, fontSize: 32, border: '4px solid var(--bg-raised)', background: 'linear-gradient(135deg, var(--purple), var(--pink))' }}>{(server.name ?? '?').charAt(0)}</div>
            )}
            <div class="grow" style={{ paddingBottom: 6 }}>
              <h1 style={{ fontSize: 26, lineHeight: 1.1 }}>{server.name}</h1>
              <div class="muted" style={{ fontSize: 12.5 }}>{server.memberCount?.toLocaleString() ?? 0} members · {server.onlineCount ?? '?'} online · {preview.channel ? `#${preview.channel.name}` : 'the slop pit'}</div>
            </div>
          </div>
          <p class="muted mt-16" style={{ fontSize: 14 }}>{server.description || 'A server so mysterious even the admin does not know what happens here. Only one way to find out.'}</p>
          <div class="card flat mt-16" style={{ padding: 12, fontSize: 12.5 }}>
            <div class="row gap-8"><Icon name="users" size={14} /><span>Invited by <strong>{preview.inviter?.displayName ?? preview.invite?.creator?.displayName ?? 'some goblin'}</strong></span></div>
            <div class="row gap-8 mt-8"><Icon name="shield" size={14} /><span>You are logged in as <strong>{state.user?.displayName}</strong></span></div>
          </div>
          {error ? <div class="auth-error mt-16">{error}</div> : null}
          <button class="btn btn-primary btn-lg btn-block mt-16" onClick={join} disabled={busy}>
            {busy ? <><span class="spinner" style={{ width: 16, height: 16 }} /> Joining…</> : already ? 'Open server' : 'Accept invite & enter slop'}
          </button>
          <button class="btn btn-ghost btn-block mt-8" onClick={() => { history.pushState({}, '', '/'); void store.applyRoute('/', false); }}>No thanks, I have a life</button>
          <div class="faint text-center mt-16" style={{ fontSize: 10.5 }}>By joining you agree to absolutely nothing legally binding.</div>
        </div>
      </div>
      <img src="/static/assets/memes/this-is-slop.svg" alt="" style={{ width: 260, marginTop: 20, borderRadius: 8, opacity: .8, transform: 'rotate(-2deg)' }} />
    </div>
  );
}
