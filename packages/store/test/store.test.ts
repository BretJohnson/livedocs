import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import {
  AppStore,
  APP_DB_COMPATIBILITY_EPOCH,
  WorkspaceStore,
  WORKSPACE_DB_COMPATIBILITY_EPOCH,
  appMigrations,
  createWslWorkspaceReference,
  openCompatibleDatabase,
  readCompatibilityEpoch,
  runMigrations,
  workspaceDbFileName,
  workspaceMigrations,
} from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'livedocs-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('applies all workspace migrations and records the version', () => {
    const db = new BetterSqlite3(':memory:');
    const version = runMigrations(db, workspaceMigrations);
    expect(version).toBe(workspaceMigrations.at(-1)!.version);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table')")
      .pluck()
      .all() as string[];
    for (const t of [
      'files',
      'symbols',
      'imports',
      'dependencies',
      'commits',
      'commit_files',
      'generated_artifacts',
      'ai_cache',
      'search_index',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent — re-running applies nothing', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db, workspaceMigrations);
    expect(() => runMigrations(db, workspaceMigrations)).not.toThrow();
  });

  it('tracks compatibility epochs independently from migration versions', () => {
    const app = AppStore.open(dir);
    const workspace = WorkspaceStore.open(dir, '/fake/workspace');
    try {
      expect(readCompatibilityEpoch(app.db)).toBe(APP_DB_COMPATIBILITY_EPOCH);
      expect(app.db.pragma('user_version', { simple: true })).toBe(appMigrations.at(-1)!.version);
      expect(readCompatibilityEpoch(workspace.db)).toBe(WORKSPACE_DB_COMPATIBILITY_EPOCH);
      expect(workspace.db.pragma('user_version', { simple: true })).toBe(
        workspaceMigrations.at(-1)!.version,
      );
    } finally {
      workspace.close();
      app.close();
    }
  });

  it('applies forward migrations within an epoch and preserves existing data', () => {
    const filename = path.join(dir, 'forward.db');
    const first = openCompatibleDatabase({
      filename,
      kind: 'workspace',
      compatibilityEpoch: 7,
      migrations: [
        {
          version: 1,
          name: 'create-items',
          up: (db) => db.exec('CREATE TABLE items (value TEXT NOT NULL)'),
        },
      ],
      DatabaseConstructor: BetterSqlite3,
    });
    first.prepare('INSERT INTO items (value) VALUES (?)').run('preserved');
    first.close();

    const second = openCompatibleDatabase({
      filename,
      kind: 'workspace',
      compatibilityEpoch: 7,
      migrations: [
        {
          version: 1,
          name: 'create-items',
          up: (db) => db.exec('CREATE TABLE items (value TEXT NOT NULL)'),
        },
        {
          version: 2,
          name: 'add-note',
          up: (db) => db.exec('ALTER TABLE items ADD COLUMN note TEXT'),
        },
      ],
      DatabaseConstructor: BetterSqlite3,
    });
    expect(second.prepare('SELECT value FROM items').pluck().get()).toBe('preserved');
    expect(second.pragma('user_version', { simple: true })).toBe(2);
    second.close();
  });

  it('resets mismatched epochs without affecting a separate database', () => {
    const resetFilename = path.join(dir, 'reset.db');
    const stableFilename = path.join(dir, 'stable.db');
    const migration = {
      version: 1,
      name: 'create-items',
      up: (db: BetterSqlite3.Database) => db.exec('CREATE TABLE items (value TEXT NOT NULL)'),
    };
    for (const filename of [resetFilename, stableFilename]) {
      const db = openCompatibleDatabase({
        filename,
        kind: 'workspace',
        compatibilityEpoch: 1,
        migrations: [migration],
        DatabaseConstructor: BetterSqlite3,
      });
      db.prepare('INSERT INTO items (value) VALUES (?)').run(path.basename(filename));
      db.close();
    }
    writeFileSync(`${resetFilename}-wal`, 'stale wal');
    writeFileSync(`${resetFilename}-shm`, 'stale shm');
    const messages: string[] = [];

    const reset = openCompatibleDatabase({
      filename: resetFilename,
      kind: 'workspace',
      compatibilityEpoch: 2,
      migrations: [migration],
      DatabaseConstructor: BetterSqlite3,
      onReset: (message) => messages.push(message),
    });
    expect(reset.prepare('SELECT COUNT(*) FROM items').pluck().get()).toBe(0);
    expect(readCompatibilityEpoch(reset)).toBe(2);
    expect(messages).toEqual([
      '[livedocs-store] Resetting workspace database compatibility epoch 1 -> 2',
    ]);
    expect(existsSync(`${resetFilename}-wal`)).toBe(false);
    expect(existsSync(`${resetFilename}-shm`)).toBe(false);
    reset.close();

    const stable = new BetterSqlite3(stableFilename);
    expect(stable.prepare('SELECT value FROM items').pluck().get()).toBe('stable.db');
    expect(readCompatibilityEpoch(stable)).toBe(1);
    stable.close();
  });

  it('recreates an unreadable existing database without leaking the initial handle', () => {
    const filename = path.join(dir, 'corrupt.db');
    writeFileSync(filename, 'not a sqlite database');
    const messages: string[] = [];

    const recovered = openCompatibleDatabase({
      filename,
      kind: 'app',
      compatibilityEpoch: 1,
      migrations: [
        {
          version: 1,
          name: 'create-items',
          up: (db) => db.exec('CREATE TABLE items (value TEXT NOT NULL)'),
        },
      ],
      DatabaseConstructor: BetterSqlite3,
      onReset: (message) => messages.push(message),
    });
    expect(recovered.prepare('SELECT COUNT(*) FROM items').pluck().get()).toBe(0);
    expect(messages).toEqual([
      '[livedocs-store] Resetting app database compatibility epoch unreadable -> 1',
    ]);
    recovered.close();
  });

  it('reports a focused error when an incompatible database cannot be recreated', () => {
    const filename = path.join(dir, 'failed-reset.db');
    const migration = {
      version: 1,
      name: 'create-items',
      up: (db: BetterSqlite3.Database) => db.exec('CREATE TABLE items (value TEXT NOT NULL)'),
    };
    const original = openCompatibleDatabase({
      filename,
      kind: 'workspace',
      compatibilityEpoch: 1,
      migrations: [migration],
      DatabaseConstructor: BetterSqlite3,
    });
    original.close();

    let constructions = 0;
    const FailingConstructor = function (databaseFilename: string) {
      constructions += 1;
      if (constructions === 2) throw new Error('simulated reopen failure');
      return new BetterSqlite3(databaseFilename);
    } as unknown as typeof BetterSqlite3;

    expect(() =>
      openCompatibleDatabase({
        filename,
        kind: 'workspace',
        compatibilityEpoch: 2,
        migrations: [migration],
        DatabaseConstructor: FailingConstructor,
        onReset: () => undefined,
      }),
    ).toThrow(
      /Failed to reset workspace database compatibility epoch 1 -> 2: simulated reopen failure/,
    );
  });

  it('rejects a future migration version without modifying the database', () => {
    const filename = path.join(dir, 'future.db');
    const migration = {
      version: 1,
      name: 'create-items',
      up: (db: BetterSqlite3.Database) => db.exec('CREATE TABLE items (value TEXT NOT NULL)'),
    };
    const current = openCompatibleDatabase({
      filename,
      kind: 'app',
      compatibilityEpoch: 1,
      migrations: [migration],
      DatabaseConstructor: BetterSqlite3,
    });
    current.prepare('INSERT INTO items (value) VALUES (?)').run('keep me');
    current.pragma('user_version = 2');
    current.exec(`
      CREATE TRIGGER reject_metadata_insert
      BEFORE INSERT ON livedocs_database_metadata
      BEGIN
        SELECT RAISE(ABORT, 'metadata write attempted');
      END;
    `);
    current.close();

    expect(() =>
      openCompatibleDatabase({
        filename,
        kind: 'app',
        compatibilityEpoch: 1,
        migrations: [migration],
        DatabaseConstructor: BetterSqlite3,
      }),
    ).toThrow(/newer than supported/);

    const unchanged = new BetterSqlite3(filename);
    expect(unchanged.pragma('user_version', { simple: true })).toBe(2);
    expect(unchanged.prepare('SELECT value FROM items').pluck().get()).toBe('keep me');
    unchanged.close();
  });

  it('derives a stable per-workspace db filename', () => {
    const a = workspaceDbFileName('/some/project');
    expect(a).toBe(workspaceDbFileName('/some/project'));
    expect(a).not.toBe(workspaceDbFileName('/other/project'));
    expect(a).toMatch(/^project-[0-9a-f]{16}\.db$/);

    const wsl = createWslWorkspaceReference('Ubuntu', '/some/project');
    expect(workspaceDbFileName(wsl)).toBe(workspaceDbFileName(wsl));
    expect(workspaceDbFileName(wsl)).not.toBe(
      workspaceDbFileName(createWslWorkspaceReference('Debian', '/some/project')),
    );
  });
});

