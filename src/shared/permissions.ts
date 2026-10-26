/** Discord-style permission bitfield. Values fit in a signed 32-bit int (SQLite INTEGER). */
export const Perm = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  MANAGE_EMOJIS: 1 << 4,
  VIEW_AUDIT_LOG: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  MODERATE_MEMBERS: 1 << 8,
  MANAGE_MESSAGES: 1 << 9,
  MANAGE_THREADS: 1 << 10,
  CREATE_INVITES: 1 << 11,
  CHANGE_NICKNAME: 1 << 12,
  MANAGE_NICKNAMES: 1 << 13,
  VIEW_CHANNEL: 1 << 14,
  READ_MESSAGE_HISTORY: 1 << 15,
  SEND_MESSAGES: 1 << 16,
  SEND_IN_THREADS: 1 << 17,
  EMBED_LINKS: 1 << 18,
  ATTACH_FILES: 1 << 19,
  ADD_REACTIONS: 1 << 20,
  MENTION_EVERYONE: 1 << 21,
  PIN_MESSAGES: 1 << 22,
  CREATE_THREADS: 1 << 23,
  CONNECT: 1 << 24,
  SPEAK: 1 << 25,
  STREAM: 1 << 26,
  USE_SOUNDBOARD: 1 << 27,
  CREATE_EVENTS: 1 << 28,
  EXTERNAL_EMOJIS: 1 << 29,
} as const;

export type PermissionName = keyof typeof Perm;
export const PERMISSION_NAMES = Object.keys(Perm) as PermissionName[];

export const PERMISSION_META: Record<PermissionName, { label: string; description: string; group: string }> = {
  ADMINISTRATOR: { label: 'Administrator', description: 'All permissions. Absolutely unhinged amounts of power.', group: 'General' },
  MANAGE_SERVER: { label: 'Manage Server', description: 'Rename the server, edit settings, delete it.', group: 'General' },
  MANAGE_CHANNELS: { label: 'Manage Channels', description: 'Create, edit, reorder and delete channels.', group: 'General' },
  MANAGE_ROLES: { label: 'Manage Roles', description: 'Create roles and assign them below your highest role.', group: 'General' },
  MANAGE_EMOJIS: { label: 'Manage Emojis & Stickers', description: 'Add and remove custom slop.', group: 'General' },
  VIEW_AUDIT_LOG: { label: 'View Audit Log', description: 'See who did what, and when.', group: 'General' },
  KICK_MEMBERS: { label: 'Kick Members', description: 'Remove members from the server.', group: 'Moderation' },
  BAN_MEMBERS: { label: 'Ban Members', description: 'Ban members so they cannot rejoin.', group: 'Moderation' },
  MODERATE_MEMBERS: { label: 'Timeout Members', description: 'Mute members temporarily.', group: 'Moderation' },
  MANAGE_MESSAGES: { label: 'Manage Messages', description: 'Delete other people\u2019s messages and purge.', group: 'Moderation' },
  MANAGE_THREADS: { label: 'Manage Threads', description: 'Archive, lock and delete threads.', group: 'Text' },
  CREATE_INVITES: { label: 'Create Invites', description: 'Invite more slop goblins.', group: 'General' },
  CHANGE_NICKNAME: { label: 'Change Nickname', description: 'Change your own server nickname.', group: 'General' },
  MANAGE_NICKNAMES: { label: 'Manage Nicknames', description: 'Change other members\u2019 nicknames.', group: 'General' },
  VIEW_CHANNEL: { label: 'View Channels', description: 'See channels and read their contents.', group: 'Text' },
  READ_MESSAGE_HISTORY: { label: 'Read History', description: 'Scroll back before joining.', group: 'Text' },
  SEND_MESSAGES: { label: 'Send Messages', description: 'Post. Shitpost. Repeat.', group: 'Text' },
  SEND_IN_THREADS: { label: 'Send in Threads', description: 'Reply inside threads.', group: 'Text' },
  EMBED_LINKS: { label: 'Embed Links', description: 'Rich previews for pasted links.', group: 'Text' },
  ATTACH_FILES: { label: 'Attach Files', description: 'Upload images, memes and cat pics.', group: 'Text' },
  ADD_REACTIONS: { label: 'Add Reactions', description: 'React with emoji.', group: 'Text' },
  MENTION_EVERYONE: { label: 'Mention @everyone', description: 'Ping the whole server. Use responsibly (or don\u2019t).', group: 'Text' },
  PIN_MESSAGES: { label: 'Pin Messages', description: 'Pin important slop.', group: 'Text' },
  CREATE_THREADS: { label: 'Create Threads', description: 'Start threads and forum posts.', group: 'Text' },
  CONNECT: { label: 'Connect', description: 'Join voice channels.', group: 'Voice' },
  SPEAK: { label: 'Speak', description: 'Transmit your beautiful voice.', group: 'Voice' },
  STREAM: { label: 'Stream', description: 'Share your screen.', group: 'Voice' },
  USE_SOUNDBOARD: { label: 'Use Soundboard', description: 'Deploy the airhorn.', group: 'Voice' },
  CREATE_EVENTS: { label: 'Create Events', description: 'Schedule server events.', group: 'General' },
  EXTERNAL_EMOJIS: { label: 'Use External Emojis', description: 'Use emojis from other servers.', group: 'Text' },
};

export const DEFAULT_EVERYONE =
  Perm.VIEW_CHANNEL | Perm.READ_MESSAGE_HISTORY | Perm.SEND_MESSAGES | Perm.SEND_IN_THREADS |
  Perm.EMBED_LINKS | Perm.ATTACH_FILES | Perm.ADD_REACTIONS | Perm.CREATE_INVITES |
  Perm.CHANGE_NICKNAME | Perm.CREATE_THREADS | Perm.CONNECT | Perm.SPEAK | Perm.STREAM |
  Perm.USE_SOUNDBOARD | Perm.CREATE_EVENTS | Perm.EXTERNAL_EMOJIS;

// Presets used by the UI role editor.
export const PERMISSION_PRESETS: Record<string, number> = {
  Moderator: Perm.VIEW_CHANNEL | Perm.READ_MESSAGE_HISTORY | Perm.SEND_MESSAGES | Perm.SEND_IN_THREADS |
    Perm.EMBED_LINKS | Perm.ATTACH_FILES | Perm.ADD_REACTIONS | Perm.CREATE_INVITES | Perm.CHANGE_NICKNAME |
    Perm.CREATE_THREADS | Perm.CONNECT | Perm.SPEAK | Perm.USE_SOUNDBOARD | Perm.MANAGE_MESSAGES |
    Perm.KICK_MEMBERS | Perm.MODERATE_MEMBERS | Perm.MANAGE_THREADS | Perm.PIN_MESSAGES,
  Member: DEFAULT_EVERYONE,
  Readonly: Perm.VIEW_CHANNEL | Perm.READ_MESSAGE_HISTORY | Perm.CONNECT,
  Admin: Perm.ADMINISTRATOR,
};

export function has(permissions: number, bit: number): boolean {
  return (permissions & bit) === bit;
}

export function permissionsToNames(permissions: number): PermissionName[] {
  return PERMISSION_NAMES.filter((n) => has(permissions, Perm[n]));
}
