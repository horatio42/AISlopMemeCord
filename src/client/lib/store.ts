import { api, errorMessage, setCsrfToken, onUnauthorized } from './api';
import { gateway } from './gateway';
import { initialState, initialUi, type AppState, type ServerBundle, type View, type MenuItem, type Toast } from './store-types';
import { handleGateway } from './store-realtime';

type Listener = () => void;
let toastId = 1;

export class Store {
  state: AppState = initialState();
  version = 0;
  private listeners = new Set<Listener>();
  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  emit() { this.version++; for (const l of this.listeners) l(); }
  set(patch: Partial<AppState>) { this.state = { ...this.state, ...patch }; this.emit(); }
  mutate(fn: (s: AppState) => void) { fn(this.state); this.emit(); }
  updateUi(patch: Partial<AppState['ui']>) { this.state.ui = { ...this.state.ui, ...patch }; this.emit(); }
  updateVoice(patch: Partial<AppState['voice']>) { this.state.voice = { ...this.state.voice, ...patch }; this.emit(); }
  applyTheme(theme: AppState['theme']) {
    this.state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('slop-theme', theme);
    this.emit();
  }
  toast(message: string, kind: Toast['kind'] = 'info', emoji?: string) {
    const toast: Toast = { id: toastId++, message, kind, emoji };
    this.state.toasts = [...this.state.toasts, toast];
    this.emit();
    setTimeout(() => this.dismissToast(toast.id), kind === 'error' ? 6500 : 4200);
  }
  dismissToast(id: number) { this.state.toasts = this.state.toasts.filter((t) => t.id !== id); this.emit(); }
  openMenu(ev: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[], header?: string) {
    this.state.menu = { x: ev.clientX, y: ev.clientY, items, header };
    this.emit();
  }
  closeMenu() { if (this.state.menu) { this.state.menu = null; this.emit(); } }
  openLightbox(url: string, alt?: string) { this.updateUi({ lightbox: { url, alt } }); }
  closeLightbox() { this.updateUi({ lightbox: null }); }

