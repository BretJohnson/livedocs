import type { Database } from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const workspaceMigrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE files (
          path TEXT PRIMARY KEY,
          language TEXT,
          size INTEGER NOT NULL,
          mtime INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          is_markdown INTEGER NOT NULL DEFAULT 0,
          indexed_at INTEGER NOT NULL
        );

        CREATE TABLE symbols (
          id INTEGER PRIMARY KEY,
          file_path TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL
        );
        CREATE INDEX idx_symbols_file ON symbols(file_path);

        CREATE TABLE imports (
          id INTEGER PRIMARY KEY,
          source_path TEXT NOT NULL,
          specifier TEXT NOT NULL,
          resolved_path TEXT
        );
        CREATE INDEX idx_imports_source ON imports(source_path);

        CREATE TABLE dependencies (
          id INTEGER PRIMARY KEY,
          manifest_path TEXT NOT NULL,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          dep_type TEXT NOT NULL
        );
        CREATE INDEX idx_dependencies_manifest ON dependencies(manifest_path);

        CREATE TABLE commits (
          hash TEXT PRIMARY KEY,
          author TEXT,
          email TEXT,
          date TEXT,
          message TEXT,
          seq INTEGER NOT NULL
        );

        CREATE TABLE commit_files (
          commit_hash TEXT NOT NULL,
          path TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE INDEX idx_commit_files_path ON commit_files(path);

        CREATE TABLE generated_artifacts (
          doc_path TEXT NOT NULL,
          generator TEXT NOT NULL,
          params TEXT NOT NULL DEFAULT '{}',
          output TEXT NOT NULL,
          provenance TEXT NOT NULL,
          input_digest TEXT NOT NULL,
          stale INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (doc_path, generator, params)
        );

        CREATE TABLE ai_cache (
          key TEXT PRIMARY KEY,
          response TEXT NOT NULL,
          model TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE search_index USING fts5(
          path UNINDEXED,
          content,
          tokenize = 'porter unicode61'
        );
      `);
    },
  },
];

export const appMigrations: Migration[] = [
  {
    version: 1,
    name: 'epoch-1-app-schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE recent_workspaces (
          identity TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'local',
          path TEXT NOT NULL,
          distro TEXT,
          name TEXT NOT NULL,
          last_opened_at INTEGER NOT NULL
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
];

/** Apply pending migrations, tracked via SQLite's user_version pragma. */
export function runMigrations(db: Database, migrations: Migration[]): number {
  const current = validateMigrationVersion(db, migrations);
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
  }
  return db.pragma('user_version', { simple: true }) as number;
}

/** Reject databases created by a newer build before the caller performs any writes. */
export function validateMigrationVersion(db: Database, migrations: Migration[]): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  const latest = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  if (current > latest) {
    throw new Error(
      `Database migration version ${current} is newer than supported version ${latest}`,
    );
  }
  return current;
}
