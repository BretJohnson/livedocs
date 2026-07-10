#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { URL } from 'node:url';

function detectDistro() {
  return process.env.WSL_DISTRO_NAME || process.env.LIVEDOCS_WSL_DISTRO || null;
}

function isWsl() {
  return Boolean(process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME);
}

function launchUrl(distro, workspacePath) {
  const url = new URL('livedocs://wsl/open');
  url.searchParams.set('distro', distro);
  url.searchParams.set('path', workspacePath);
  return url.toString();
}

function defaultWindowsLaunchCommand(url) {
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `start "" "${url.replace(/"/g, '""')}"`],
  };
}

function fail(message) {
  console.error(`[livedocs] ${message}`);
  process.exit(1);
}

const distro = detectDistro();
if (!isWsl() || !distro) {
  fail('Run this launcher inside WSL, or set LIVEDOCS_WSL_DISTRO for diagnostics.');
}

const workspacePath = path.posix.resolve(process.cwd(), process.argv[2] || '.');
const url = launchUrl(distro, workspacePath);
const override = process.env.LIVEDOCS_WINDOWS_LAUNCHER;
const overrideArgs = process.env.LIVEDOCS_WINDOWS_LAUNCHER_ARGS
  ? JSON.parse(process.env.LIVEDOCS_WINDOWS_LAUNCHER_ARGS)
  : [];
const defaultLaunch = defaultWindowsLaunchCommand(url);

if (process.env.LIVEDOCS_PRINT_WINDOWS_LAUNCH_COMMAND === '1') {
  console.log(JSON.stringify(defaultLaunch));
  process.exit(0);
}

const result = override
  ? spawnSync(override, [...overrideArgs, url], { stdio: 'inherit' })
  : spawnSync(defaultLaunch.command, defaultLaunch.args, { stdio: 'ignore' });

if (result.error) {
  fail(
    'Unable to invoke the Windows LiveDocs app. Install the Windows app, enable WSL interop, or set LIVEDOCS_WINDOWS_LAUNCHER to a command that accepts a livedocs:// URL.',
  );
}
if ((result.status ?? 0) !== 0) {
  fail(
    'The Windows LiveDocs launcher returned an error. Check that the livedocs:// protocol is registered.',
  );
}
