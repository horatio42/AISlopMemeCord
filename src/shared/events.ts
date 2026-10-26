export type GatewayEventName =
  | 'READY' | 'PING' | 'PONG'
  | 'MESSAGE_CREATE' | 'MESSAGE_UPDATE' | 'MESSAGE_DELETE' | 'MESSAGE_BULK_DELETE'
  | 'MESSAGE_VOTE' | 'REACTION_ADD' | 'REACTION_REMOVE'
  | 'TYPING_START'
  | 'PRESENCE_UPDATE' | 'USER_UPDATE'
  | 'CHANNEL_CREATE' | 'CHANNEL_UPDATE' | 'CHANNEL_DELETE' | 'CHANNELS_REORDER'
  | 'SERVER_UPDATE' | 'SERVER_JOIN' | 'SERVER_LEAVE'
  | 'MEMBER_UPDATE' | 'MEMBER_ADD' | 'MEMBER_REMOVE' | 'MEMBERS_CHUNK'
  | 'ROLE_CREATE' | 'ROLE_UPDATE' | 'ROLE_DELETE'
  | 'READ_STATE_UPDATE' | 'NOTIFICATION_CREATE'
  | 'FRIEND_UPDATE'
  | 'DM_CREATE' | 'DM_UPDATE'
  | 'POLL_UPDATE'
  | 'THREAD_CREATE' | 'THREAD_UPDATE'
  | 'VOICE_STATE' | 'VOICE_SOUND' | 'VOICE_SIGNAL' | 'VOICE_SPEAKING'
  | 'SERVER_EVENT_UPDATE'
  | 'TYPING_STOP';

export interface GatewayPayload<T = unknown> {
  op: 'event' | 'hello' | 'heartbeat' | 'dispatch' | 'error' | 'reconnect';
  t?: GatewayEventName;
  d?: T;
  seq?: number;
}

export interface ReadyData {
  user: { id: string; username: string };
  sessionId: string;
  servers: string[];
  heartbeatInterval: number;
  instance: { name: string; version: string; motd: string; e2eeEnabled: boolean };
  unread: Record<string, { count: number; mentions: number; lastReadId: string | null }>;
}

export interface TypingData { channelId: string; user: { id: string; displayName: string; avatar: string | null }; at: number }
export interface PresenceData { userId: string; status: string; customStatus: string | null }
export interface VoiceStateData { channelId: string; userId: string; action: 'join' | 'leave' | 'state'; muted?: boolean; deafened?: boolean; speaking?: boolean; user?: unknown }
export interface VoiceSignalData { channelId: string; from: string; target: string; kind: 'offer' | 'answer' | 'ice'; payload: unknown }
