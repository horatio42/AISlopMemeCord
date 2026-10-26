import type { DatabaseWrapper } from '../db';
import type { InstanceInfo } from '../../shared/types';

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  instance_name: 'AISlopMemeCord',
  instance_description: 'A privacy-first, single-container Discord clone. 100% AI slop, 0% telemetry.',
  motd: 'Welcome to the Slop Pit. Please do not feed the goblin.',
  registration: 'open',
  max_upload_mb: 25,
  e2ee_enabled: true,
  soundboard_enabled: true,
  voice_enabled: true,
  forum_enabled: true,
  webhooks_enabled: true,
  public_discovery: true,
  meme_mode: 'unhinged',
  slop_of_the_day: '',
};

export function getSettings(db: DatabaseWrapper): Record<string, unknown> {
  const rows = db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export function setSetting(db: DatabaseWrapper, key: string, value: unknown) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function registrationMode(db: DatabaseWrapper, fallback: 'open' | 'invite' | 'closed'): 'open' | 'invite' | 'closed' {
  const s = getSettings(db);
  const mode = s.registration;
  return mode === 'open' || mode === 'invite' || mode === 'closed' ? mode : fallback;
}

export function instanceInfo(db: DatabaseWrapper, hub: { onlineCount(): number }, fallbackRegistration: 'open' | 'invite' | 'closed', version: string): InstanceInfo {
  const settings = getSettings(db);
  const userCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  const serverCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM servers')?.n ?? 0;
  const messageCount = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE deleted_at IS NULL')?.n ?? 0;
  return {
    name: String(settings.instance_name ?? 'AISlopMemeCord'),
    motd: String(settings.motd ?? ''),
    description: String(settings.instance_description ?? ''),
    registration: registrationMode(db, fallbackRegistration),
    version,
    userCount,
    serverCount,
    messageCount,
    onlineCount: hub.onlineCount(),
    maxUploadMb: Number(settings.max_upload_mb ?? 25),
    e2eeEnabled: !!settings.e2ee_enabled,
    soundboardEnabled: !!settings.soundboard_enabled,
    features: {
      voice: !!settings.voice_enabled,
      forum: !!settings.forum_enabled,
      webhooks: !!settings.webhooks_enabled,
      discovery: !!settings.public_discovery,
      e2ee: !!settings.e2ee_enabled,
      soundboard: !!settings.soundboard_enabled,
    },
    privacy: { telemetry: false, externalRequests: false, vendors: ['SQLite', 'Bun', 'Preact'] },
  };
}
