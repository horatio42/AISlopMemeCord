import type { DatabaseWrapper } from '../db';
import type { Hub } from '../realtime/hub';
import { ACHIEVEMENTS } from '../../shared/memes';

export function grantAchievement(db: DatabaseWrapper, hub: Hub | null, userId: string, key: string): boolean {
  const def = ACHIEVEMENTS.find((a) => a.key === key);
  if (!def) return false;
  const existing = db.get('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?', userId, key);
  if (existing) return false;
  db.run('INSERT INTO achievements (user_id, key, earned_at) VALUES (?, ?, ?)', userId, key, Date.now());
  hub?.send(userId, 'NOTIFICATION_CREATE', {
    id: 'achievement_' + key, type: 'system', title: `${def.emoji} Achievement unlocked: ${def.name}`,
    body: def.description, serverId: null, channelId: null, messageId: null, actor: null, read: false, createdAt: Date.now(),
  });
  return true;
}
