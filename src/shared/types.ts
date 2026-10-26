export type ID = string;
export type ISOTime = number; // epoch milliseconds everywhere, always

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
export type ChannelType = 'text' | 'voice' | 'category' | 'forum' | 'thread' | 'dm' | 'group_dm' | 'announcement';
export type ThemeName = 'slop' | 'corporate' | 'deepfried' | 'terminal' | 'light';

export interface User {
  id: ID;
  username: string;
  displayName: string;
  avatar: string | null;
  bannerColor: string | null;
  bio: string | null;
  pronouns: string | null;
  status: UserStatus;
  customStatus: string | null;
  isAdmin: boolean;
  isBot: boolean;
  badges: string[];
  karma: number;
  createdAt: ISOTime;
  publicKey: string | null;
  theme: ThemeName;
}

export interface PublicProfile extends User {
  serverIds?: ID[];
  achievements?: Achievement[];
  topMessages?: { id: ID; channelId: ID; channelName: string; serverName: string | null; content: string; score: number; createdAt: ISOTime }[];
  friendStatus?: 'none' | 'pending_in' | 'pending_out' | 'friends' | 'blocked' | 'blocked_by';
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  emoji: string;
  earnedAt: ISOTime;
}

export interface Role {
  id: ID;
  serverId: ID;
  name: string;
  color: string;
  position: number;
  permissions: number;
  mentionable: boolean;
  hoist: boolean;
  isDefault: boolean;
  icon: string | null;
  memberCount?: number;
}

export interface Server {
  id: ID;
  name: string;
  icon: string | null;
  banner: string | null;
  bannerColor: string | null;
  description: string | null;
  ownerId: ID;
  memberCount: number;
  createdAt: ISOTime;
  isPublic: boolean;
  nsfw: boolean;
  welcomeChannelId: ID | null;
  systemChannelId: ID | null;
  motd: string | null;
  traits: string[];
  roles?: Role[];
}

export interface ChannelOverride {
  targetType: 'role' | 'user';
  targetId: ID;
  allow: number;
  deny: number;
}

export interface Channel {
  id: ID;
  serverId: ID | null;
  type: ChannelType;
  name: string;
  topic: string | null;
  nsfw: boolean;
  slowmode: number;
  position: number;
  parentId: ID | null;
  locked: boolean;
  archived: boolean;
  lastMessageId: ID | null;
  createdAt: ISOTime;
  tags: string[];
  icon: string | null;
  defaultSort: 'hot' | 'new' | 'top' | null;
  votingEnabled: boolean;
  originMessageId: ID | null;
  memberIds?: ID[];
  overrides?: ChannelOverride[];
  unreadCount?: number;
  mentionCount?: number;
  lastReadId?: ID | null;
}

export interface ServerMember {
  serverId: ID;
  user: User;
  nickname: string | null;
  roles: ID[];
  joinedAt: ISOTime;
  timeoutUntil: ISOTime | null;
}

export interface Attachment {
  id: ID;
  filename: string;
  contentType: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
  spoiler: boolean;
  alt: string | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
  userIds?: ID[];
}

export interface PollOption {
  id: ID;
  label: string;
  votes: number;
}

export interface Poll {
  id: ID;
  question: string;
  multiple: boolean;
  closesAt: ISOTime | null;
  options: PollOption[];
  totalVotes: number;
  myVotes: ID[];
}

export interface Message {
  id: ID;
  channelId: ID;
  serverId: ID | null;
  author: User;
  content: string;
  createdAt: ISOTime;
  editedAt: ISOTime | null;
  deletedAt: ISOTime | null;
  replyTo: { id: ID; authorName: string; content: string; deleted?: boolean } | null;
  threadId: ID | null;
  pinned: boolean;
  pinnedAt: ISOTime | null;
  tts: boolean;
  encrypted: boolean;
  cryptoMeta: string | null;
  attachments: Attachment[];
  reactions: Reaction[];
  mentions: { users: ID[]; roles: ID[]; everyone: boolean; channels: ID[] };
  poll: Poll | null;
  sticker: { id: ID; name: string; url: string } | null;
  score: number;
  myVote: -1 | 0 | 1;
  awards: { key: string; count: number }[];
  saved?: boolean;
  system?: boolean;
}

export interface DMChannel {
  id: ID;
  type: 'dm' | 'group_dm';
  name: string;
  icon: string | null;
  members: User[];
  lastMessage: Message | null;
  ownerId: ID | null;
  unreadCount: number;
  mentionCount: number;
  pinned?: boolean;
  createdAt: ISOTime;
  lastReadId?: ID | null;
}

export interface Friend {
  user: User;
  status: 'accepted' | 'pending_in' | 'pending_out' | 'blocked' | 'blocked_by';
  createdAt: ISOTime;
}

export interface Invite {
  code: string;
  serverId: ID;
  channelId: ID | null;
  creator: User;
  uses: number;
  maxUses: number;
  expiresAt: ISOTime | null;
  createdAt: ISOTime;
  members?: User[];
}

export interface Notification {
  id: ID;
  type: 'mention' | 'reply' | 'friend_request' | 'system' | 'report';
  title: string;
  body: string;
  serverId: ID | null;
  channelId: ID | null;
  messageId: ID | null;
  actor: User | null;
  read: boolean;
  createdAt: ISOTime;
}

export interface AuditEntry {
  id: ID;
  serverId: ID | null;
  actor: User | null;
  action: string;
  targetType: string;
  targetId: ID | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  createdAt: ISOTime;
}

export interface Report {
  id: ID;
  guildId: ID | null;
  reporter: User;
  targetUser: User | null;
  message: Message | null;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution: string | null;
  resolvedBy: User | null;
  createdAt: ISOTime;
  resolvedAt: ISOTime | null;
}

export interface ServerEvent {
  id: ID;
  serverId: ID;
  channelId: ID | null;
  name: string;
  description: string | null;
  startsAt: ISOTime;
  endsAt: ISOTime | null;
  creator: User;
  cover: string | null;
  rsvp: 'interested' | 'going' | null;
  counts: { interested: number; going: number };
}

export interface Webhook {
  id: ID;
  serverId: ID;
  channelId: ID;
  name: string;
  avatar: string | null;
  createdAt: ISOTime;
  lastUsedAt: ISOTime | null;
  token?: string;
}

export interface Emoji {
  id: ID;
  serverId: ID | null;
  name: string;
  url: string;
  animated: boolean;
}

export interface Sticker {
  id: ID;
  serverId: ID | null;
  name: string;
  url: string;
  description: string | null;
  tags: string[];
}

export interface Sound {
  id: ID;
  serverId: ID | null;
  name: string;
  url: string;
  emoji: string;
}

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  emoji: string;
}

export interface MemberList {
  total: number;
  groups: { roleId: ID | null; roleName: string; color: string; members: ServerMember[] }[];
}

export interface SearchResult {
  messages: Message[];
  total: number;
  took: number;
}

export interface InstanceInfo {
  name: string;
  motd: string;
  description: string;
  registration: 'open' | 'invite' | 'closed';
  version: string;
  userCount: number;
  serverCount: number;
  messageCount: number;
  onlineCount: number;
  maxUploadMb: number;
  e2eeEnabled: boolean;
  soundboardEnabled: boolean;
  features: Record<string, boolean>;
  /** Never includes secrets. */
  privacy: { telemetry: false; externalRequests: false; vendors: string[] };
}
