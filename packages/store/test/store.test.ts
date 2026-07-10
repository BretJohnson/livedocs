import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import {
  AppStore,
  WorkspaceStore,
  createWslWorkspaceReference,
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
  it('tracks recent workspaces most-recent-first and settings', () => {
    const app = AppStore.open(dir);
    app.touchRecentWorkspace('/w/one', 'one');
    app.touchRecentWorkspace('/w/two', 'two');
    app.touchRecentWorkspace('/w/one', 'one');
    expect(app.recentWorkspaces().map((w) => w.path)).toEqual(['/w/one', '/w/two']);

    expect(app.getSetting('ai.provider')).toBeNull();
    app.setSetting('ai.provider', 'anthropic');
    expect(app.getSetting('ai.provider')).toBe('anthropic');
    app.setSetting('ai.provider', null);
    expect(app.getSetting('ai.provider')).toBeNull();
    app.close();
  });

  it('preserves WSL recent workspace identity', () => {
    const app = AppStore.open(dir);
    app.touchRecentWorkspace(createWslWorkspaceReference('Ubuntu', '/home/me/app'));
    app.touchRecentWorkspace(createWslWorkspaceReference('Debian', '/home/me/app'));

    const recents = app.recentWorkspaces();
    expect(recents).toHaveLength(2);
    expect(recents.map((w) => w.label).sort()).toEqual([
      'Debian:/home/me/app',
      'Ubuntu:/home/me/app',
    ]);
    expect(recents.map((w) => w.distro).sort()).toEqual(['Debian', 'Ubuntu']);
    app.close();
  });
});
