import type { AppState, ServerBundle } from './store-types';
import type { Message, User } from '../../shared/types';

type StoreLike = { state: AppState; emit(): void; markRead(id: string, messageId?: string): Promise<void>; loadServer(id: string, opts?: { force?: boolean }): Promise<ServerBundle | null>; loadMembers(id: string): Promise<void>; refreshFriends(): Promise<void>; loadWorkspace(): Promise<void>; toast(msg: string, kind?: 'info'|'success'|'error'): void; applyTheme(t: any): void };

export function patchUserEverywhere(store: StoreLike, user: Partial<User> & { id: string }) {
  const s = store.state;
  const merge = (u: User) => u.id === user.id ? { ...u, ...user } : u;
  if (s.user?.id === user.id) s.user = { ...s.user, ...user } as User;
  for (const bundle of Object.values(s.servers)) {
    let changed = false;
    bundle.members = bundle.members.map((m) => { if (m.user.id === user.id) { changed = true; return { ...m, user: merge(m.user) }; } return m; });
    if (bundle.member?.user.id === user.id) { bundle.member = { ...bundle.member, user: merge(bundle.member.user) }; changed = true; }
    if (changed) bundle.server = { ...bundle.server };
  }
  s.dms = s.dms.map((dm) => ({ ...dm, members: dm.members.map(merge) }));
  s.friends = {
    friends: s.friends.friends.map((f) => ({ ...f, user: merge(f.user) })),
    incoming: s.friends.incoming.map((f) => ({ ...f, user: merge(f.user) })),
    outgoing: s.friends.outgoing.map((f) => ({ ...f, user: merge(f.user) })),
    blocked: s.friends.blocked.map((f) => ({ ...f, user: merge(f.user) })),
  };
  s.notifications = s.notifications.map((n) => n.actor ? { ...n, actor: merge(n.actor) } : n);
  if (s.ui.profile?.id === user.id) s.ui.profile = { ...s.ui.profile, ...user };
}

function upsertMessage(store: StoreLike, msg: Message) {
  const s = store.state;
  const cache = s.messages[msg.channelId];
  if (cache) {
    const idx = cache.messages.findIndex((m) => m.id === msg.id);
    if (idx >= 0) cache.messages[idx] = msg;
    else {
      cache.messages.push(msg);
      cache.messages.sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
    }
  }
  const ch = s.channels[msg.channelId];
  if (ch && (!ch.lastMessageId || msg.id > ch.lastMessageId)) s.channels[msg.channelId] = { ...ch, lastMessageId: msg.id };
  const dm = s.dms.find((d) => d.id === msg.channelId);
  if (dm) {
    s.dms = s.dms.map((d) => d.id === msg.channelId ? { ...d, lastMessageId: msg.id } : d);
  }
}

function activity(store: StoreLike, channelId: string, message: Message) {
  const s = store.state;
  if (s.activeChannelId === channelId && document.hasFocus()) {
    setTimeout(() => { void store.markRead(channelId, message.id); }, 120);
    return;
  }
  const u = s.unread[channelId] ?? { count: 0, mentions: 0, lastReadId: null };
  const mentioned = message.mentions?.users?.includes(s.user?.id ?? '') || message.mentions?.everyone || (message.replyTo && message.replyTo.authorName === s.user?.displayName);
  s.unread[channelId] = { count: u.count + 1, mentions: u.mentions + (mentioned ? 1 : 0), lastReadId: u.lastReadId };
  const dm = s.dms.find((d) => d.id === channelId);
  if (dm) s.dms = s.dms.map((d) => d.id === channelId ? { ...d, unreadCount: (d.unreadCount ?? 0) + 1, mentionCount: (d.mentionCount ?? 0) + (mentioned ? 1 : 0), lastMessage: message } : d);
  if (mentioned && message.author.id !== s.user?.id) {
    store.toast(`${message.author.displayName} mentioned you: ${message.content.slice(0, 100)}`, 'info');
    try {
      if (Notification.permission === 'granted' && !document.hasFocus()) {
        new Notification(`Slop mention from ${message.author.displayName}`, { body: message.content.slice(0, 180), icon: message.author.avatar ?? undefined });
      }
    } catch { /* ignore */ }
  }
}

