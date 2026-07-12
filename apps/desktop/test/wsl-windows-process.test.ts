import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

// Runtime scripts are deliberately plain ESM so both Linux Node and Windows Node can run them.
// @ts-expect-error No declaration file is needed for the script-only module.
import * as processes from '../scripts/wsl-windows-process.mjs';
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

describe('cross-environment process lifecycle', () => {
  test('transports structured arguments and returns a normal child exit', async () => {
    const root = temp('process-arguments');
    const record = path.join(root, 'record.json');
    const helper = path.join(root, 'helper.mjs');
    writeFileSync(
      helper,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\nprocess.exit(7);\n`,
    );
    const args = ['space value', 'quote"value', 'Ubuntu Dev', '/home/me/repo'];
    await expect(
      processes.runManagedInterop({
        command: process.execPath,
        args: [helper, record, ...args],
      }),
    ).resolves.toBe(7);
    expect(JSON.parse(readFileSync(record, 'utf8'))).toEqual(args);
  });

  test('closes the helper control pipe on interruption and reports 130', async () => {
    const root = temp('process-interrupt');
    const record = path.join(root, 'stopped.txt');
    const helper = path.join(root, 'helper.mjs');
    writeFileSync(
      helper,
      `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);\nprocess.stdin.resume();\nprocess.stdin.once('end', () => { descendant.once('exit', () => { writeFileSync(process.argv[2], JSON.stringify({ stopped: true, descendant: descendant.pid })); process.exit(0); }); descendant.kill('SIGTERM'); });\nsetInterval(() => {}, 1000);\n`,
    );
    const signals = new EventEmitter();
    const running = processes.runManagedInterop({
      command: process.execPath,
      args: [helper, record],
      signalEmitter: signals,
      shutdownTimeoutMs: 1000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    signals.emit('SIGINT');
    await expect(running).resolves.toBe(130);
    const stopped = JSON.parse(readFileSync(record, 'utf8'));
    expect(stopped.stopped).toBe(true);
    expect(() => process.kill(stopped.descendant, 0)).toThrow();
  });

  test('stops the helper before propagating a watcher failure', async () => {
    const root = temp('process-watcher');
    const record = path.join(root, 'stopped.txt');
    const helper = path.join(root, 'helper.mjs');
    writeFileSync(
      helper,
      `import { writeFileSync } from 'node:fs';\nprocess.stdin.resume();\nprocess.stdin.once('end', () => { writeFileSync(process.argv[2], 'stopped'); process.exit(0); });\nsetInterval(() => {}, 1000);\n`,
    );
    let rejectWatcher!: (error: Error) => void;
    const watcherFailure = new Promise<never>((_, reject) => (rejectWatcher = reject));
    const running = processes.runManagedInterop({
      command: process.execPath,
      args: [helper, record],
      watcherFailure,
      shutdownTimeoutMs: 1000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    rejectWatcher(new Error('watch failed'));
    await expect(running).rejects.toThrow('watch failed');
    expect(readFileSync(record, 'utf8')).toBe('stopped');
  });
});

describe('agent and session preparation', () => {
  test('does not install the WSL launcher after an agent build failure', async () => {
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]) => {
      calls.push(args);
      throw new Error('agent build failed');
    };
    await expect(
      processes.prepareWslAgent({ repoRoot: '/repo', snapshot: 'snapshot', run }),
    ).rejects.toThrow('agent build failed');
    expect(calls).toEqual([['--filter', '@livedocs/desktop', 'build']]);
  });

  test('preserves workspace identity and snapshot in structured session data', () => {
    const session = processes.createWindowsSession({
      session: { mode: 'dev', snapshot: 'abc123', fingerprint: 'fingerprint' },
      distro: 'Ubuntu Dev',
      sourcePath: '/home/me/Live Docs',
      mirrorWindows: 'C:\\Users\\me\\mirror',
      owner: { identity: 'owner' },
      pinnedPnpm: '11.11.0',
      pnpmJsPath: 'C:\\pnpm.js',
    });
    expect(session).toMatchObject({
      mode: 'dev',
      snapshot: 'abc123',
      distro: 'Ubuntu Dev',
      sourcePath: '/home/me/Live Docs',
      mirrorRoot: 'C:\\Users\\me\\mirror',
      pnpmVersion: '11.11.0',
    });
    expect(session.artifacts.dist).toBe('C:\\Users\\me\\mirror\\apps\\desktop\\release');
  });

  test('reuses a compatible Windows dependency cache without touching Linux dependencies', async () => {
    const root = temp('helper-cache');
    const source = path.join(root, 'source');
    const mirror = path.join(root, 'mirror');
    const log = path.join(root, 'pnpm-log.jsonl');
    const fakePnpm = path.join(root, 'fake-pnpm.mjs');
    const sessionPath = path.join(root, 'session.json');
    mkdirSync(path.join(source, 'node_modules'), { recursive: true });
    writeFileSync(path.join(source, 'node_modules', 'linux.marker'), 'linux');
    const owner = core.expectedOwner('Ubuntu Dev', '/home/me/Live Docs');
    core.ensureOwnedMirror(mirror, owner);
    writeFileSync(
      fakePnpm,
      `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';\nimport path from 'node:path';\nconst args = process.argv.slice(2);\nappendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify({ args, snapshot: process.env.LIVEDOCS_SOURCE_SNAPSHOT, workspace: process.env.LIVEDOCS_WORKSPACE }) + '\\n');\nif (args[0] === 'install') { mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true }); writeFileSync(path.join(process.cwd(), 'node_modules', 'windows.marker'), 'windows'); }\n`,
    );
    writeFileSync(
      sessionPath,
      JSON.stringify({
        mode: 'build',
        format: core.MIRROR_FORMAT,
        fingerprint: 'compatible-fingerprint',
        snapshot: 'shared-snapshot',
        distro: 'Ubuntu Dev',
        sourcePath: '/home/me/Live Docs',
        mirrorRoot: mirror,
        owner,
        pnpmVersion: '11.11.0',
        pnpmJsPath: fakePnpm,
        artifacts: { build: path.join(mirror, 'apps', 'desktop', 'out') },
      }),
    );

    const helper = path.resolve(import.meta.dirname, '../scripts/wsl-windows-helper.mjs');
    const runHelper = () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [helper, sessionPath], {
          env: {
            ...process.env,
            LIVEDOCS_WINDOWS_HELPER_TEST: '1',
            FAKE_PNPM_LOG: log,
          },
          stdio: ['pipe', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`helper exited ${code}: ${stderr}`)),
        );
      });

    await runHelper();
    await runHelper();
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.args[0] === 'install')).toHaveLength(1);
    expect(calls.filter((call) => call.args.includes('build'))).toHaveLength(2);
    expect(calls.every((call) => call.snapshot === 'shared-snapshot')).toBe(true);
    expect(calls[0].workspace).toContain('distro=Ubuntu+Dev');
    expect(readFileSync(path.join(source, 'node_modules', 'linux.marker'), 'utf8')).toBe('linux');
    expect(readFileSync(path.join(mirror, 'node_modules', 'windows.marker'), 'utf8')).toBe(
      'windows',
    );
  });
});
