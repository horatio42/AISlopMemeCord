import type { DatabaseWrapper } from '../db';
import { getSettings } from './instance';

export function getAccountInvite(db: DatabaseWrapper, code: string) {
  if (!code) return null;
  return db.get<{ code: string; max_uses: number; uses: number; expires_at: number | null }>(
    'SELECT code, max_uses, uses, expires_at FROM account_invites WHERE code = ?', code,
  );
}

export function validateRegistrationMode(
  db: DatabaseWrapper,
  fallback: 'open' | 'invite' | 'closed',
  inviteCode: string,
): { ok: true; mode: 'open' | 'invite' | 'closed'; message: string; inviteCode?: string } | { ok: false; mode: 'open' | 'invite' | 'closed'; message: string } {
  const userCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  const settings = getSettings(db);
  const mode = (['open', 'invite', 'closed'].includes(String(settings.registration)) ? settings.registration : fallback) as 'open' | 'invite' | 'closed';
  if (userCount === 0) return { ok: true, mode, message: 'First user. You are the slop overload.' };
  if (mode === 'open') return { ok: true, mode, message: 'Open registration.' };
  if (mode === 'closed') return { ok: false, mode, message: 'Registration is closed. The slop gates are sealed.' };
  const invite = getAccountInvite(db, inviteCode.trim());
  if (!invite) return { ok: false, mode, message: 'An account invite code is required on this instance.' };
  if (invite.expires_at && invite.expires_at < Date.now()) return { ok: false, mode, message: 'That account invite has expired.' };
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses) return { ok: false, mode, message: 'That account invite has been used up.' };
  return { ok: true, mode, message: 'Invite accepted.', inviteCode: invite.code };
}