export function handleGateway(store: StoreLike, t: string, d: any) {
  const s = store.state;
  switch (t) {
    case 'READY':
      if (d?.user?.id && s.user?.id === d.user.id) {
        s.user = { ...s.user, ...d.user };
        patchUserEverywhere(store, d.user);
      }
      if (d?.instance) s.instance = { ...(s.instance ?? {} as any), ...d.instance };
      if (d?.unread) {
        for (const [channelId, value] of Object.entries<any>(d.unread)) s.unread[channelId] = value;
      }
      store.emit();
      break;
    case 'MESSAGE_CREATE': {
      const msg = (d?.message ?? d) as Message;
      if (!msg?.id || !msg.channelId) break;
      upsertMessage(store, msg);
      if (msg.author?.id !== s.user?.id) activity(store, msg.channelId, msg);
      store.emit();
      break;
    }
    case 'MESSAGE_UPDATE': {
      const msg = (d?.message ?? d) as Message;
      if (!msg?.id || !msg.channelId) break;
      upsertMessage(store, msg);
      store.emit();
      break;
    }
    case 'MESSAGE_DELETE': {
      const channelId = d?.channelId; const id = d?.messageId ?? d?.id;
      if (!channelId || !id) break;
      const cache = s.messages[channelId];
      if (cache) cache.messages = cache.messages.filter((m) => m.id !== id);
      store.emit();
      break;
    }
    case 'MESSAGE_BULK_DELETE': {
      const channelId = d?.channelId; const ids: string[] = d?.messageIds ?? d?.ids ?? [];
      const cache = s.messages[channelId];
      if (cache) cache.messages = cache.messages.filter((m) => !ids.includes(m.id));
      store.emit();
      break;
    }
    case 'REACTION_ADD':
    case 'REACTION_REMOVE': {
      const cache = s.messages[d?.channelId];
      if (!cache) break;
      const msg = cache.messages.find((m) => m.id === d.messageId);
      if (!msg) break;
      if (Array.isArray(d.reactions)) msg.reactions = d.reactions;
      else {
        let r = msg.reactions.find((x) => x.emoji === d.emoji);
        if (!r) { r = { emoji: d.emoji, count: 0, me: false }; msg.reactions.push(r); }
        r.count = Math.max(0, r.count + (t === 'REACTION_ADD' ? 1 : -1));
        if (d.userId === s.user?.id) r.me = t === 'REACTION_ADD';
        if (r.count === 0) msg.reactions = msg.reactions.filter((x) => x !== r);
      }
      store.emit();
      break;
    }
    case 'MESSAGE_VOTE': {
      const cache = s.messages[d?.channelId];
      if (!cache) break;
      const msg = cache.messages.find((m) => m.id === d.messageId);
      if (!msg) break;
      if (d.message) Object.assign(msg, d.message);
      else {
        msg.score = d.score ?? msg.score;
        if (d.userId === s.user?.id) msg.myVote = (d.value ?? 0) as -1 | 0 | 1;
      }
      store.emit();
      break;
    }
    case 'TYPING_START': {
      const channelId = d?.channelId; if (!channelId || d.user?.id === s.user?.id) break;
      const list = (s.typing[channelId] ?? []).filter((u) => u.id !== d.user.id);
      list.push({ id: d.user.id, displayName: d.user.displayName, avatar: d.user.avatar ?? null, at: Date.now() });
      s.typing[channelId] = list;
      store.emit();
      setTimeout(() => {
        s.typing[channelId] = (s.typing[channelId] ?? []).filter((u) => u.id !== d.user.id);
        store.emit();
      }, 6500);
      break;
    }
    case 'PRESENCE_UPDATE': {
      if (!d?.userId) break;
      patchUserEverywhere(store, { id: d.userId, status: d.status, customStatus: d.customStatus ?? null });
      store.emit();
      break;
    }
    case 'USER_UPDATE': {
      const u = d?.user ?? d;
      if (!u?.id) break;
      patchUserEverywhere(store, u);
      if (u.id === s.user?.id && u.theme) store.applyTheme(u.theme);
      store.emit();
      break;
    }
    case 'MEMBER_UPDATE':
    case 'MEMBER_ADD': {
      const m = d?.member;
      if (!m?.serverId && d?.serverId) { void store.loadMembers(d.serverId); void store.loadServer(d.serverId, { force: true }); break; }
      if (!m?.serverId) break;
      const bundle = s.servers[m.serverId];
      if (!bundle) break;
      const idx = bundle.members.findIndex((x) => x.user.id === m.user.id);
      if (idx >= 0) bundle.members[idx] = m; else bundle.members.push(m);
      if (m.user.id === s.user?.id) bundle.member = m;
      store.emit();
      break;
    }
    case 'MEMBER_REMOVE': {
      const bundle = s.servers[d?.serverId]; if (!bundle) break;
      bundle.members = bundle.members.filter((x) => x.user.id !== d.userId);
      if (d.userId === s.user?.id) {
        delete s.servers[d.serverId];
        s.serverOrder = s.serverOrder.filter((id) => id !== d.serverId);
        if (s.activeServerId === d.serverId) { s.activeServerId = null; s.activeChannelId = null; s.view = { type: 'home' }; }
      }
      store.emit();
      break;
    }
    case 'CHANNEL_CREATE':
    case 'CHANNEL_UPDATE': {
      const ch = d?.channel ?? d;
      if (!ch?.id) break;
      s.channels[ch.id] = ch;
      const bundle = ch.serverId ? s.servers[ch.serverId] : null;
      if (bundle) {
        const idx = bundle.channels.findIndex((c) => c.id === ch.id);
        if (idx >= 0) bundle.channels[idx] = ch; else bundle.channels.push(ch);
        bundle.channels.sort((a, b) => a.position - b.position);
      }
      store.emit();
      break;
    }
    case 'CHANNEL_DELETE': {
      const id = d?.id ?? d?.channelId; if (!id) break;
      delete s.channels[id];
      for (const b of Object.values(s.servers)) b.channels = b.channels.filter((c) => c.id !== id);
      if (s.activeChannelId === id) { s.activeChannelId = null; s.view = s.activeServerId ? { type: 'home' } : { type: 'home' }; }
      store.emit();
      break;
    }
    case 'CHANNELS_REORDER': {
      if (Array.isArray(d?.channels)) for (const ch of d.channels) s.channels[ch.id] = ch;
      else if (d?.serverId) { void store.loadServer(d.serverId, { force: true }); break; }
      store.emit();
      break;
    }
    case 'SERVER_UPDATE': {
      const server = d?.server ?? d;
      if (!server?.id) break;
      const bundle = s.servers[server.id];
      if (bundle) bundle.server = server;
      store.emit();
      break;
    }
    case 'SERVER_JOIN':
    case 'SERVER_LEAVE': {
      const sid = d?.serverId;
      if (sid) {
        delete s.servers[sid];
        s.serverOrder = s.serverOrder.filter((id) => id !== sid);
        if (s.activeServerId === sid) { s.activeServerId = null; s.activeChannelId = null; s.view = { type: 'home' }; }
      }
      void store.loadWorkspace(); store.emit(); break;
    }
    case 'ROLE_CREATE':
    case 'ROLE_UPDATE': {
      const role = d?.role ?? d; if (!role?.id) break;
      const bundle = s.servers[role.serverId]; if (!bundle) break;
      const idx = bundle.roles.findIndex((r) => r.id === role.id);
      if (idx >= 0) bundle.roles[idx] = role; else bundle.roles.push(role);
      store.emit();
      break;
    }
    case 'ROLE_DELETE': {
      const bundle = s.servers[d?.serverId]; if (!bundle) break;
      bundle.roles = bundle.roles.filter((r) => r.id !== d.roleId);
      store.emit();
      break;
    }
    case 'READ_STATE_UPDATE': {
      if (d?.scope === 'notifications') { s.notificationUnread = d.unreadCount ?? 0; store.emit(); break; }
      if (!d?.channelId) break;
      s.unread[d.channelId] = { count: d.count ?? 0, mentions: d.mentionCount ?? d.mentions ?? 0, lastReadId: d.lastReadId ?? null };
      store.emit();
      break;
    }
    case 'NOTIFICATION_CREATE': {
      if (!d?.id) break;
      s.notifications = [d, ...s.notifications].slice(0, 100);
      s.notificationUnread += 1;
      store.emit();
      break;
    }
    case 'FRIEND_UPDATE':
      void store.refreshFriends(); break;
    case 'DM_CREATE':
    case 'DM_UPDATE': {
      const ch = d?.channel; if (!ch) {
        if (d?.channelId) { s.dms = s.dms.filter((x) => x.id !== d.channelId); if (s.activeChannelId === d.channelId) { s.activeChannelId = null; s.view = { type: 'home' }; } }
        store.emit(); break;
      }
      if (!ch.id) break;
      const idx = s.dms.findIndex((x) => x.id === ch.id);
      if (idx >= 0) s.dms[idx] = { ...s.dms[idx], ...ch }; else s.dms = [ch, ...s.dms];
      s.channels[ch.id] = { ...(s.channels[ch.id] ?? {}), ...ch } as any;
      store.emit();
      break;
    }
    case 'POLL_UPDATE': {
      const cache = s.messages[d?.channelId]; if (!cache) break;
      const msg = cache.messages.find((m) => m.id === d.messageId);
      if (msg && d.poll) msg.poll = d.poll;
      store.emit();
      break;
    }
    case 'THREAD_CREATE':
    case 'THREAD_UPDATE':
      if (d?.thread?.id) {
        s.channels[d.thread.id] = d.thread;
        const bundle = d.thread.serverId ? s.servers[d.thread.serverId] : null;
        if (bundle) {
          const idx = bundle.channels.findIndex((c) => c.id === d.thread.id);
          if (idx >= 0) bundle.channels[idx] = d.thread; else bundle.channels.push(d.thread);
        }
      }
      store.emit(); break;
    case 'VOICE_STATE': {
      if (!d?.channelId || s.activeChannelId !== d.channelId) break;
      const participants = s.voice.participants.filter((p) => p.userId !== d.userId);
      if (d.action === 'join' || d.action === 'state') participants.push({ userId: d.userId, muted: !!d.muted, deafened: !!d.deafened, speaking: !!d.speaking, user: d.user ?? participants.find((p) => p.userId === d.userId)?.user });
      s.voice.participants = participants;
      store.emit(); break;
    }
    case 'VOICE_SPEAKING': {
      const p = s.voice.participants.find((x) => x.userId === d?.userId);
      if (p) { p.speaking = !!d.speaking; store.emit(); }
      break;
    }
    case 'VOICE_SOUND': {
      if (d?.url) { try { const audio = new Audio(d.url); audio.volume = 0.8; void audio.play().catch(() => {}); } catch { /* ignore */ } }
      break;
    }
    default: break;
  }
}
