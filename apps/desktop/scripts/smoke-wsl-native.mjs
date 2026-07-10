#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);

if (process.argv[2] === '--capture') {
  const url = process.argv[3] || '';
  if (!url.startsWith('livedocs://wsl/open?')) {
    console.error(`[livedocs-smoke] Expected livedocs:// URL, got ${url}`);
    process.exit(1);
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.get('distro') || !parsed.searchParams.get('path')) {
    console.error('[livedocs-smoke] URL is missing distro or path');
    process.exit(1);
  }
  console.log(`[livedocs-smoke] Captured ${url}`);
  process.exit(0);
}

const env = {
  ...process.env,
  WSL_DISTRO_NAME: process.env.WSL_DISTRO_NAME || 'LiveDocsSmoke',
  WSL_INTEROP: process.env.WSL_INTEROP || '1',
  LIVEDOCS_WINDOWS_LAUNCHER: process.env.LIVEDOCS_WINDOWS_LAUNCHER || process.execPath,
  LIVEDOCS_WINDOWS_LAUNCHER_ARGS:
    process.env.LIVEDOCS_WINDOWS_LAUNCHER_ARGS || JSON.stringify([thisFile, '--capture']),
};

const result = spawnSync(
  process.execPath,
  [new URL('./livedocs-wsl.mjs', import.meta.url).pathname, '.'],
  {
    env,
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
if ((result.status ?? 0) !== 0) process.exit(result.status ?? 0);

const dryRun = spawnSync(
  process.execPath,
  [new URL('./livedocs-wsl.mjs', import.meta.url).pathname, '.'],
  {
    env: {
      ...env,
      LIVEDOCS_PRINT_WINDOWS_LAUNCH_COMMAND: '1',
      LIVEDOCS_WINDOWS_LAUNCHER: '',
      LIVEDOCS_WINDOWS_LAUNCHER_ARGS: '',
    },
    encoding: 'utf8',
  },
);

if (dryRun.error) throw dryRun.error;
if ((dryRun.status ?? 0) !== 0) {
  console.error(dryRun.stderr);
  process.exit(dryRun.status ?? 1);
}

const launch = JSON.parse(dryRun.stdout);
const commandLine = launch.args.at(-1);
if (launch.command !== 'cmd.exe' || !commandLine.includes('"livedocs://wsl/open?')) {
  console.error('[livedocs-smoke] default launcher does not quote the URL');
  process.exit(1);
}
if (!commandLine.includes('&path=')) {
  console.error('[livedocs-smoke] default launcher command lost the path query parameter');
  process.exit(1);
}

const missingLauncher = spawnSync(
  process.execPath,
  [new URL('./livedocs-wsl.mjs', import.meta.url).pathname, '.'],
  {
    env: {
      ...env,
      LIVEDOCS_WINDOWS_LAUNCHER: '/definitely/missing/livedocs.exe',
      LIVEDOCS_WINDOWS_LAUNCHER_ARGS: '',
    },
    encoding: 'utf8',
  },
);

if ((missingLauncher.status ?? 0) === 0) {
  console.error('[livedocs-smoke] missing launcher unexpectedly succeeded');
  process.exit(1);
}
if (!missingLauncher.stderr.includes('Unable to invoke the Windows LiveDocs app')) {
  console.error('[livedocs-smoke] missing launcher diagnostic was not actionable');
  console.error(missingLauncher.stderr);
  process.exit(1);
}

console.log('[livedocs-smoke] WSL native launcher smoke ok');
