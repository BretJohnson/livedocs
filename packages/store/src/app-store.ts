import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { appMigrations, runMigrations } from './migrations.js';
import { loadBetterSqlite3 } from './sqlite.js';
import type { RecentWorkspace } from './types.js';
import {
  createLocalWorkspaceReference,
  normalizeWorkspaceReference,
  workspaceReferenceKey,
  workspaceReferenceLabel,
  workspaceReferenceName,
  type WorkspaceReference,
} from './workspace-ref.js';

const BetterSqlite3 = loadBetterSqlite3();

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

  touchRecentWorkspace(workspace: string | WorkspaceReference, name?: string): void {
    const reference =
      typeof workspace === 'string'
        ? createLocalWorkspaceReference(workspace, name)
        : normalizeWorkspaceReference(workspace);
    const finalName = name ?? workspaceReferenceName(reference);
    const label = workspaceReferenceLabel(reference);
    this.db
      .prepare(
        `INSERT INTO recent_workspaces
           (identity, kind, path, distro, name, label, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(identity) DO UPDATE SET
           kind=excluded.kind,
           path=excluded.path,
           distro=excluded.distro,
           name=excluded.name,
           label=excluded.label,
           last_opened_at=excluded.last_opened_at`,
      )
      .run(
        workspaceReferenceKey(reference),
        reference.kind,
        reference.path,
        reference.kind === 'wsl' ? reference.distro : null,
        finalName,
        label,
        Date.now(),
      );
  }

  recentWorkspaces(limit = 10): RecentWorkspace[] {
    const rows = this.db
      .prepare('SELECT * FROM recent_workspaces ORDER BY last_opened_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => {
      const reference =
        r.kind === 'wsl'
          ? ({
              kind: 'wsl',
              distro: r.distro as string,
              path: r.path as string,
              name: r.name as string,
            } satisfies WorkspaceReference)
          : createLocalWorkspaceReference(r.path as string, r.name as string);
      return {
        reference,
        kind: reference.kind,
        path: reference.path,
        name: r.name as string,
        label: (r.label as string | null) ?? workspaceReferenceLabel(reference),
        distro: reference.kind === 'wsl' ? reference.distro : undefined,
        lastOpenedAt: r.last_opened_at as number,
      };
    });
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
