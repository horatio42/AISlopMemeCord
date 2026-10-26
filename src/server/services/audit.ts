import type { DatabaseWrapper } from '../db';
import { newId } from '../util/ids';

export function logAudit(db: DatabaseWrapper, input: {
  serverId?: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  changes?: Record<string, unknown> | null;
}) {
  const id = newId('a');
  db.run(
    'INSERT INTO audit_logs (id, server_id, actor_id, action, target_type, target_id, reason, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.serverId ?? null, input.actorId ?? null, input.action, input.targetType, input.targetId ?? null,
    input.reason ?? null, input.changes ? JSON.stringify(input.changes) : null, Date.now(),
  );
  return id;
}
