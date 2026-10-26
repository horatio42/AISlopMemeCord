import { ApiError, json, readJson, type Router } from '../http';
import { displayName as vDisplayName, optText, color, int } from '../util/validate';
import { avatarUrl, presenceStatus, publicJwk, themeName } from '../util/users_validate';
import { getUser, toUser } from '../repos/users';
import { serializeMessages, type MessageRow } from '../repos/messages';
import {
  achievementLeaderboard, broadcastUserUpdate, decorateAchievements, karmaLeaderboard,
  publicProfile, searchUsers,
} from '../services/users_profile';
import { ACHIEVEMENTS } from '../../shared/memes';

const RANGES = ['week', 'month', 'all'] as const;
type Range = (typeof RANGES)[number];

function hiddenAccount(user: { disabled: number; banned_until: number | null }): boolean {
  return !!user.disabled || (!!user.banned_until && user.banned_until > Date.now());
}

export function register(router: Router) {
  router.get('/api/users/search', (ctx) => {
    const q = ctx.url.searchParams.get('q') ?? '';
    const limit = int(ctx.url.searchParams.get('limit') ?? undefined, 'limit', 1, 50, 20);
    return json({ users: searchUsers(ctx.db, ctx.hub, ctx.user!.id, q, limit) });
  }, { rateLimit: { windowMs: 60_000, max: 120 } });

  router.get('/api/users/@me/saved', (ctx) => {
    const rows = ctx.db.all<MessageRow>(
      `SELECT m.* FROM saved_messages s
       JOIN messages m ON m.id = s.message_id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC LIMIT 100`,
      ctx.user!.id,
    );
    return json({ messages: serializeMessages(ctx.db, rows, ctx.user!.id) });
  });

  router.get('/api/users/@me/achievements', (ctx) => {
    return json({ achievements: decorateAchievements(ctx.db, ctx.user!.id) });
  });

  router.patch('/api/users/@me', async (ctx) => {
    const body = await readJson(ctx.req);
    const id = ctx.user!.id;
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); params.push(value); };

    if ('displayName' in body) set('display_name', vDisplayName(body.displayName));
    if ('bio' in body) set('bio', optText(body.bio, 'bio', 500));
    if ('pronouns' in body) set('pronouns', optText(body.pronouns, 'pronouns', 40));
    if ('bannerColor' in body) {
      const raw = body.bannerColor;
      set('banner_color', raw === null || raw === '' ? null : color(raw));
    }
    if ('theme' in body) set('theme', themeName(body.theme));
    if ('avatar' in body) set('avatar', avatarUrl(ctx.db, id, body.avatar));
    if ('customStatus' in body) set('custom_status', optText(body.customStatus, 'customStatus', 128));

    if (sets.length) {
      ctx.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
      broadcastUserUpdate(ctx.db, ctx.hub, toUser(getUser(ctx.db, id)!));
    }
    return json({ user: toUser(getUser(ctx.db, id)!) });
  }, { rateLimit: { windowMs: 60_000, max: 30 } });

  router.put('/api/users/@me/presence', async (ctx) => {
    const body = await readJson(ctx.req);
    const status = presenceStatus(body.status);
    const customStatus = 'customStatus' in body
      ? optText(body.customStatus, 'customStatus', 128)
      : ctx.user!.custom_status;
    ctx.db.run('UPDATE users SET status = ?, custom_status = ?, last_seen_at = ? WHERE id = ?', status, customStatus, Date.now(), ctx.user!.id);
    // Invisible means invisible: everyone else sees offline.
    ctx.hub.broadcastPresence(ctx.user!.id, status === 'invisible' ? 'offline' : status, customStatus);
    return json({ user: toUser(getUser(ctx.db, ctx.user!.id)!) });
  }, { rateLimit: { windowMs: 60_000, max: 120 } });

  router.post('/api/users/@me/keys', async (ctx) => {
    const body = await readJson(ctx.req);
    if (!('publicKey' in body)) throw new ApiError(400, 'VALIDATION_ERROR', 'Send publicKey (a public JWK string, or null).');
    const key = publicJwk(body.publicKey);
    const stored = key ? JSON.stringify(key) : null;
    ctx.db.run('UPDATE users SET public_key = ? WHERE id = ?', stored, ctx.user!.id);
    return json({ publicKey: stored });
  }, { rateLimit: { windowMs: 60_000, max: 20 } });

  router.get('/api/users/:id/public-key', (ctx) => {
    const row = getUser(ctx.db, ctx.params.id!);
    if (!row || (hiddenAccount(row) && !ctx.user!.is_admin && row.id !== ctx.user!.id)) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'That user is not here. They touched grass, perhaps.');
    }
    return json({ publicKey: row.public_key });
  });

  router.get('/api/users/:id', (ctx) => {
    const row = getUser(ctx.db, ctx.params.id!);
    if (!row || (hiddenAccount(row) && !ctx.user!.is_admin && row.id !== ctx.user!.id)) {
      throw new ApiError(404, 'USER_NOT_FOUND', 'That user is not here. They touched grass, perhaps.');
    }
    return json({ profile: publicProfile(ctx.db, ctx.hub, ctx.user!.id, row) });
  });

  router.get('/api/achievements', (ctx) => {
    return json({
      achievements: ACHIEVEMENTS,
      leaderboard: achievementLeaderboard(ctx.db, ctx.hub, ctx.user!.id),
      mine: decorateAchievements(ctx.db, ctx.user!.id),
    });
  });

  router.get('/api/leaderboard', (ctx) => {
    const raw = (ctx.url.searchParams.get('range') ?? 'all').trim();
    if (!(RANGES as readonly string[]).includes(raw)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `range must be one of: ${RANGES.join(', ')}.`, {
        range: `Expected one of: ${RANGES.join(', ')}.`,
      });
    }
    const limit = int(ctx.url.searchParams.get('limit') ?? undefined, 'limit', 1, 50, 10);
    return json({ entries: karmaLeaderboard(ctx.db, ctx.hub, ctx.user!.id, raw as Range, limit) });
  });

  router.get('/api/health', (ctx) => {
    return json({ ok: true, uptime: Math.floor(process.uptime()), version: ctx.config.version });
  }, { auth: false });
}
