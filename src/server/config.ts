import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Config {
  dataDir: string;
  uploadDir: string;
  exportsDir: string;
  dbPath: string;
  port: number;
  host: string;
  secret: string;
  registration: 'open' | 'invite' | 'closed';
  secureCookies: boolean;
  trustProxy: boolean;
  maxUploadBytes: number;
  rateLimit: boolean;
  demoSeed: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  staticDir: string;
  version: string;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function ensureSecret(dataDir: string): string {
  const path = join(dataDir, 'secret.key');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(path, secret + '\n', { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return secret;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(overrides.dataDir ?? process.env.SLOP_DATA_DIR ?? './data');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const uploadDir = join(dataDir, 'uploads');
  const exportsDir = join(dataDir, 'exports');
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dataDir, 'logs'), { recursive: true, mode: 0o700 });
  const registrationEnv = (process.env.SLOP_REGISTRATION ?? 'open') as Config['registration'];
  const maxUploadMb = Number(process.env.SLOP_MAX_UPLOAD_MB ?? 25);
  const cfg: Config = {
    dataDir,
    uploadDir,
    exportsDir,
    dbPath: join(dataDir, 'slop.db'),
    port: Number(process.env.PORT ?? process.env.SLOP_PORT ?? 3000),
    host: process.env.SLOP_HOST ?? '0.0.0.0',
    secret: overrides.secret ?? ensureSecret(dataDir),
    registration: ['open', 'invite', 'closed'].includes(registrationEnv) ? registrationEnv : 'open',
    secureCookies: envBool('SLOP_SECURE_COOKIES', false),
    trustProxy: envBool('SLOP_TRUST_PROXY', false),
    maxUploadBytes: Math.max(1, Math.min(500, maxUploadMb)) * 1024 * 1024,
    rateLimit: envBool('SLOP_RATE_LIMIT', true),
    demoSeed: envBool('SLOP_DEMO_SEED', true),
    logLevel: (process.env.SLOP_LOG_LEVEL as Config['logLevel']) ?? 'info',
    staticDir: resolve(overrides.staticDir ?? process.env.SLOP_STATIC_DIR ?? './dist/public'),
    version: '1.0.0-slop',
  };
  Object.assign(cfg, overrides);
  cfg.dataDir = dataDir;
  cfg.uploadDir = overrides.uploadDir ?? uploadDir;
  cfg.exportsDir = overrides.exportsDir ?? exportsDir;
  cfg.dbPath = overrides.dbPath ?? join(dataDir, 'slop.db');
  return cfg;
}