describe('WorkspaceStore', () => {
  let store: WorkspaceStore;
  beforeEach(() => {
    store = WorkspaceStore.open(dir, '/fake/workspace');
  });
  afterEach(() => store.close());

  it('persists the database file under the data dir', () => {
    expect(existsSync(path.join(dir, workspaceDbFileName('/fake/workspace')))).toBe(true);
  });

  it('reindexes normally after an incompatible workspace database reset', () => {
    store.close();
    const filename = path.join(dir, workspaceDbFileName('/fake/workspace'));
    const raw = new BetterSqlite3(filename);
    raw
      .prepare(
        "UPDATE livedocs_database_metadata SET value = '0' WHERE key = 'compatibility_epoch'",
      )
      .run();
    raw.close();

    store = WorkspaceStore.open(dir, '/fake/workspace');
    store.upsertFile(
      {
        path: 'README.md',
        language: 'markdown',
        size: 12,
        mtime: 1,
        contentHash: 'reset-index',
        isMarkdown: true,
      },
      'Epoch reset searchable content',
    );
    expect(store.search('searchable').map((hit) => hit.path)).toEqual(['README.md']);
  });

  it('upserts files and searches content via FTS', () => {
    store.upsertFile(
      {
        path: 'docs/guide.md',
        language: 'markdown',
        size: 10,
        mtime: 1,
        contentHash: 'a',
        isMarkdown: true,
      },
      'The chokidar watcher observes file changes',
    );
    store.upsertFile(
      {
        path: 'src/index.ts',
        language: 'typescript',
        size: 20,
        mtime: 2,
        contentHash: 'b',
        isMarkdown: false,
      },
      'export function watchFiles() {}',
    );
    const hits = store.search('watcher');
    expect(hits.map((h) => h.path)).toContain('docs/guide.md');
    // prefix search
    expect(store.search('watch').length).toBeGreaterThanOrEqual(2);
    // hostile FTS syntax must not throw
    expect(() => store.search('"unbalanced AND (')).not.toThrow();
  });

  it('search reflects edits and deletions', () => {
    const file = {
      path: 'a.md',
      language: 'markdown',
      size: 1,
      mtime: 1,
      contentHash: 'x',
      isMarkdown: true,
    };
    store.upsertFile(file, 'alpha bravo');
    expect(store.search('bravo')).toHaveLength(1);
    store.upsertFile({ ...file, contentHash: 'y' }, 'alpha charlie');
    expect(store.search('bravo')).toHaveLength(0);
    expect(store.search('charlie')).toHaveLength(1);
    store.removeFile('a.md');
    expect(store.search('charlie')).toHaveLength(0);
    expect(store.getFile('a.md')).toBeNull();
  });

  it('replaces symbols, imports, and dependencies per file', () => {
    store.replaceSymbols('src/a.ts', [{ name: 'foo', kind: 'export' }]);
    store.replaceSymbols('src/a.ts', [
      { name: 'bar', kind: 'export' },
      { name: 'baz', kind: 'export' },
    ]);
    expect(store.allSymbols().map((s) => s.name)).toEqual(['bar', 'baz']);

    store.replaceImports('src/a.ts', [
      { specifier: './b', resolvedPath: 'src/b.ts' },
      { specifier: 'react', resolvedPath: null },
    ]);
    expect(store.allImports()).toHaveLength(2);

    store.replaceDependencies('package.json', [
      { name: 'react', version: '^19.0.0', depType: 'prod' },
    ]);
    expect(store.allDependencies()[0]).toMatchObject({ name: 'react', depType: 'prod' });
  });

  it('stores commits with changed files in order', () => {
    store.replaceCommits([
      {
        hash: 'h2',
        author: 'A',
        email: 'a@x',
        date: '2026-01-02',
        message: 'second',
        files: [{ path: 'b.ts', status: 'M' }],
      },
      {
        hash: 'h1',
        author: 'A',
        email: 'a@x',
        date: '2026-01-01',
        message: 'first',
        files: [{ path: 'a.ts', status: 'A' }],
      },
    ]);
    const commits = store.recentCommits();
    expect(commits.map((c) => c.hash)).toEqual(['h2', 'h1']);
    expect(commits[0].files).toEqual([{ path: 'b.ts', status: 'M' }]);
  });

  it('saves, fetches, and marks generated artifacts stale', () => {
    const provenance = {
      generator: 'api-index',
      kind: 'deterministic' as const,
      timestamp: new Date().toISOString(),
      inputDigest: 'd1',
    };
    store.saveArtifact({
      docPath: 'README.md',
      generator: 'api-index',
      params: '{}',
      output: '{"type":"root","children":[]}',
      provenance,
      inputDigest: 'd1',
    });
    let artifact = store.getArtifact('README.md', 'api-index', '{}');
    expect(artifact?.stale).toBe(false);
    expect(artifact?.provenance.generator).toBe('api-index');

    store.setArtifactStale('README.md', 'api-index', '{}', true);
    artifact = store.getArtifact('README.md', 'api-index', '{}');
    expect(artifact?.stale).toBe(true);

    // Re-saving clears staleness.
    store.saveArtifact({
      docPath: 'README.md',
      generator: 'api-index',
      params: '{}',
      output: '{"type":"root","children":[]}',
      provenance,
      inputDigest: 'd2',
    });
    expect(store.getArtifact('README.md', 'api-index', '{}')?.stale).toBe(false);
    expect(store.getArtifact('README.md', 'api-index', '{}')?.inputDigest).toBe('d2');
  });

  it('ai cache round-trips', () => {
    expect(store.aiCacheGet('k')).toBeNull();
    store.aiCacheSet('k', 'hello', 'claude-sonnet-5');
    expect(store.aiCacheGet('k')?.response).toBe('hello');
    store.aiCacheSet('k', 'replaced', 'claude-sonnet-5');
    expect(store.aiCacheGet('k')?.response).toBe('replaced');
  });
});

