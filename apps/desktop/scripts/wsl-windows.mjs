#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import {
  METADATA_DIR,
  SESSION_FILE,
  canonicalDistro,
  canonicalPosixPath,
  dependencyFingerprint,
  ensureOwnedMirror,
  expectedOwner,
  isWsl,
  listOwnedMirrors,
  mirrorIdentity,
  parseMode,
  parsePackageManager,
  readJson,
  reconcileSource,
  removeOwnedMirror,
  shouldSync,
  windowsPathToWsl,
  wslPathToWindows,
  validatePrerequisites,
} from './wsl-windows-core.mjs';
import {
  createWindowsSession,
  prepareWslAgent,
  runManagedInterop,
} from './wsl-windows-process.mjs';

const mode = parseMode(process.argv[2]);
const flags = new Set(process.argv.slice(3));
const repoRoot = realpathSync(path.resolve(import.meta.dirname, '../../..'));
const procVersion = existsSync('/proc/version') ? readFileSync('/proc/version', 'utf8') : '';

if (!isWsl(process.env, procVersion) && process.env.LIVEDOCS_WSL_WINDOWS_TEST !== '1') {
  fail('This command must run inside WSL. Use `pnpm dev` for the current platform.');
}

const distro = canonicalDistro(process.env.LIVEDOCS_WSL_DISTRO || process.env.WSL_DISTRO_NAME);
const sourcePath = canonicalPosixPath(
  process.env.LIVEDOCS_WSL_SOURCE || repoRoot.replaceAll('\\', '/'),
);
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const pinnedPnpm = parsePackageManager(packageJson);
const prerequisites = discoverWindowsPrerequisites();
const missingPrerequisites = validatePrerequisites(prerequisites, pinnedPnpm, mode);
if (missingPrerequisites.length)
  fail(
    `Missing Windows prerequisites: ${missingPrerequisites.join(', ')}. See docs/developer-setup.md.`,
  );

const configuredRoot =
  process.env.LIVEDOCS_WINDOWS_MIRROR_ROOT ||
  path.win32.join(prerequisites.localAppData, 'LiveDocs', 'dev-mirrors');
const mirrorBase = configuredRoot.startsWith('/')
  ? configuredRoot
  : windowsPathToWsl(configuredRoot);
const identity = mirrorIdentity(distro, sourcePath);
const mirrorRoot = path.join(mirrorBase, identity);
const mirrorWindows = wslPathToWindows(mirrorRoot);
const owner = expectedOwner(distro, sourcePath);
let watcher;

if (mode === 'clean') {
  if (flags.has('--list')) {
    const mirrors = listOwnedMirrors(mirrorBase);
    if (mirrors.length === 0) console.log('[livedocs] No generated Windows mirrors found.');
    for (const entry of mirrors)
      console.log(`${entry.root}\t${entry.owner.distro}:${entry.owner.sourcePath}`);
    process.exit(0);
  }
  if (!existsSync(mirrorRoot)) {
    console.log(`[livedocs] No mirror exists for ${distro}:${sourcePath}.`);
    process.exit(0);
  }
  removeOwnedMirror(mirrorRoot, owner);
  console.log(`[livedocs] Removed generated Windows mirror ${mirrorRoot}`);
  process.exit(0);
}

ensureOwnedMirror(mirrorRoot, owner);

if (mode === 'launch') {
  const snapshot = readJson(path.join(mirrorRoot, METADATA_DIR, 'source-manifest.json'))?.snapshot;
  if (!snapshot)
    fail(
      'No compatible Windows development build exists. Run `pnpm dev:windows-from-wsl` or `pnpm build:windows-from-wsl` first.',
    );
  process.exit(await runWindowsHelper({ mode, snapshot }));
}

try {
  if (mode === 'dev') watcher = await startBufferedWatcher();
  const sync = reconcileSource(repoRoot, mirrorRoot, owner);
  if (watcher) await watcher.flush();
  console.log(
    `[livedocs] Windows mirror synchronized (${sync.copied} copied, ${sync.removed} removed, snapshot ${sync.snapshot.slice(0, 12)}).`,
  );

  if (mode === 'dev') {
    console.log('[livedocs] Building and installing the WSL agent with Linux dependencies...');
    await prepareWslAgent({ repoRoot, snapshot: sync.snapshot });
  }
  const fingerprint = dependencyFingerprint(repoRoot, prerequisites);
  const exitCode = await runWindowsHelper({ mode, snapshot: sync.snapshot, fingerprint });
  process.exitCode = exitCode;
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), false);
} finally {
  await watcher?.close();
}