  async init() {
    try {
      const [me, instance] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/instance').catch(() => null),
      ]);
      setCsrfToken(me.csrfToken);
      this.state.instance = me.instance ?? instance;
      this.state.user = me.user;
      if (me.user) {
        this.applyTheme(me.user.theme ?? this.state.theme);
        gateway.onStatus((status) => { this.state.gatewayStatus = status; this.emit(); });
        gateway.on((t, d) => handleGateway(this, t, d));
        gateway.connect();
        await this.loadWorkspace();
        await this.applyRoute(currentPath(), false);
      }
    } catch (e) {
      this.state.bootError = errorMessage(e);
    } finally {
      this.state.authReady = true;
      this.emit();
    }
    onUnauthorized(() => this.handleUnauthorized());
  }

  handleUnauthorized() {
    gateway.disconnect();
    this.state.user = null;
    this.state.authReady = true;
    this.state.loadingWorkspace = false;
    this.state.ui = initialUi();
    this.emit();
  }

  async loadWorkspace() {
    this.state.loadingWorkspace = true; this.emit();
    try {
      const [serversRes, dmsRes, friendsRes, notifRes] = await Promise.all([
        api.get<{ servers: any[] }>('/api/servers').catch(() => ({ servers: [] })),
        api.get<{ channels: any[] }>('/api/dms').catch(() => ({ channels: [] })),
        api.get<any>('/api/users/@me/friends').catch(() => ({ friends: [], incoming: [], outgoing: [], blocked: [] })),
        api.get<{ notifications: any[]; unreadCount: number }>('/api/notifications?limit=50').catch(() => ({ notifications: [], unreadCount: 0 })),
      ]);
      this.state.dms = (dmsRes.channels ?? []).map(normalizeDm);
      this.state.friends = {
        friends: friendsRes.friends ?? [], incoming: friendsRes.incoming ?? [], outgoing: friendsRes.outgoing ?? [], blocked: friendsRes.blocked ?? [],
      };
      this.state.notifications = notifRes.notifications ?? [];
      this.state.notificationUnread = notifRes.unreadCount ?? 0;
      const serverList = serversRes.servers ?? [];
      this.state.serverOrder = serverList.map((s: any) => s.id);
      for (const raw of serverList) {
        const full = raw.serverId ? raw : raw;
        this.state.servers[full.id] = this.state.servers[full.id] ?? {
          server: full, channels: full.channels ?? [], roles: full.roles ?? [], member: full.member ?? null,
          members: full.members ?? [], emojis: full.emojis ?? [], stickers: full.stickers ?? [], sounds: full.sounds ?? [],
        };
      }
      this.state.loadingWorkspace = false;
      this.emit();
    } catch (e) {
      this.state.loadingWorkspace = false;
      this.emit();
      this.toast(errorMessage(e), 'error');
    }
  }

  async loadServer(serverId: string, opts: { force?: boolean } = {}): Promise<ServerBundle | null> {
    const cached = this.state.servers[serverId];
    if (cached && cached.channels.length > 0 && !opts.force) return cached;
    try {
      const res = await api.get<ServerBundle>(`/api/servers/${serverId}`);
      const bundle: ServerBundle = {
        server: res.server,
        channels: res.channels ?? [],
        roles: res.roles ?? [],
        member: res.member ?? null,
        members: (res as any).members ?? cached?.members ?? [],
        emojis: (res as any).emojis ?? [],
        stickers: (res as any).stickers ?? [],
        sounds: (res as any).sounds ?? [],
      };
      this.state.servers[serverId] = bundle;
      if (!this.state.serverOrder.includes(serverId)) this.state.serverOrder.push(serverId);
      for (const ch of bundle.channels) {
        this.state.channels[ch.id] = ch;
        if (ch.unreadCount !== undefined) {
          this.state.unread[ch.id] = { count: ch.unreadCount ?? 0, mentions: ch.mentionCount ?? 0, lastReadId: ch.lastReadId ?? null };
        }
      }
      this.emit();
      if (!bundle.members.length) void this.loadMembers(serverId);
      return bundle;
    } catch (e) {
      this.toast(errorMessage(e), 'error');
      return null;
    }
  }

  async loadMembers(serverId: string): Promise<void> {
    try {
      const res = await api.get<{ members: any[] }>(`/api/servers/${serverId}/members?limit=500`);
      const bundle = this.state.servers[serverId];
      if (bundle) { bundle.members = res.members ?? []; this.state.servers[serverId] = { ...bundle }; this.emit(); }
    } catch { /* members list is optional */ }
  }

  activeServer(): ServerBundle | null {
    return this.state.activeServerId ? this.state.servers[this.state.activeServerId] ?? null : null;
  }
  activeChannel(): import('../../shared/types').Channel | null {
    return this.state.activeChannelId ? this.state.channels[this.state.activeChannelId] ?? null : null;
  }
  activeDm(): import('../../shared/types').DMChannel | null {
    return this.state.dms.find((d) => d.id === this.state.activeChannelId) ?? null;
  }
  channelById(id: string | null | undefined) { return id ? this.state.channels[id] ?? null : null; }
  cache(channelId: string) { return this.state.messages[channelId] ?? null; }

  private ensureCache(channelId: string) {
    if (!this.state.messages[channelId]) this.state.messages[channelId] = { messages: [], hasMore: true, loaded: false, loading: false, error: null };
    return this.state.messages[channelId]!;
  }

  async loadMessages(channelId: string, opts: { before?: string; force?: boolean } = {}) {
    const cache = this.ensureCache(channelId);
    if (cache.loading) return;
    if (cache.loaded && !opts.force && !opts.before) return;
    cache.loading = true; cache.error = null; this.emit();
    try {
      const q = opts.before ? `?before=${encodeURIComponent(opts.before)}&limit=50` : '?limit=50';
      const res = await api.get<{ messages: any[]; hasMore: boolean }>(`/api/channels/${channelId}/messages${q}`);
      const incoming: any[] = res.messages ?? [];
      const merged = opts.before ? [...incoming, ...cache.messages] : incoming;
      const seen = new Set<string>();
      cache.messages = merged.filter((m) => { if (!m?.id || seen.has(m.id)) return false; seen.add(m.id); return true; });
      cache.messages.sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
      cache.hasMore = !!res.hasMore;
      cache.loaded = true;
      this.emit();
    } catch (e) {
      cache.error = errorMessage(e);
      this.emit();
    } finally { cache.loading = false; this.emit(); }
  }

  async loadMoreMessages(channelId: string) {
    const cache = this.state.messages[channelId];
    if (!cache || !cache.hasMore || cache.loading || !cache.messages.length) return;
    await this.loadMessages(channelId, { before: cache.messages[0]!.id });
  }

  async openChannel(serverId: string | null, channelId: string, opts: { push?: boolean } = {}) {
    if (serverId) await this.loadServer(serverId);
    this.state.activeServerId = serverId;
    this.state.activeChannelId = channelId;
    const existing = this.state.channels[channelId];
    if (existing) this.state.channels[channelId] = existing;
    if (this.state.dms.find((d) => d.id === channelId) && !existing) {
      try { const res = await api.get<{ channel: any }>(`/api/dms/${channelId}`); if (res.channel) this.mergeDm(res.channel); } catch { /* noop */ }
    }
    this.state.view = { type: serverId ? 'channel' : 'dm', serverId: serverId ?? undefined, channelId };
    this.state.ui = { ...this.state.ui, rightPanel: null, mobileSidebar: false, mobileRail: false, searchOpen: false, quickSwitcherOpen: false };
    this.emit();
    if (opts.push !== false) this.navigate(serverId ? `/channels/${serverId}/${channelId}` : `/channels/@me/${channelId}`);
    void this.loadMessages(channelId);
    void this.markRead(channelId);
    if (serverId) void this.loadMembers(serverId);
  }

  mergeDm(channel: any) {
    const dm = normalizeDm(channel);
    const idx = this.state.dms.findIndex((d) => d.id === dm.id);
    if (idx >= 0) this.state.dms[idx] = dm; else this.state.dms = [dm, ...this.state.dms];
    this.state.channels[dm.id] = dm as unknown as import('../../shared/types').Channel;
    this.emit();
  }

  async markRead(channelId: string, messageId?: string) {
    const channel = this.state.channels[channelId];
    if (!messageId && channel && (channel.type === 'forum' || channel.type === 'voice' || channel.type === 'category')) return;
    const c = this.state.messages[channelId];
    const last = messageId ?? c?.messages[c.messages.length - 1]?.id ?? channel?.lastMessageId;
    if (!last) return;
    const prev = this.state.unread[channelId];
    this.state.unread[channelId] = { count: 0, mentions: 0, lastReadId: last };
    this.state.dms = this.state.dms.map((d) => d.id === channelId ? { ...d, unreadCount: 0, mentionCount: 0, lastReadId: last } : d);
    this.emit();
    try { await api.post(`/api/channels/${channelId}/read`, { messageId: last }); } catch { /* offline */ }
  }

  navigate(path: string, replace = false) {
    if (location.pathname + location.search === path && !replace) return;
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }

  async applyRoute(path: string, push = false) {
    const route = parseRoute(path);
    if (route.type === 'channel') {
      if (this.state.activeChannelId !== route.channelId) await this.openChannel(route.serverId!, route.channelId!, { push });
      else { this.state.view = route; this.emit(); }
    } else if (route.type === 'dm') {
      if (this.state.activeChannelId !== route.channelId) await this.openChannel(null, route.channelId!, { push });
      else { this.state.view = route; this.emit(); }
    } else if (route.type === 'invite') {
      this.state.view = route;
      this.state.ui.pendingInvite = this.state.ui.pendingInvite;
      this.emit();
      void this.loadInvite(route.inviteCode!);
    } else {
      this.state.activeServerId = null;
      this.state.activeChannelId = null;
      this.state.view = route;
      this.state.ui = { ...this.state.ui, rightPanel: null, mobileSidebar: false, mobileRail: false };
      this.emit();
      if (push) this.navigate(routePath(route));
    }
    if (route.type === 'friends') void this.refreshFriends();
    if (route.type === 'leaderboard') void this.loadLeaderboard();
  }

  async refreshFriends() {
    try {
      const res = await api.get<any>('/api/users/@me/friends');
      this.state.friends = { friends: res.friends ?? [], incoming: res.incoming ?? [], outgoing: res.outgoing ?? [], blocked: res.blocked ?? [] };
      this.emit();
    } catch { /* noop */ }
  }

  async loadInvite(code: string) {
    try {
      const res = await api.get<any>(`/api/invites/${code}`);
      this.state.ui.pendingInvite = res;
      this.emit();
    } catch (e) {
      this.toast(errorMessage(e), 'error');
    }
  }

  async loadLeaderboard() {
    try {
      const res = await api.get<{ entries: any[] }>('/api/leaderboard?limit=25');
      this.state.leaderboard = res.entries ?? [];
      this.emit();
    } catch { /* noop */ }
  }

  async showProfile(userId: string) {
    this.updateUi({ profileLoading: true, profile: null });
    try {
      const res = await api.get<{ profile: any }>(`/api/users/${userId}`);
      this.updateUi({ profile: decorateProfile(res.profile), profileLoading: false });
    } catch (e) {
      this.toast(errorMessage(e), 'error');
      this.updateUi({ profileLoading: false });
    }
  }

  closeProfile() { this.updateUi({ profile: null, profileLoading: false }); }
}