describe('AppStore', () => {
  it('resets the released v2 schema before recording a recent workspace', () => {
    const filename = path.join(dir, 'app.db');
    const legacy = new BetterSqlite3(filename);
    legacy.exec(`
      CREATE TABLE recent_workspaces (
        identity TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'local',
        path TEXT NOT NULL,
        distro TEXT,
        name TEXT NOT NULL,
        label TEXT NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings (key, value) VALUES ('ai.provider', 'openai');
      PRAGMA user_version = 2;
    `);
    legacy.close();

    const app = AppStore.open(dir);
    try {
      app.touchRecentWorkspace('/fresh/workspace', 'fresh');
      const columns = app.db.prepare('PRAGMA table_info(recent_workspaces)').all() as {
        name: string;
      }[];
      expect(columns.map((column) => column.name)).not.toContain('label');
      expect(app.recentWorkspaces()).toHaveLength(1);
      expect(app.getSetting('ai.provider')).toBeNull();
      expect(readCompatibilityEpoch(app.db)).toBe(APP_DB_COMPATIBILITY_EPOCH);
      expect(app.db.pragma('user_version', { simple: true })).toBe(1);
    } finally {
      app.close();
    }
  });

  it('tracks recent workspaces most-recent-first and settings', () => {
    const app = AppStore.open(dir);
    try {
      const one = path.resolve('/w/one');
      const two = path.resolve('/w/two');
      app.touchRecentWorkspace(one, 'one');
      app.touchRecentWorkspace(two, 'two');
      app.touchRecentWorkspace(one, 'one');
      expect(app.recentWorkspaces().map((w) => w.path)).toEqual([one, two]);
      const recentColumns = app.db.prepare('PRAGMA table_info(recent_workspaces)').all() as {
        name: string;
      }[];
      expect(recentColumns.map((column) => column.name)).not.toContain('label');

      expect(app.getSetting('ai.provider')).toBeNull();
      app.setSetting('ai.provider', 'anthropic');
      expect(app.getSetting('ai.provider')).toBe('anthropic');
      app.setSetting('ai.provider', null);
      expect(app.getSetting('ai.provider')).toBeNull();
    } finally {
      app.close();
    }
  });

  it('preserves WSL recent workspace identity', () => {
    const app = AppStore.open(dir);
    try {
      app.touchRecentWorkspace(createWslWorkspaceReference('Ubuntu', '/home/me/app'));
      app.touchRecentWorkspace(createWslWorkspaceReference('Debian', '/home/me/app'));

      const recents = app.recentWorkspaces();
      expect(recents).toHaveLength(2);
      expect(recents.map((w) => w.label).sort()).toEqual([
        '~/app [WSL: Debian]',
        '~/app [WSL: Ubuntu]',
      ]);
      expect(recents.map((w) => w.distro).sort()).toEqual(['Debian', 'Ubuntu']);
    } finally {
      app.close();
    }
  });
});
