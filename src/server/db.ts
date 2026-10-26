import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config';

export type DB = Database;

export class DatabaseWrapper {
  readonly raw: Database;
  constructor(readonly config: Config) {
    this.raw = new Database(config.dbPath, { create: true, strict: true });
    this.raw.exec('PRAGMA journal_mode = WAL;');
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    this.raw.exec('PRAGMA synchronous = NORMAL;');
    this.raw.exec('PRAGMA wal_autocheckpoint = 1000;');
    this.migrate();
  }

  private migrate() {
    const dir = new URL('./db/migrations/', import.meta.url).pathname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const current = Number((this.raw.query('PRAGMA user_version').get() as { user_version: number }).user_version) || 0;
    for (let i = 0; i < files.length; i++) {
      if (i + 1 <= current) continue;
      const sql = readFileSync(join(dir, files[i]!), 'utf8');
      const tx = this.raw.transaction(() => {
        this.raw.exec(sql);
        this.raw.exec(`PRAGMA user_version = ${i + 1}`);
      });
      tx();
    }
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | null {
    return this.raw.query(sql).get(...(params as never[])) as T | null;
  }
  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.raw.query(sql).all(...(params as never[])) as T[];
  }
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.raw.query(sql).run(...(params as never[]));
  }
  exec(sql: string) { this.raw.exec(sql); }
  transaction<T>(fn: () => T): T { return this.raw.transaction(fn)(); }
  close() { this.raw.close(); }
}

export function openDatabase(config: Config): DatabaseWrapper {
  return new DatabaseWrapper(config);
}
