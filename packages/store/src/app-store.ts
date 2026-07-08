import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import { appMigrations, runMigrations } from './migrations.js';
import type { RecentWorkspace } from './types.js';

/** App-global storage: recent workspaces and settings (AI config, encrypted keys). */
export class AppStore {
  constructor(readonly db: Database) {}

  static open(dataDir: string): AppStore {
    mkdirSync(dataDir, { recursive: true });
    const db = new BetterSqlite3(path.join(dataDir, 'app.db'));
    db.pragma('journal_mode = WAL');
    runMigrations(db, appMigrations);
    return new AppStore(db);
  }

  close(): void {
    this.db.close();
  }

  touchRecentWorkspace(workspacePath: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO recent_workspaces (path, name, last_opened_at) VALUES (?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET name=excluded.name, last_opened_at=excluded.last_opened_at`,
      )
      .run(workspacePath, name, Date.now());
  }

  recentWorkspaces(limit = 10): RecentWorkspace[] {
    const rows = this.db
      .prepare('SELECT * FROM recent_workspaces ORDER BY last_opened_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      path: r.path as string,
      name: r.name as string,
      lastOpenedAt: r.last_opened_at as number,
    }));
  }

  getSetting(key: string): string | null {
    const value = this.db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key) as
      string | undefined;
    return value ?? null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      this.db
        .prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        )
        .run(key, value);
    }
  }
}
