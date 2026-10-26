import { useMemo } from 'preact/hooks';
import { useApp, store } from '../lib/use-store';
import { Avatar } from './Avatar';
import { Icon } from './Icons';
import { api, errorMessage } from '../lib/api';
import { can, canManageMember } from '../lib/permissions';
import { Perm } from '../../shared/permissions';
import type { ServerMember } from '../../shared/types';

export function MemberSidebar({ serverId, onClose }: { serverId: string; onClose?: () => void }) {
  const state = useApp();
  const bundle = state.servers[serverId];
  const groups = useMemo(() => {
    if (!bundle) return [] as { name: string; color?: string; members: ServerMember[]; offline?: boolean }[];
    const members = bundle.members.length ? bundle.members : bundle.member ? [bundle.member] : [];
    const online = members.filter((m) => m.user.status !== 'offline');
    const offline = members.filter((m) => m.user.status === 'offline');
    const hoisted = bundle.roles.filter((r) => r.hoist).sort((a, b) => b.position - a.position);
    const out: { name: string; color?: string; members: ServerMember[]; offline?: boolean }[] = [];
    const claimed = new Set<string>();
    for (const role of hoisted) {
      const list = online.filter((m) => m.roles.includes(role.id));
      if (list.length) { out.push({ name: role.name, color: role.color, members: list }); list.forEach((m) => claimed.add(m.user.id)); }
    }
    const rest = online.filter((m) => !claimed.has(m.user.id));
    if (rest.length) out.push({ name: 'Members', members: rest });
    if (offline.length) out.push({ name: 'Offline', members: offline, offline: true });
    return out;
  }, [bundle]);

  if (!bundle) return null;
  const total = bundle.members.length || bundle.server.memberCount;
  const canMod = can(state, Perm.MANAGE_MESSAGES, serverId) || can(state, Perm.KICK_MEMBERS, serverId);

  const memberMenu = (e: MouseEvent, m: ServerMember) => {
    const items: any[] = [
      { label: 'View profile', icon: 'user', action: () => void store.showProfile(m.user.id) },
      { label: 'Send DM', icon: 'send', action: async () => {
        try { const res: any = await api.post('/api/dms', { recipientIds: [m.user.id] }); store.mergeDm(res.channel); await store.openChannel(null, res.channel.id); }
        catch (err) { store.toast(errorMessage(err), 'error'); }
      } },
      { label: 'Copy user ID', icon: 'copy', action: async () => { try { await navigator.clipboard.writeText(m.user.id); store.toast('User ID copied', 'success'); } catch { /* ignore */ } } },
    ];
    if (canManageMember(state, serverId, m) && m.user.id !== state.user?.id) {
      items.push({ separator: true, label: '' });
      if (canMod) items.push({
        label: 'Timeout', icon: 'clock' as any, action: () => store.openMenu({ clientX: e.clientX + 100, clientY: e.clientY }, [
          { label: 'Timeout 1 minute', action: () => void timeout(m, 60_000) },
          { label: 'Timeout 10 minutes', action: () => void timeout(m, 600_000) },
          { label: 'Timeout 1 hour', action: () => void timeout(m, 3_600_000) },
          { label: 'Timeout 1 day', action: () => void timeout(m, 86_400_000) },
          { label: 'Remove timeout', action: () => void timeout(m, 0) },
        ], `Timeout ${m.user.displayName}`),
      });
      if (can(state, Perm.MANAGE_ROLES, serverId)) items.push({ label: 'Manage roles', icon: 'shield', action: () => store.openMenu({ clientX: e.clientX + 100, clientY: e.clientY }, [
        { label: 'Open role manager', icon: 'settings', action: () => {
          const event = new CustomEvent('slop:server-settings', { detail: { tab: `members:${m.user.id}` } });
          window.dispatchEvent(event);
        } },
      ]) });
      if (can(state, Perm.KICK_MEMBERS, serverId)) items.push({ label: 'Kick member', icon: 'logout', danger: true, action: () => void kick(m) });
      if (can(state, Perm.BAN_MEMBERS, serverId)) items.push({ label: 'Ban member', icon: 'ban', danger: true, action: () => void ban(m) });
    }
    store.openMenu(e, items, `${m.user.displayName}${m.nickname ? ` (${m.user.username})` : ''}`);
  };
  const timeout = async (m: ServerMember, ms: number) => {
    try {
      await api.patch(`/api/servers/${serverId}/members/${m.user.id}`, { timeoutUntil: ms ? Date.now() + ms : null });
      store.toast(ms ? `${m.user.displayName} timed out. Touch grass.` : 'Timeout lifted.', 'success');
      await store.loadMembers(serverId);
    } catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const kick = async (m: ServerMember) => {
    const reason = prompt(`Reason for kicking ${m.user.displayName}?`, 'Too much slop');
    if (reason === null) return;
    try { await api.del(`/api/servers/${serverId}/members/${m.user.id}`, { reason }); store.toast('Kicked. Door hit them on the way out.', 'success'); await store.loadMembers(serverId); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };
  const ban = async (m: ServerMember) => {
    const reason = prompt(`Reason for banning ${m.user.displayName}?`, 'Went too far');
    if (reason === null) return;
    try { await api.post(`/api/servers/${serverId}/bans/${m.user.id}`, { reason }); store.toast('Banished. The pit is safer.', 'success'); await store.loadMembers(serverId); }
    catch (e) { store.toast(errorMessage(e), 'error'); }
  };

  return (
    <aside class="member-sidebar" aria-label="Members">
      <div class="row-between" style={{ padding: '4px 8px 12px' }}>
        <span class="section-title">Members — {total}</span>
        <button class="btn-icon sm" title="Hide member list" onClick={() => onClose ? onClose() : store.updateUi({ membersOpen: false })}><Icon name="users" size={14} /></button>
      </div>
      {groups.map((g) => <div class="member-group" key={g.name}>
        <div class="member-group-head" style={g.color && g.color !== '#99aab5' ? { color: g.color } : undefined}>{g.name} — {g.members.length}</div>
        {g.members.map((m) => (
          <div class={`member-item ${g.offline ? 'offline' : ''}`} key={m.user.id} onClick={() => void store.showProfile(m.user.id)} onContextMenu={(e) => { e.preventDefault(); memberMenu(e, m); }}>
            <Avatar user={m.user} size={30} status={!g.offline} />
            <div class="grow" style={{ minWidth: 0 }}>
              <div class="mi-name" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span class="truncate" style={m.roles.length ? { color: (bundle.roles.filter((r) => m.roles.includes(r.id) && r.color !== '#99aab5').sort((a, b) => b.position - a.position)[0]?.color) || undefined } : undefined}>{m.nickname || m.user.displayName}</span>
                {m.user.isBot ? <span class="bot-tag">BOT</span> : null}
                {bundle.server.ownerId === m.user.id ? <span title="Server owner">👑</span> : null}
              </div>
              {m.user.customStatus ? <div class="mi-sub truncate">{m.user.customStatus}</div> : null}
              {m.timeoutUntil && m.timeoutUntil > Date.now() ? <div class="mi-sub text-warning">timed out</div> : null}
            </div>
          </div>
        ))}
      </div>)}
      {!bundle.members.length ? <div class="empty" style={{ padding: 20 }}><span class="spinner" /><p style={{ fontSize: 11 }}>summoning members…</p></div> : null}
    </aside>
  );
}
