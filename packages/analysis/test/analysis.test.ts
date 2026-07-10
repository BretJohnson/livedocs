import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '@livedocs/store';
import {
  createPathFilter,
  detectLanguage,
  GitService,
  Indexer,
  parseLogWithFiles,
  parsePackageManifest,
  tsJsExtractor,
} from '../src/index.js';

let workspace: string;
let dataDir: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'livedocs-ws-'));
  dataDir = mkdtempSync(path.join(tmpdir(), 'livedocs-data-'));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const absolute = path.join(workspace, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

describe('ignore rules', () => {
  it('applies defaults plus .gitignore entries', () => {
    write('.gitignore', 'secret/\n*.log\n');
    const filter = createPathFilter(workspace);
    expect(filter.ignores('node_modules/react/index.js')).toBe(true);
    expect(filter.ignores('.git/HEAD')).toBe(true);
    expect(filter.ignores('dist/main.js')).toBe(true);
    expect(filter.ignores('secret/key.txt')).toBe(true);
    expect(filter.ignores('debug.log')).toBe(true);
    expect(filter.ignores('src/index.ts')).toBe(false);
    expect(filter.ignores('README.md')).toBe(false);
  });

  it('excludes directory-only rules at the directory boundary', () => {
    write('.gitignore', 'secret/\n');
    const filter = createPathFilter(workspace);
    // A bare `secret` path is not matched by `secret/` via ignores()...
    expect(filter.ignores('secret')).toBe(false);
    // ...but ignoresDirectory() catches the directory so it is not traversed.
    expect(filter.ignoresDirectory('secret')).toBe(true);
    expect(filter.ignores('secret/key.txt')).toBe(true);
    // Non-ignored directories are still traversable, and a file named `secret`
    // is not excluded by the directory-only rule.
    expect(filter.ignoresDirectory('src')).toBe(false);
    expect(filter.ignores('secret')).toBe(false);
  });
});

describe('language detection', () => {
  it('maps extensions to languages', () => {
    expect(detectLanguage('src/a.ts')).toBe('typescript');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('schema.prisma')).toBe('prisma');
    expect(detectLanguage('binary.exe')).toBeNull();
  });
});

describe('ts/js extractor', () => {
  it('extracts exported symbols and resolves relative imports', async () => {
    write('src/util.ts', 'export const helper = 1;');
    const source =
      "import { helper } from './util';\nimport react from 'react';\n" +
      'export function main(): void {}\nexport const VERSION = "1";\n';
    const result = await tsJsExtractor.extract('src/index.ts', source, workspace);
    expect(result.symbols.map((s) => s.name).sort()).toEqual(['VERSION', 'main']);
    const relative = result.imports.find((i) => i.specifier === './util');
    expect(relative?.resolvedPath).toBe('src/util.ts');
    const external = result.imports.find((i) => i.specifier === 'react');
    expect(external?.resolvedPath).toBeNull();
  });

  it('never throws on unparseable content', async () => {
    const result = await tsJsExtractor.extract('src/broken.ts', 'import {', workspace);
    expect(result.symbols).toEqual([]);
  });
});

describe('manifest parsing', () => {
  it('extracts all dependency sections with versions', () => {
    const deps = parsePackageManifest(
      JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { vitest: '^3.0.0' },
        peerDependencies: { typescript: '^5' },
      }),
    );
    expect(deps).toContainEqual({ name: 'react', version: '^19.0.0', depType: 'prod' });
    expect(deps).toContainEqual({ name: 'vitest', version: '^3.0.0', depType: 'dev' });
    expect(deps).toContainEqual({ name: 'typescript', version: '^5', depType: 'peer' });
    expect(parsePackageManifest('not json')).toEqual([]);
  });
});

