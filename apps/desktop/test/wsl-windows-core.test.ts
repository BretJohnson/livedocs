import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

// Runtime scripts are deliberately plain ESM so both Linux Node and Windows Node can run them.
// @ts-expect-error No declaration file is needed for the script-only module.
import * as core from '../scripts/wsl-windows-core.mjs';

const temporary: string[] = [];

function temp(name: string): string {
  const directory = path.join(
    tmpdir(),
    `livedocs-${name}-${process.pid}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(directory, { recursive: true });
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('WSL and mirror identity', () => {
  test('detects WSL through environment or kernel version', () => {
    expect(core.isWsl({ WSL_INTEROP: '/run/WSL/1' }, '')).toBe(true);
    expect(core.isWsl({}, 'Linux version microsoft-standard-WSL2')).toBe(true);
    expect(core.isWsl({}, 'Linux version generic')).toBe(false);
  });

  test('canonicalizes identities and keeps distro/path pairs distinct', () => {
    expect(core.canonicalPosixPath('/home/me/../me/repo')).toBe('/home/me/repo');
    expect(core.mirrorIdentity('Ubuntu', '/home/me/repo')).toBe(
      core.mirrorIdentity('Ubuntu', '/home/me/repo'),
    );
    expect(core.mirrorIdentity('Ubuntu', '/home/me/repo')).not.toBe(
      core.mirrorIdentity('Debian', '/home/me/repo'),
    );
    expect(core.mirrorIdentity('Ubuntu', '/home/me/repo')).not.toBe(
      core.mirrorIdentity('Ubuntu', '/home/me/other'),
    );
  });

  test('converts only absolute mounted drive paths', () => {
    expect(core.windowsPathToWsl('C:\\Users\\me\\mirror')).toBe('/mnt/c/Users/me/mirror');
    expect(core.wslPathToWindows('/mnt/d/cache/mirror')).toBe('D:\\cache\\mirror');
    expect(() => core.windowsPathToWsl('relative\\mirror')).toThrow('absolute Windows drive path');
    expect(() => core.wslPathToWindows('/home/me/repo')).toThrow('WSL-mounted Windows path');
  });

  test('rejects hostile paths and distro values', () => {
    const root = temp('containment');
    expect(() => core.containedPath(root, '../outside')).toThrow('escapes');
    expect(() => core.containedPath(root, '/absolute')).toThrow('escapes');
    expect(() => core.canonicalDistro('Ubuntu\n--evil')).toThrow('valid WSL distro');
  });
});

describe('authoritative source synchronization', () => {
  test('copies changes, removes stale source, and preserves Windows-owned paths', () => {
    const source = temp('source');
    const mirror = temp('mirror');
    writeFileSync(path.join(source, 'package.json'), '{"name":"fixture"}\n');
    mkdirSync(path.join(source, 'src'));
    writeFileSync(path.join(source, 'src', 'one.ts'), 'one');
    mkdirSync(path.join(source, 'node_modules'));
    writeFileSync(path.join(source, 'node_modules', 'linux.node'), 'linux');
    writeFileSync(path.join(source, '.env'), 'SECRET=yes');
    writeFileSync(path.join(source, '.env.example'), 'SAFE=yes');

    const owner = core.expectedOwner('Ubuntu', '/home/me/livedocs');
    core.ensureOwnedMirror(mirror, owner);
    mkdirSync(path.join(mirror, 'node_modules'));
    writeFileSync(path.join(mirror, 'node_modules', 'windows.node'), 'windows');

    const first = core.reconcileSource(source, mirror, owner);
    expect(first.copied).toBe(3);
    expect(readFileSync(path.join(mirror, 'src', 'one.ts'), 'utf8')).toBe('one');
    expect(readFileSync(path.join(mirror, '.env.example'), 'utf8')).toBe('SAFE=yes');
    expect(() => readFileSync(path.join(mirror, '.env'))).toThrow();

    writeFileSync(path.join(source, 'src', 'one.ts'), 'changed');
    writeFileSync(path.join(source, 'src', 'two.ts'), 'two');
    const second = core.reconcileSource(source, mirror, owner);
    expect(second.copied).toBe(2);
    expect(readFileSync(path.join(mirror, 'node_modules', 'windows.node'), 'utf8')).toBe('windows');

    rmSync(path.join(source, 'src', 'one.ts'));
    const third = core.reconcileSource(source, mirror, owner);
    expect(third.removed).toBe(1);
    expect(() => readFileSync(path.join(mirror, 'src', 'one.ts'))).toThrow();
  });

  test('ignores transient source disappearance during collection and copy', () => {
    const source = temp('transient-source');
    const mirror = temp('transient-mirror');
    writeFileSync(path.join(source, 'temporary.txt'), 'temporary');
    const missing = Object.assign(new Error('vanished'), { code: 'ENOENT' });
    expect(
      core.collectSourceFiles(source, {
        readDetails: () => {
          throw missing;
        },
      }).size,
    ).toBe(0);

    const owner = core.expectedOwner('Ubuntu', '/home/me/transient');
    core.ensureOwnedMirror(mirror, owner);
    const result = core.reconcileSource(source, mirror, owner, {
      copyFile: () => {
        throw missing;
      },
    });
    expect(result.copied).toBe(0);
    expect(result.total).toBe(0);
  });

  test('uses fast metadata reconciliation incrementally and full verification initially', () => {
    const source = temp('incremental-source');
    const mirror = temp('incremental-mirror');
    writeFileSync(path.join(source, 'source.txt'), 'authoritative');
    const owner = core.expectedOwner('Ubuntu', '/home/me/incremental');
    core.ensureOwnedMirror(mirror, owner);
    core.reconcileSource(source, mirror, owner);

    writeFileSync(path.join(mirror, 'source.txt'), 'unsupported mirror edit');
    expect(core.reconcileSource(source, mirror, owner, { incremental: true }).copied).toBe(0);
    expect(readFileSync(path.join(mirror, 'source.txt'), 'utf8')).toBe('unsupported mirror edit');
    expect(core.reconcileSource(source, mirror, owner).copied).toBe(1);
    expect(readFileSync(path.join(mirror, 'source.txt'), 'utf8')).toBe('authoritative');
  });

  test('refuses incompatible ownership and unsafe cleanup', () => {
    const mirror = temp('owned');
    const owner = core.expectedOwner('Ubuntu', '/home/me/one');
    core.ensureOwnedMirror(mirror, owner);
    expect(() =>
      core.assertOwnedMirror(mirror, core.expectedOwner('Ubuntu', '/home/me/two')),
    ).toThrow('unowned or incompatible');
  });
});

describe('dependency and command behavior', () => {
  test('invalidates the dependency fingerprint for manifests or Windows ABI', () => {
    const source = temp('fingerprint');
    mkdirSync(path.join(source, 'apps', 'desktop'), { recursive: true });
    writeFileSync(path.join(source, 'package.json'), '{"packageManager":"pnpm@11.11.0"}');
    writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    writeFileSync(path.join(source, 'apps', 'desktop', 'package.json'), '{"name":"desktop"}');
    const windows = { nodeVersion: '24.1.0', nodeAbi: '137', pnpmVersion: '11.11.0' };
    const first = core.dependencyFingerprint(source, windows);
    expect(core.dependencyFingerprint(source, windows)).toBe(first);
    writeFileSync(
      path.join(source, 'apps', 'desktop', 'package.json'),
      '{"name":"desktop","version":"2"}',
    );
    expect(core.dependencyFingerprint(source, windows)).not.toBe(first);
    expect(core.dependencyFingerprint(source, { ...windows, nodeAbi: '999' })).not.toBe(first);
  });

  test('selects fixed build commands and diagnoses prerequisites', () => {
    expect(core.windowsCommandForMode('dev')).toEqual(['--filter', '@livedocs/desktop', 'dev']);
    expect(core.windowsCommandForMode('build')).toEqual(['--filter', '@livedocs/desktop', 'build']);
    expect(core.windowsCommandForMode('dist')).toEqual([
      '--filter',
      '@livedocs/desktop',
      'dist:win',
    ]);
    expect(() => core.windowsCommandForMode('clean')).toThrow();
    expect(core.validatePrerequisites({}, '11.11.0', 'dev')).toContain('Windows Node.js');
    expect(
      core.validatePrerequisites(
        {
          nodePath: 'node.exe',
          nodeVersion: '24',
          nodeAbi: '137',
          pnpmVersion: '10',
          pnpmJsPath: 'pnpm.js',
          localAppData: 'C:\\Users\\me',
          buildTools: true,
        },
        '11.11.0',
        'dev',
      ),
    ).toContain('Windows pnpm 11.11.0 (found 10)');
  });

  test('accepts every public mode and rejects arbitrary input', () => {
    for (const mode of ['dev', 'build', 'dist', 'launch', 'clean'])
      expect(core.parseMode(mode)).toBe(mode);
    expect(() => core.parseMode('dev; rm -rf /')).toThrow('Unknown mode');
  });

  test('uses one exclusion policy for source synchronization and watching', () => {
    for (const excluded of ['.hg/store', '.svn/entries', '.env', 'debug.log', '.DS_Store'])
      expect(core.shouldSync(excluded, false)).toBe(false);
    expect(core.shouldSync('.env.example', false)).toBe(true);
  });
});
