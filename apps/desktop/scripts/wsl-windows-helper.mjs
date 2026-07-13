#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import {
  FINGERPRINT_FILE,
  assertOwnedMirror,
  containedPath,
  readJson,
  windowsCommandForMode,
} from './wsl-windows-core.mjs';

let activeChild;
let terminationRequested = false;
const terminate = () => {
  terminationRequested = true;
  if (activeChild?.pid != null)
    spawnSync('taskkill.exe', ['/PID', String(activeChild.pid), '/T', '/F'], { stdio: 'ignore' });
};

function cleanupExitedChildDescendants(parentPid) {
  const script = [
    '$root=[int]$args[0]',
    '$all=@(Get-CimInstance Win32_Process)',
    '$parents=@($root)',
    '$descendants=@()',
    'do {',
    '  $next=@($all | Where-Object { $parents -contains [int]$_.ParentProcessId -and $descendants -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })',
    '  $descendants += $next',
    '  $parents = $next',
    '} while ($next.Count -gt 0)',
    'if ($descendants.Count -gt 0) { Stop-Process -Id $descendants -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script, String(parentPid)],
    { stdio: 'ignore' },
  );
}
process.stdin.resume();
process.stdin.once('end', terminate);
process.stdin.once('close', terminate);
process.once('SIGINT', terminate);
process.once('SIGTERM', terminate);

if (process.platform !== 'win32' && process.env.LIVEDOCS_WINDOWS_HELPER_TEST !== '1') {
  fail('The LiveDocs Windows helper must run with Windows Node.js.');
}
const sessionPath = process.argv[2];
if (!sessionPath) fail('The Windows helper requires a session JSON path.');
const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
assertOwnedMirror(session.mirrorRoot, session.owner);

if (session.mode === 'launch') {
  await launchExisting();
  process.exit(0);
}

const fingerprintPath = containedPath(session.mirrorRoot, FINGERPRINT_FILE);
const existing = readJson(fingerprintPath);
if (existing?.fingerprint !== session.fingerprint) {
  console.log(`[livedocs] Preparing Windows dependencies with pnpm ${session.pnpmVersion}...`);
  await runPnpm([
    'install',
    '--no-frozen-lockfile',
    '--store-dir',
    path.join(session.mirrorRoot, '.livedocs-mirror', 'pnpm-store'),
  ]);
  writeFileSync(
    fingerprintPath,
    `${JSON.stringify({ format: session.format, fingerprint: session.fingerprint, node: process.versions.node, abi: process.versions.modules }, null, 2)}\n`,
  );
} else {
  console.log(
    `[livedocs] Reusing compatible Windows dependencies (${session.fingerprint.slice(0, 12)}).`,
  );
}

const args = windowsCommandForMode(session.mode);
const code = await runPnpm(args, { workspace: true });
if (session.mode === 'build')
  console.log(`[livedocs] Windows build output: ${session.artifacts.build}`);
if (session.mode === 'dist')
  console.log(`[livedocs] Windows installer output: ${session.artifacts.dist}`);
process.exit(code);

async function launchExisting() {
  const builtMain = path.join(session.mirrorRoot, 'apps', 'desktop', 'out', 'main', 'index.js');
  if (existsSync(builtMain)) {
    await runPnpm(['--filter', '@livedocs/desktop', 'preview'], { workspace: true });
    return;
  }
  const registered = spawnSync('reg.exe', ['query', 'HKCU\\Software\\Classes\\livedocs'], {
    stdio: 'ignore',
  });
  if (registered.status !== 0)
    fail('No compatible development build or registered LiveDocs Windows app is available.');
  const command = `start "" "${workspaceUrl().replaceAll('"', '""')}"`;
  const launched = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    stdio: 'ignore',
  });
  if (launched.status !== 0) fail('The registered LiveDocs Windows app could not be launched.');
}

function workspaceUrl() {
  const url = new URL('livedocs://wsl/open');
  url.searchParams.set('distro', session.distro);
  url.searchParams.set('path', session.sourcePath);
  return url.toString();
}

function runPnpm(args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      LIVEDOCS_SOURCE_SNAPSHOT: session.snapshot,
      LIVEDOCS_WORKSPACE: workspaceUrl(),
      ...(!options.workspace && !process.env.CI ? { CI: 'true' } : {}),
    };
    const child = spawn(process.execPath, [session.pnpmJsPath, ...args], {
      cwd: session.mirrorRoot,
      env,
      stdio: 'inherit',
      windowsHide: false,
    });
    activeChild = child;
    const childPid = child.pid;
    if (terminationRequested) terminate();
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      activeChild = undefined;
      if (childPid != null) cleanupExitedChildDescendants(childPid);
      if (!options.workspace && code !== 0)
        reject(
          new Error(
            `Windows pnpm install failed with exit code ${code}. Check Python and Visual Studio Build Tools.`,
          ),
        );
      else resolve(signal ? 1 : (code ?? 1));
    });
  });
}

function fail(message) {
  console.error(`[livedocs] ${message}`);
  process.exit(1);
}