describe('indexer', () => {
  it('full-scans a workspace into the store (files, fts, symbols, deps)', async () => {
    write('README.md', '# Hello\n\nThe indexer test document mentions chokidar.');
    write('src/index.ts', "import { a } from './lib';\nexport const entry = 1;");
    write('src/lib.ts', 'export const a = 2;');
    write('package.json', JSON.stringify({ name: 'fixture', dependencies: { react: '^19.0.0' } }));
    write('node_modules/react/index.js', 'ignored');

    const store = WorkspaceStore.open(dataDir, workspace);
    const indexer = new Indexer(store, workspace);
    const total = await indexer.fullScan();
    expect(total).toBe(4); // node_modules excluded

    expect(store.getFile('README.md')?.isMarkdown).toBe(true);
    expect(store.search('chokidar')[0]?.path).toBe('README.md');
    expect(store.allSymbols().map((s) => s.name)).toContain('entry');
    expect(store.allImports().find((i) => i.specifier === './lib')?.resolvedPath).toBe(
      'src/lib.ts',
    );
    expect(store.allDependencies()[0]).toMatchObject({ name: 'react' });
    store.close();
  });

  it('skips directories matched by a directory-only .gitignore rule', async () => {
    write('.gitignore', 'secret/\n');
    write('README.md', '# Docs');
    write('secret/creds.txt', 'do-not-index');

    const store = WorkspaceStore.open(dataDir, workspace);
    const indexer = new Indexer(store, workspace);
    const total = await indexer.fullScan();

    expect(total).toBe(2); // .gitignore + README.md; secret/ excluded
    expect(store.getFile('secret/creds.txt')).toBeNull();
    expect(store.search('do-not-index')).toHaveLength(0);
    store.close();
  });

  it('applies incremental changes and removals', async () => {
    write('a.md', 'alpha content');
    const store = WorkspaceStore.open(dataDir, workspace);
    const indexer = new Indexer(store, workspace);
    await indexer.fullScan();
    expect(store.search('alpha')).toHaveLength(1);

    write('a.md', 'bravo content');
    write('b.md', 'charlie content');
    await indexer.applyChanges(['a.md', 'b.md'], []);
    expect(store.search('alpha')).toHaveLength(0);
    expect(store.search('bravo')).toHaveLength(1);
    expect(store.search('charlie')).toHaveLength(1);

    unlinkSync(path.join(workspace, 'b.md'));
    await indexer.applyChanges([], ['b.md']);
    expect(store.search('charlie')).toHaveLength(0);
    expect(store.getFile('b.md')).toBeNull();
    store.close();
  });
});

describe('git log parsing', () => {
  it('parses commits with name-status file lists', () => {
    const F = '\u001f';
    const C = '\u001e';
    const raw =
      `${C}hash1${F}Alice${F}a@x.com${F}2026-01-02T00:00:00Z${F}feat: add watcher\n` +
      `M\tsrc/watcher.ts\nA\tsrc/new.ts\n\n` +
      `${C}hash2${F}Bob${F}b@x.com${F}2026-01-01T00:00:00Z${F}fix: renamed\n` +
      `R100\told.ts\tnew.ts\n`;
    const commits = parseLogWithFiles(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      hash: 'hash1',
      author: 'Alice',
      message: 'feat: add watcher',
    });
    expect(commits[0].files).toEqual([
      { status: 'M', path: 'src/watcher.ts' },
      { status: 'A', path: 'src/new.ts' },
    ]);
    // Renames record the post-rename path.
    expect(commits[1].files).toEqual([{ status: 'R100', path: 'new.ts' }]);
  });

  it('scopes Git history when the workspace is a child folder of a repository', async () => {
    execSync('git init -b main', { cwd: workspace, stdio: 'ignore' });
    const git = (cmd: string) =>
      execSync(`git -c user.email=e2e@test -c user.name=E2E ${cmd}`, {
        cwd: workspace,
        stdio: 'ignore',
      });

    write('README.md', 'root only\n');
    git('add .');
    git('commit -m "docs: root only"');

    const child = path.join(workspace, 'child');
    write('child/a.md', 'one\n');
    git('add .');
    git('commit -m "feat: child one"');

    write('sibling.md', 'sibling\n');
    git('add .');
    git('commit -m "feat: sibling"');

    write('child/a.md', 'two\n');
    git('add .');
    git('commit -m "feat: child two"');

    const service = new GitService(child);

    await expect(service.info()).resolves.toEqual({ isRepo: true, branch: 'main' });

    const commits = await service.recentCommits();
    expect(commits.map((commit) => commit.message)).toEqual(['feat: child two', 'feat: child one']);
    expect(commits[0].files).toEqual([{ status: 'M', path: 'a.md' }]);
    expect(commits[1].files).toEqual([{ status: 'A', path: 'a.md' }]);

    const fileHistory = await service.fileHistory('a.md');
    expect(fileHistory.map((commit) => commit.message)).toEqual([
      'feat: child two',
      'feat: child one',
    ]);

    const diff = await service.recentDiff();
    expect(diff).toContain('child/a.md');
    expect(diff).not.toContain('sibling.md');
  });
});
