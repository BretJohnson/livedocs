#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetDir = process.env.LIVEDOCS_WSL_BIN || path.join(os.homedir(), '.local', 'bin');
const dataDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const launcherSource = path.join(import.meta.dirname, 'livedocs-wsl.mjs');
const launcherTarget = path.join(targetDir, 'livedocs');
const agentDir = path.join(dataDir, 'livedocs', 'bin');
const agentTarget = path.join(agentDir, 'livedocs-wsl-agent');
const agentEntrypoint = path.resolve(import.meta.dirname, '..', 'out', 'main', 'wsl-agent.js');
const sourceSnapshot = process.env.LIVEDOCS_SOURCE_SNAPSHOT || 'manual-install';

mkdirSync(targetDir, { recursive: true });
mkdirSync(agentDir, { recursive: true });
copyFileSync(launcherSource, launcherTarget);
chmodSync(launcherTarget, 0o755);
writeFileSync(
  agentTarget,
  [
    '#!/bin/sh',
    `AGENT=${shQuote(agentEntrypoint)}`,
    `LIVEDOCS_SOURCE_SNAPSHOT=${shQuote(sourceSnapshot)}`,
    'export LIVEDOCS_SOURCE_SNAPSHOT',
    'if [ ! -f "$AGENT" ]; then',
    '  echo "[livedocs] WSL agent is not built at $AGENT" >&2',
    '  echo "[livedocs] Run pnpm build in the WSL checkout, then reinstall with pnpm --filter @livedocs/desktop install:wsl-launcher." >&2',
    '  exit 1',
    'fi',
    `exec ${shQuote(process.execPath)} "$AGENT" "$@"`,
    '',
  ].join('\n'),
);
chmodSync(agentTarget, 0o755);
console.log(`[livedocs] Installed WSL launcher at ${launcherTarget}`);
console.log(`[livedocs] Installed WSL agent at ${agentTarget}`);
console.log(`[livedocs] WSL agent source snapshot: ${sourceSnapshot}`);
console.log('[livedocs] Ensure the launcher directory is on PATH inside WSL.');

function shQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
