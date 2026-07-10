#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = path.join(import.meta.dirname, 'livedocs-wsl.mjs');
const targetDir = process.env.LIVEDOCS_WSL_BIN || path.join(os.homedir(), '.local', 'bin');
const target = path.join(targetDir, 'livedocs');

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
chmodSync(target, 0o755);
console.log(`[livedocs] Installed WSL launcher at ${target}`);
console.log('[livedocs] Ensure this directory is on PATH inside WSL.');
