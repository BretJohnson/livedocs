#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';

const distro = process.env.WSL_DISTRO_NAME || process.env.LIVEDOCS_WSL_DISTRO || 'WSL';
const workspacePath = path.posix.resolve(process.cwd(), process.argv[2] || '.');
const reference = JSON.stringify({
  version: 1,
  kind: 'wsl',
  distro,
  path: workspacePath,
});

const child = spawn(
  process.execPath,
  [path.join(import.meta.dirname, '..', 'out', 'main', 'wsl-agent.js'), '--workspace', reference],
  { stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
