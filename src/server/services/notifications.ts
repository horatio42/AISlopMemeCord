import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import { newId } from '../util/ids';
import type { Notification } from '../../shared/types';
import { toUser } from '../repos/users';

export function notify(db: DatabaseWrapper, hub: Hub | null, input: {
  userId: string;
  type: Notification['type'];
  title: string;
  body: string;
  serverId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  actorId?: string | null;
}): Notification {
  const id = newId('n');
  const now = Date.now();
  db.run(
    `INSERT INTO notifications (id, user_id, type, title, body, server_id, channel_id, message_id, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.userId, input.type, input.title.slice(0, 200), input.body.slice(0, 500), input.serverId ?? null,
    input.channelId ?? null, input.messageId ?? null, input.actorId ?? null, now,
  );
  const actorRow = input.actorId ? db.get('SELECT * FROM users WHERE id = ?', input.actorId) : null;
  const notification: Notification = {
    id, type: input.type, title: input.title, body: input.body, serverId: input.serverId ?? null,
    channelId: input.channelId ?? null, messageId: input.messageId ?? null,
    actor: actorRow ? toUser(actorRow as never) : null, read: false, createdAt: now,
  };
  hub?.send(input.userId, 'NOTIFICATION_CREATE', notification);
  return notification;
}

export function markNotificationsRead(db: DatabaseWrapper, userId: string, ids?: string[]) {
  if (ids?.length) {
    const ph = ids.map(() => '?').join(',');
    db.run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ph})`, userId, ...ids);
  } else {
    db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', userId);
  }
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', userId)?.n ?? 0;
}
