import type { DatabaseWrapper } from './db';
import { newId } from './util/ids';

const STATIC = '/static/assets';
const GLOBAL_SOUNDS: [string, string, string][] = [
  ['airhorn', 'Airhorn', '📢'], ['bruh', 'Bruh', '🗿'], ['vine-boom', 'Vine Boom', '💥'],
  ['among-us', 'Sus', '🛸'], ['bonk', 'Bonk', '🔨'], ['yeet', 'Yeet', '🚀'],
  ['error', 'Error', '💾'], ['dialup', 'Dial-up', '📞'], ['fart', 'Fart', '💨'],
  ['rimshot', 'Rimshot', '🥁'], ['oof', 'Oof', '💀'], ['pog', 'Pog', '😲'], ['slop', 'Slopgoo', '🟢'],
];

export function seedGlobalAssets(db: DatabaseWrapper) {
  const now = Date.now();
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sounds WHERE server_id IS NULL')?.n ?? 0;
  if (!count) {
    for (const [slug, name, emoji] of GLOBAL_SOUNDS) {
      db.run(
        'INSERT INTO sounds (id, server_id, name, path, emoji, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
        newId('snd'), name, `${STATIC}/sounds/${slug}.wav`, emoji, now,
      );
    }
  }
}
