import { Perm, has, DEFAULT_EVERYONE } from '../../shared/permissions';
import type { AppState, ServerBundle } from './store-types';
import type { Channel, ServerMember } from '../../shared/types';

export function basePermissions(state: AppState, serverId: string): number {
  const bundle = state.servers[serverId];
  const me = state.user;
  if (!bundle || !me) return 0;
  if (me.isAdmin) return 0x7fffffff;
  if (bundle.server.ownerId === me.id) return 0x7fffffff;
  const member = bundle.member ?? bundle.members.find((m) => m.user.id === me.id);
  if (!member) return 0;
  const everyone = bundle.roles.find((r) => r.isDefault);
  let perms = everyone?.permissions ?? DEFAULT_EVERYONE;
  for (const role of bundle.roles) {
    if (!role.isDefault && member.roles.includes(role.id)) perms |= role.permissions;
  }
  return perms;
}

export function channelPermissions(state: AppState, channel: Channel): number {
  if (channel.type === 'dm' || channel.type === 'group_dm') return 0x7fffffff;
  if (!channel.serverId) return 0;
  const bundle = state.servers[channel.serverId];
  const me = state.user;
  if (!bundle || !me) return 0;
  let perms = basePermissions(state, channel.serverId);
  if (has(perms, Perm.ADMINISTRATOR)) return perms;
  const member = bundle.member ?? bundle.members.find((m) => m.user.id === me.id);
  const everyone = bundle.roles.find((r) => r.isDefault);
  const roleIds = member?.roles ?? [];
  const chain: Channel[] = [];
  let cur: Channel | null = channel;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? state.channels[cur.parentId] ?? bundle.channels.find((c) => c.id === cur!.parentId) ?? null : null;
  }
  for (const ch of chain.reverse()) {
    const overrides = channel.overrides ?? [];
    const everyoneOw = overrides.find((o) => o.targetType === 'role' && o.targetId === everyone?.id);
    if (everyoneOw) perms = (perms & ~everyoneOw.deny) | everyoneOw.allow;
    let deny = 0, allow = 0;
    for (const o of overrides) if (o.targetType === 'role' && o.targetId !== everyone?.id && roleIds.includes(o.targetId)) { deny |= o.deny; allow |= o.allow; }
    perms = (perms & ~deny) | allow;
    const userOw = overrides.find((o) => o.targetType === 'user' && o.targetId === me.id);
    if (userOw) perms = (perms & ~userOw.deny) | userOw.allow;
  }
  return perms;
}

export function can(state: AppState, permission: number, serverId: string | null | undefined): boolean {
  if (!serverId) return true;
  const perms = basePermissions(state, serverId);
  return has(perms, Perm.ADMINISTRATOR) || has(perms, permission);
}
export function canChannel(state: AppState, channel: Channel | null | undefined, permission: number): boolean {
  if (!channel) return false;
  const perms = channelPermissions(state, channel);
  return has(perms, Perm.ADMINISTRATOR) || has(perms, permission);
}
export function isOwner(state: AppState, serverId: string): boolean {
  return state.servers[serverId]?.server.ownerId === state.user?.id || !!state.user?.isAdmin;
}
export function memberTopPosition(state: AppState, serverId: string): number {
  const bundle = state.servers[serverId];
  if (!bundle || !state.user) return 0;
  if (bundle.server.ownerId === state.user.id) return 999;
  const member = bundle.member ?? bundle.members.find((m) => m.user.id === state.user!.id);
  if (!member) return 0;
  return Math.max(0, ...bundle.roles.filter((r) => member.roles.includes(r.id)).map((r) => r.position));
}
export function canManageMember(state: AppState, serverId: string, target: ServerMember): boolean {
  if (!state.user) return false;
  if (state.user.isAdmin) return true;
  const bundle = state.servers[serverId];
  if (!bundle) return false;
  if (bundle.server.ownerId === target.user.id) return false;
  if (bundle.server.ownerId === state.user.id) return true;
  const top = memberTopPosition(state, serverId);
  const targetTop = Math.max(0, ...bundle.roles.filter((r) => target.roles.includes(r.id)).map((r) => r.position));
  return top > targetTop;
}
export function serverTraits(bundle: ServerBundle): string[] {
  return bundle.server.traits ?? [];
}
