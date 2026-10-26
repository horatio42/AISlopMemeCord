import type { GatewayStatus } from './gateway';
import type {
  User, InstanceInfo, Server, Channel, Role, ServerMember, DMChannel, Friend, Notification,
  Message, PublicProfile, ThemeName, Emoji, Sticker, Sound,
} from '../../shared/types';

export interface ServerBundle {
  server: Server;
  channels: Channel[];
  roles: Role[];
  member: ServerMember | null;
  members: ServerMember[];
  emojis: Emoji[];
  stickers: Sticker[];
  sounds: Sound[];
}
export interface ChannelCache { messages: Message[]; hasMore: boolean; loaded: boolean; loading: boolean; error: string | null; }
export interface TypingUser { id: string; displayName: string; avatar: string | null; at: number; }
export type ViewType = 'home' | 'friends' | 'discover' | 'saved' | 'leaderboard' | 'channel' | 'dm' | 'invite' | 'achievements';
export interface View { type: ViewType; serverId?: string; channelId?: string; inviteCode?: string; }
export interface VoiceParticipant { userId: string; muted: boolean; deafened: boolean; speaking: boolean; user?: User; }
export interface VoiceState { channelId: string | null; participants: VoiceParticipant[]; muted: boolean; deafened: boolean; connecting: boolean; error: string | null; }
export type RightPanel = null | { kind: 'threads'; channelId: string } | { kind: 'pins'; channelId: string } | { kind: 'thread'; threadId: string; parentId: string } | { kind: 'soundboard'; channelId: string };
export interface UiState {
  membersOpen: boolean;
  profile: PublicProfile | null;
  profileLoading: boolean;
  lightbox: { url: string; alt?: string } | null;
  quickSwitcherOpen: boolean;
  searchOpen: boolean;
  searchQuery: string;
  mobileSidebar: boolean;
  mobileRail: boolean;
  rightPanel: RightPanel;
  userSettingsOpen: boolean;
  inviteModalOpen: boolean;
  pendingInvite: InvitePreview | null;
}
export interface InvitePreview {
  invite: { code: string; uses: number; maxUses: number; expiresAt: number | null; createdAt: number; creator?: { displayName?: string } };
  server: { id: string; name: string; icon: string | null; description: string | null; memberCount: number; onlineCount?: number };
  channel?: { id: string; name: string } | null;
  inviter?: { id: string; displayName: string } | null;
}
export interface FriendState { friends: Friend[]; incoming: Friend[]; outgoing: Friend[]; blocked: Friend[]; }
export interface MenuItem { label: string; icon?: string; action?: () => void; danger?: boolean; disabled?: boolean; shortcut?: string; separator?: boolean; header?: boolean; }
export interface MenuState { x: number; y: number; items: MenuItem[]; header?: string; }
export interface Toast { id: number; message: string; kind: 'info' | 'success' | 'error'; emoji?: string; }
export interface LeaderboardEntry { rank: number; user: User; karma: number; messageCount: number; }
export interface AppState {
  authReady: boolean;
  bootError: string | null;
  user: User | null;
  instance: InstanceInfo | null;
  theme: ThemeName;
  loadingWorkspace: boolean;
  gatewayStatus: GatewayStatus;
  servers: Record<string, ServerBundle>;
  serverOrder: string[];
  dms: DMChannel[];
  friends: FriendState;
  notifications: Notification[];
  notificationUnread: number;
  leaderboard: LeaderboardEntry[];
  view: View;
  activeServerId: string | null;
  activeChannelId: string | null;
  channels: Record<string, Channel>;
  messages: Record<string, ChannelCache>;
  typing: Record<string, TypingUser[]>;
  unread: Record<string, { count: number; mentions: number; lastReadId: string | null }>;
  voice: VoiceState;
  ui: UiState;
  menu: MenuState | null;
  toasts: Toast[];
}
export const initialUi = (): UiState => ({
  membersOpen: true, profile: null, profileLoading: false, lightbox: null, quickSwitcherOpen: false,
  searchOpen: false, searchQuery: '', mobileSidebar: false, mobileRail: false, rightPanel: null,
  userSettingsOpen: false, inviteModalOpen: false, pendingInvite: null,
});
export function initialState(): AppState {
  const savedTheme = (localStorage.getItem('slop-theme') as ThemeName) || 'slop';
  return {
    authReady: false, bootError: null, user: null, instance: null, theme: savedTheme, loadingWorkspace: false,
    gatewayStatus: 'disconnected', servers: {}, serverOrder: [], dms: [], friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
    notifications: [], notificationUnread: 0, leaderboard: [], view: { type: 'home' }, activeServerId: null, activeChannelId: null,
    channels: {}, messages: {}, typing: {}, unread: {}, voice: { channelId: null, participants: [], muted: false, deafened: false, connecting: false, error: null },
    ui: initialUi(), menu: null, toasts: [],
  };
}
