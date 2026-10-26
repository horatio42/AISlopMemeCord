import type { Channel, Role, Server, User } from '../../shared/types';

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isAdmin: boolean;
}

export interface AdminUser extends User {
  disabled: boolean;
  bannedUntil: number | null;
  banReason: string | null;
  hasTotp: boolean;
  lastSeenAt: number;
}

export interface DailyPoint { date: string; count: number }

export interface HealthInfo {
  status: string;
  dbSize: number;
  walSize: number;
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number };
  version: string;
  bun: string;
  node: string;
}

export interface AuditEntry {
  id: string;
  serverId: string | null;
  serverName: string | null;
  actor: UserRef | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  createdAt: number;
}

export interface Overview {
  counts: {
    users: number;
    servers: number;
    messages: number;
    channels: number;
    uploads: number;
    openReports: number;
    sessions: number;
  };
  onlineCount: number;
  storageBytes: number;
  signups: DailyPoint[];
  messages: DailyPoint[];
  topServers: { id: string; name: string; icon: string | null; memberCount: number }[];
  recentAudit: AuditEntry[];
  health: HealthInfo;
}

export type Paged<T> = { total: number; page: number; limit: number } & T;

export interface AdminUserListItem {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isAdmin: boolean;
  disabled: boolean;
  bannedUntil: number | null;
  createdAt: number;
  lastSeenAt: number;
  karma: number;
  serverCount: number;
  messageCount: number;
}

export interface AdminUserServer {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  isOwner: boolean;
  joinedAt: number;
  nickname: string | null;
}

export interface AdminUserDetail {
  user: AdminUser;
  servers: AdminUserServer[];
  achievements: { key: string; name: string; description: string; emoji: string; earnedAt: number }[];
  recentAudit: AuditEntry[];
  messageCount: number;
  uploads: number;
  sessions: number;
}

export interface AdminServerListItem {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isPublic: boolean;
  nsfw: boolean;
  memberCount: number;
  channelCount: number;
  messageCount: number;
  createdAt: number;
  owner: UserRef | null;
}

export interface AdminInvite {
  code: string;
  serverId: string;
  serverName?: string;
  channelId: string | null;
  creator: UserRef;
  uses: number;
  maxUses: number;
  expiresAt: number | null;
  createdAt: number;
}

export interface AdminServerDetail {
  server: Server;
  owner: UserRef | null;
  channels: Channel[];
  roles: Role[];
  invites: AdminInvite[];
  counts: { members: number; channels: number; roles: number; messages: number; recentMessages: number; bans: number };
}

export interface ReportMessage {
  id: string;
  channelId: string;
  channelName: string | null;
  serverId: string | null;
  serverName: string | null;
  author: UserRef | null;
  encrypted: boolean;
  content: string | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface Report {
  id: string;
  serverId: string | null;
  serverName: string | null;
  channelId: string | null;
  channelName: string | null;
  reporter: UserRef | null;
  targetUser: UserRef | null;
  message: ReportMessage | null;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution: string | null;
  resolvedBy: UserRef | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface AccountInvite {
  code: string;
  createdBy: UserRef;
  maxUses: number;
  uses: number;
  expiresAt: number | null;
  createdAt: number;
  expired?: boolean;
  exhausted?: boolean;
}

export interface AdminSettings {
  instance_name: string;
  instance_description: string;
  motd: string;
  registration: 'open' | 'invite' | 'closed';
  max_upload_mb: number;
  e2ee_enabled: boolean;
  soundboard_enabled: boolean;
  voice_enabled: boolean;
  forum_enabled: boolean;
  webhooks_enabled: boolean;
  public_discovery: boolean;
  meme_mode: string;
  slop_of_the_day: string;
}

export interface EmojiAsset {
  id: string;
  serverId: string | null;
  serverName: string | null;
  name: string;
  url: string | null;
  animated: boolean;
  uploaderId: string | null;
  createdAt: number;
}

export interface StickerAsset {
  id: string;
  serverId: string | null;
  serverName: string | null;
  name: string;
  url: string | null;
  description: string | null;
  tags: string[];
  uploaderId: string | null;
  createdAt: number;
}

export interface SoundAsset {
  id: string;
  serverId: string | null;
  serverName: string | null;
  name: string;
  emoji: string;
  url: string | null;
  uploaderId: string | null;
  createdAt: number;
}

export interface AssetsPayload {
  emojis: EmojiAsset[];
  stickers: StickerAsset[];
  sounds: SoundAsset[];
}

export interface LogsPayload { lines: string[]; file: string }
