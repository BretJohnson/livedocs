#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  dependencyFingerprint,
  ensureOwnedMirror,
  expectedOwner,
  parseMode,
  reconcileSource,
  validatePrerequisites,
  windowsCommandForMode,
} from './wsl-windows-core.mjs';

const root = path.join(tmpdir(), `livedocs-wsl-windows-smoke-${process.pid}`);
const source = path.join(root, 'source');
const mirror = path.join(root, 'mirror');
try {
  mkdirSync(path.join(source, 'apps', 'desktop'), { recursive: true });
  writeFileSync(path.join(source, 'package.json'), '{"packageManager":"pnpm@11.11.0"}');
  writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  writeFileSync(
    path.join(source, 'apps', 'desktop', 'package.json'),
    '{"name":"@livedocs/desktop"}',
  );
  writeFileSync(path.join(source, '.env'), 'NOT_COPIED=1');
  const owner = expectedOwner('Smoke Distro', '/home/smoke/livedocs');
  ensureOwnedMirror(mirror, owner);
  const first = reconcileSource(source, mirror, owner);
  if (!first.snapshot || readFileSync(path.join(mirror, 'package.json'), 'utf8').length === 0)
    throw new Error('initial synchronization failed');
  writeFileSync(path.join(source, 'added.txt'), 'added');
  reconcileSource(source, mirror, owner);
  writeFileSync(path.join(source, 'added.txt'), 'changed');
  reconcileSource(source, mirror, owner);
  if (readFileSync(path.join(mirror, 'added.txt'), 'utf8') !== 'changed')
    throw new Error('changed source was not synchronized');
  rmSync(path.join(source, 'added.txt'));
  reconcileSource(source, mirror, owner);
  if (existsSync(path.join(mirror, 'added.txt')))
    throw new Error('removed source remains in mirror');
  if (existsSync(path.join(mirror, '.env')))
    throw new Error('excluded local environment entered mirror');
} finally {
  rmSync(root, { recursive: true, force: true });
}

for (const mode of ['dev', 'build', 'dist', 'launch', 'clean']) parseMode(mode);
windowsCommandForMode('dev');
windowsCommandForMode('build');
windowsCommandForMode('dist');
const missing = validatePrerequisites({}, '11.11.0', 'dev');
if (!missing.includes('Windows Node.js') || !missing.includes('Visual Studio C++ Build Tools'))
  throw new Error('prerequisite diagnostics failed');

const fingerprintRoot = path.join(tmpdir(), `livedocs-wsl-fingerprint-${process.pid}`);
try {
  mkdirSync(path.join(fingerprintRoot, 'apps', 'desktop'), { recursive: true });
  writeFileSync(path.join(fingerprintRoot, 'package.json'), '{}');
  const a = dependencyFingerprint(fingerprintRoot, {
    nodeVersion: '24',
    nodeAbi: '137',
    pnpmVersion: '11.11.0',
  });
  const b = dependencyFingerprint(fingerprintRoot, {
    nodeVersion: '24',
    nodeAbi: '999',
    pnpmVersion: '11.11.0',
  });
  if (a === b) throw new Error('dependency ABI did not invalidate fingerprint');
} finally {
  rmSync(fingerprintRoot, { recursive: true, force: true });
}
console.log('[livedocs-smoke] WSL-driven Windows orchestration smoke ok');
