#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  FINGERPRINT_FILE,
  containedPath,
  ensureOwnedMirror,
  expectedOwner,
  windowsPathToWsl,
  wslPathToWindows,
} from './wsl-windows-core.mjs';
import { runManagedInterop } from './wsl-windows-process.mjs';

const isWsl =
  Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) ||
  (existsSync('/proc/version') && /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8')));
if (!isWsl) {
  console.log('[livedocs-smoke] Skipped real WSL+Windows smoke: run this command inside WSL.');
  process.exit(0);
}
if (process.env.LIVEDOCS_RUN_WSL_WINDOWS_INTEGRATION !== '1') {
  console.log(
    '[livedocs-smoke] Real WSL+Windows smoke is opt-in; set LIVEDOCS_RUN_WSL_WINDOWS_INTEGRATION=1.',
  );
  process.exit(0);
}

await runLifecycleBoundarySmoke();
if (process.env.LIVEDOCS_WSL_WINDOWS_LIFECYCLE_ONLY === '1') process.exit(0);

run(process.execPath, [fileURLToPath(new URL('./wsl-windows.mjs', import.meta.url)), 'build']);
run('pnpm', ['--filter', '@livedocs/desktop', 'build']);
run('pnpm', ['--filter', '@livedocs/desktop', 'install:wsl-launcher']);
run(process.execPath, [fileURLToPath(new URL('./smoke-wsl-agent.mjs', import.meta.url))]);
run(process.execPath, [fileURLToPath(new URL('./smoke-wsl-windows.mjs', import.meta.url))]);
console.log('[livedocs-smoke] Real WSL agent + native Windows build boundary smoke ok');

async function runLifecycleBoundarySmoke() {
  const discovery = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[ordered]@{node=(Get-Command node.exe -ErrorAction Stop).Source;temp=[IO.Path]::GetTempPath()} | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8' },
  );
  if (discovery.status !== 0)
    throw new Error(`Windows lifecycle prerequisite discovery failed: ${discovery.stderr.trim()}`);
  const windows = JSON.parse(discovery.stdout.trim());
  const mirrorWindows = path.win32.join(
    windows.temp,
    `livedocs-wsl-lifecycle-${process.pid}-${Date.now()}`,
  );
  const mirrorWsl = windowsPathToWsl(mirrorWindows);
  const scriptsWsl = path.join(mirrorWsl, 'apps', 'desktop', 'scripts');
  const scriptsWindows = path.win32.join(mirrorWindows, 'apps', 'desktop', 'scripts');
  const pidFileWsl = path.join(mirrorWsl, 'pids.json');
  const owner = expectedOwner(
    process.env.WSL_DISTRO_NAME || 'WSL',
    '/tmp/livedocs-lifecycle-smoke',
  );

  try {
    ensureOwnedMirror(mirrorWsl, owner);
    mkdirSync(scriptsWsl, { recursive: true });
    for (const script of ['wsl-windows-core.mjs', 'wsl-windows-helper.mjs'])
      writeFileSync(
        path.join(scriptsWsl, script),
        readFileSync(fileURLToPath(new URL(script, import.meta.url))),
      );
    const fakePnpmWsl = path.join(scriptsWsl, 'fake-pnpm.mjs');
    writeFileSync(
      fakePnpmWsl,
      `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nwriteFileSync(${JSON.stringify(wslPathToWindows(pidFileWsl))}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));\nsetInterval(() => {}, 1000);\n`,
    );
    const fingerprint = 'lifecycle-smoke';
    writeFileSync(
      containedPath(mirrorWsl, FINGERPRINT_FILE),
      `${JSON.stringify({ format: 1, fingerprint })}\n`,
    );
    const sessionWsl = path.join(mirrorWsl, '.livedocs-mirror', 'lifecycle-session.json');
    const sessionWindows = wslPathToWindows(sessionWsl);
    writeFileSync(
      sessionWsl,
      JSON.stringify({
        mode: 'dev',
        format: 1,
        fingerprint,
        snapshot: 'lifecycle-snapshot',
        distro: owner.distro,
        sourcePath: owner.sourcePath,
        mirrorRoot: mirrorWindows,
        owner,
        pnpmVersion: 'smoke',
        pnpmJsPath: path.win32.join(scriptsWindows, 'fake-pnpm.mjs'),
        artifacts: {},
      }),
    );
    const signals = new EventEmitter();
    const running = runManagedInterop({
      command: windowsPathToWsl(windows.node),
      args: [path.win32.join(scriptsWindows, 'wsl-windows-helper.mjs'), sessionWindows],
      signalEmitter: signals,
      shutdownTimeoutMs: 5000,
    });
    for (let attempt = 0; attempt < 100 && !existsSync(pidFileWsl); attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!existsSync(pidFileWsl)) throw new Error('Windows lifecycle helper did not start.');
    const pids = JSON.parse(readFileSync(pidFileWsl, 'utf8'));
    signals.emit('SIGINT');
    const exitCode = await running;
    if (exitCode !== 130) throw new Error(`Lifecycle interruption returned ${exitCode}, not 130.`);
    const remaining = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `@(Get-Process -Id ${pids.parent},${pids.descendant} -ErrorAction SilentlyContinue).Count`,
      ],
      { encoding: 'utf8' },
    );
    if (remaining.status !== 0 || Number(remaining.stdout.trim()) !== 0)
      throw new Error(`Windows lifecycle smoke left a process behind: ${remaining.stdout.trim()}`);

    rmSync(pidFileWsl, { force: true });
    writeFileSync(
      fakePnpmWsl,
      `import { spawn } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nwriteFileSync(${JSON.stringify(wslPathToWindows(pidFileWsl))}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));\nsetTimeout(() => process.exit(23), 100);\n`,
    );
    const unexpectedExit = runManagedInterop({
      command: windowsPathToWsl(windows.node),
      args: [path.win32.join(scriptsWindows, 'wsl-windows-helper.mjs'), sessionWindows],
      shutdownTimeoutMs: 5000,
    });
    for (let attempt = 0; attempt < 100 && !existsSync(pidFileWsl); attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!existsSync(pidFileWsl)) throw new Error('Unexpected-exit lifecycle helper did not start.');
    const unexpectedPids = JSON.parse(readFileSync(pidFileWsl, 'utf8'));
    const unexpectedCode = await unexpectedExit;
    if (unexpectedCode !== 23)
      throw new Error(`Unexpected Windows exit returned ${unexpectedCode}, not 23.`);
    const unexpectedRemaining = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `@(Get-Process -Id ${unexpectedPids.parent},${unexpectedPids.descendant} -ErrorAction SilentlyContinue).Count`,
      ],
      { encoding: 'utf8' },
    );
    if (unexpectedRemaining.status !== 0 || Number(unexpectedRemaining.stdout.trim()) !== 0)
      throw new Error(
        `Unexpected Windows exit left a process behind: ${unexpectedRemaining.stdout.trim()}`,
      );
    console.log(
      '[livedocs-smoke] Real WSL interop interruption, unexpected exit, and descendant cleanup ok',
    );
  } finally {
    rmSync(mirrorWsl, { recursive: true, force: true });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
