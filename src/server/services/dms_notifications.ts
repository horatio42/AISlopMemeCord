import type { DatabaseWrapper } from '../db';
import type { UserRow } from '../http';
import { toUser } from '../repos/users';
import type { Notification } from '../../shared/types';

export interface NotificationRow {
  id: string; user_id: string; type: string; title: string; body: string;
  server_id: string | null; channel_id: string | null; message_id: string | null;
  actor_id: string | null; read: number; created_at: number;
}

export function toNotification(db: DatabaseWrapper, row: NotificationRow): Notification {
  const actor = row.actor_id ? db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.actor_id) : null;
  return {
    id: row.id,
    type: row.type as Notification['type'],
    title: row.title,
    body: row.body,
    serverId: row.server_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    actor: actor ? toUser(actor) : null,
    read: !!row.read,
    createdAt: row.created_at,
  };
}

export function unreadNotificationCount(db: DatabaseWrapper, userId: string): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', userId)?.n ?? 0;
}

export function listNotifications(db: DatabaseWrapper, userId: string, opts: {
  unreadOnly?: boolean;
  beforeId?: string;
  beforeCreatedAt?: number;
  limit: number;
}): NotificationRow[] {
  const clauses = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (opts.unreadOnly) clauses.push('read = 0');
  if (opts.beforeCreatedAt !== undefined) {
    clauses.push('created_at < ?');
    params.push(opts.beforeCreatedAt);
  } else if (opts.beforeId) {
    clauses.push('id < ?');
    params.push(opts.beforeId);
  }
  params.push(opts.limit);
  return db.all<NotificationRow>(
    `SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`,
    ...params,
  );
}
