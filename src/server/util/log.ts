import { appendFileSync, renameSync, statSync } from 'node:fs';

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = (process.env.SLOP_LOG_LEVEL ?? 'info') as Level;
let logFile: string | null = null;

/** Enable the admin log viewer. Called once the data directory is resolved. */
export function configureLogFile(path: string): void {
  logFile = path;
}

function logAt(level: Level, message: string, meta?: Record<string, unknown>) {
  if (order[level] < order[configured]) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
  if (!logFile) return;
  try {
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 5 * 1024 * 1024) renameSync(logFile, `${logFile}.1`);
    appendFileSync(logFile, line + '\n', { mode: 0o600 });
  } catch { /* logging must never take down the request */ }
}
export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => logAt('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => logAt('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => logAt('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => logAt('error', m, meta),
};
