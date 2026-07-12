import { spawn } from 'node:child_process';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} ${args.join(' ')} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`,
          ),
        );
    });
  });
}

export async function prepareWslAgent({ repoRoot, snapshot, run = runCommand }) {
  await run('pnpm', ['--filter', '@livedocs/desktop', 'build'], { cwd: repoRoot });
  await run('pnpm', ['--filter', '@livedocs/desktop', 'install:wsl-launcher'], {
    cwd: repoRoot,
    env: { ...process.env, LIVEDOCS_SOURCE_SNAPSHOT: snapshot },
  });
}

export function createWindowsSession({
  session,
  distro,
  sourcePath,
  mirrorWindows,
  owner,
  pinnedPnpm,
  pnpmJsPath,
}) {
  return {
    ...session,
    format: 1,
    distro,
    sourcePath,
    mirrorRoot: mirrorWindows,
    owner,
    pnpmVersion: pinnedPnpm,
    pnpmJsPath,
    artifacts: {
      build: path.win32.join(mirrorWindows, 'apps', 'desktop', 'out'),
      dist: path.win32.join(mirrorWindows, 'apps', 'desktop', 'release'),
    },
  };
}

export function runManagedInterop({
  command,
  args,
  watcherFailure,
  signalEmitter = process,
  shutdownTimeoutMs = 5000,
  spawnOptions = {},
}) {
  const child = spawn(command, args, {
    ...spawnOptions,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  let interrupted = false;
  let stopping = false;
  let forceTimer;

  const requestStop = () => {
    if (stopping) return;
    stopping = true;
    child.stdin?.end();
    forceTimer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    }, shutdownTimeoutMs);
    forceTimer.unref?.();
  };
  const onSignal = () => {
    interrupted = true;
    requestStop();
  };
  signalEmitter.once('SIGINT', onSignal);
  signalEmitter.once('SIGTERM', onSignal);

  const childExit = new Promise((resolve, reject) => {
    child.stdin?.on('error', (error) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  const watcherOutcome = watcherFailure?.then(
    () => ({ type: 'watcher-complete' }),
    (error) => ({ type: 'watcher-error', error }),
  );

  return (async () => {
    try {
      const outcome = watcherOutcome
        ? await Promise.race([childExit, watcherOutcome])
        : await childExit;
      if (typeof outcome === 'object') {
        requestStop();
        await childExit;
        if (outcome.type === 'watcher-error') throw outcome.error;
        throw new Error('Source watcher stopped before the Windows process exited.');
      }
      return interrupted ? 130 : outcome;
    } finally {
      clearTimeout(forceTimer);
      signalEmitter.removeListener('SIGINT', onSignal);
      signalEmitter.removeListener('SIGTERM', onSignal);
    }
  })();
}