async function startBufferedWatcher() {
  const { watch } = await import('chokidar');
  let timer;
  let rejectFailure;
  let stopped = false;
  const failure = new Promise((_, reject) => (rejectFailure = reject));
  failure.catch(() => {});
  const instance = watch(repoRoot, {
    ignoreInitial: true,
    ignored: (candidate) => {
      const relative = path.relative(repoRoot, candidate).replaceAll('\\', '/');
      return relative && !isWatchCandidate(relative);
    },
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  });
  const flush = () => {
    if (stopped) return Promise.resolve();
    try {
      const result = reconcileSource(repoRoot, mirrorRoot, owner, { incremental: true });
      if (result.copied || result.removed)
        console.log(
          `[livedocs] Mirror updated (${result.copied} copied, ${result.removed} removed).`,
        );
      return Promise.resolve(result);
    } catch (error) {
      rejectFailure(
        new Error(
          `Source synchronization failed from ${repoRoot} to ${mirrorRoot}: ${error.message}`,
        ),
      );
      return Promise.reject(error);
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush().catch(() => {}), 75);
  };
  instance.on('all', schedule);
  instance.on('error', (error) =>
    rejectFailure(new Error(`Source watcher failed for ${repoRoot}: ${error.message}`)),
  );
  await new Promise((resolve, reject) => instance.once('ready', resolve).once('error', reject));
  return {
    failure,
    flush,
    async close() {
      stopped = true;
      clearTimeout(timer);
      await instance.close();
    },
  };
}

function isWatchCandidate(relative) {
  return shouldSync(relative, false);
}

async function runWindowsHelper(session) {
  const sessionData = createWindowsSession({
    session,
    distro,
    sourcePath,
    mirrorWindows,
    owner,
    pinnedPnpm,
    pnpmJsPath: prerequisites.pnpmJsPath,
  });
  writeFileSync(path.join(mirrorRoot, SESSION_FILE), `${JSON.stringify(sessionData, null, 2)}\n`);
  const helper = path.win32.join(
    mirrorWindows,
    'apps',
    'desktop',
    'scripts',
    'wsl-windows-helper.mjs',
  );
  const sessionPath = path.win32.join(mirrorWindows, ...SESSION_FILE.split('/'));
  console.log(`[livedocs] Starting Windows ${session.mode} from ${mirrorWindows}`);
  const windowsNodeInteropPath = windowsPathToWsl(prerequisites.nodePath);
  return runManagedInterop({
    command: windowsNodeInteropPath,
    args: [helper, sessionPath],
    watcherFailure: watcher?.failure,
    spawnOptions: { windowsHide: false },
  });
}

function discoverWindowsPrerequisites() {
  if (process.env.LIVEDOCS_WINDOWS_PREREQUISITES_JSON)
    return JSON.parse(process.env.LIVEDOCS_WINDOWS_PREREQUISITES_JSON);
  const script = [
    "$ErrorActionPreference='Stop'",
    '$node=(Get-Command node.exe -ErrorAction Stop).Source',
    '$pnpm=(Get-Command pnpm.cmd -ErrorAction SilentlyContinue)',
    'if (-not $pnpm) { $pnpm=(Get-Command pnpm.exe -ErrorAction SilentlyContinue) }',
    "if (-not $pnpm) { throw 'pnpm.cmd was not found on the Windows PATH' }",
    '$pnpmRoot=Split-Path $pnpm.Source',
    "$pnpmCandidates=@((Join-Path $pnpmRoot 'node_modules/corepack/dist/pnpm.js'),(Join-Path $pnpmRoot 'node_modules/pnpm/bin/pnpm.cjs'))",
    '$pnpmJs=$pnpmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1',
    "if (-not $pnpmJs) { throw 'The pnpm JavaScript entrypoint was not found beside pnpm.cmd' }",
    "$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'",
    '$hasVs=(Test-Path $vswhere) -or [bool](Get-Command cl.exe -ErrorAction SilentlyContinue)',
    "[ordered]@{nodePath=$node;nodeVersion=(& $node -p 'process.versions.node');nodeAbi=(& $node -p 'process.versions.modules');pnpmPath=$pnpm.Source;pnpmJsPath=$pnpmJs;pnpmVersion=(& $pnpm.Source --version);buildTools=$hasVs;localAppData=[Environment]::GetFolderPath('LocalApplicationData')} | ConvertTo-Json -Compress",
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    fail(
      `Windows prerequisites could not be discovered through WSL interop. Ensure powershell.exe, Windows Node.js, and pnpm are on the Windows PATH. ${result.stderr?.trim() || result.error?.message || ''}`,
    );
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail(`Windows prerequisite discovery returned invalid output: ${result.stdout.trim()}`);
  }
}

function fail(message, exit = true) {
  console.error(`[livedocs] ${message}`);
  if (exit) process.exit(1);
  process.exitCode = 1;
}
