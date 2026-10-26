import { createRuntime, startServer } from './app';
import { seedIfEmpty } from './seed';
import { log } from './util/log';

// Keep SQLite, WAL and uploaded files private even when the volume directory is readable.
process.umask(0o077);

const runtime = createRuntime();
if (runtime.config.demoSeed) {
  try { seedIfEmpty(runtime); } catch (e) { log.error('seed failed (continuing)', { error: e instanceof Error ? e.message : String(e) }); }
}
const { stop } = startServer(runtime);

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info(`shutting down (${signal})`);
  try { stop(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