function normalizeDm(channel: any): any {
  if (!channel) return channel;
  return {
    ...channel,
    name: channel.name || (channel.type === 'dm' ? channel.members?.find((m: any) => m.id !== channel.meId)?.displayName : '') || 'Direct Slop',
    members: channel.members ?? [],
    unreadCount: channel.unreadCount ?? 0,
    mentionCount: channel.mentionCount ?? 0,
  };
}
function decorateProfile(profile: any): any {
  if (!profile) return profile;
  return { ...profile };
}
export function parseRoute(path: string): View {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'channels' && parts[1] === '@me' && parts[2]) return { type: 'dm', channelId: parts[2] };
  if (parts[0] === 'channels' && parts[1] && parts[2]) return { type: 'channel', serverId: parts[1], channelId: parts[2] };
  if (parts[0] === 'friends') return { type: 'friends' };
  if (parts[0] === 'discover') return { type: 'discover' };
  if (parts[0] === 'saved') return { type: 'saved' };
  if (parts[0] === 'leaderboard') return { type: 'leaderboard' };
  if (parts[0] === 'achievements') return { type: 'achievements' };
  if (parts[0] === 'invite' && parts[1]) return { type: 'invite', inviteCode: parts[1] };
  return { type: 'home' };
}
export function routePath(view: View): string {
  if (view.type === 'channel') return `/channels/${view.serverId}/${view.channelId}`;
  if (view.type === 'dm') return `/channels/@me/${view.channelId}`;
  if (view.type === 'invite') return `/invite/${view.inviteCode}`;
  return `/${view.type === 'home' ? '' : view.type}`;
}
export function currentPath() { return location.pathname + location.search; }
export const store = new Store();

