#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mockWorkspaceRoot = path.join(root, 'test-results', 'mock-wsl');
mkdirSync(mockWorkspaceRoot, { recursive: true });
const workspace = mkdtempSync(path.join(mockWorkspaceRoot, 'livedocs-agent-smoke-'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'livedocs-agent-data-'));
const agentWorkspace = mockWslPathForWindowsRepo(workspace);

function mockWslPathForWindowsRepo(repo) {
  if (process.platform !== 'win32') return repo;
  const absolute = path.resolve(repo);
  const rootPath = path.parse(absolute).root;
  const cwdRoot = path.parse(process.cwd()).root;
  if (rootPath.toLowerCase() !== cwdRoot.toLowerCase()) {
    throw new Error(`Mock WSL workspace must be on ${cwdRoot}; got ${absolute}`);
  }
  // Test-only: the mocked WSL agent is Windows node, where /foo resolves on
  // the current drive. Real \\wsl$ paths are converted in workspace-ref.ts.
  return `/${absolute.slice(rootPath.length).split(path.sep).join('/')}`;
}

function git(args) {
  const result = spawnSync('git', args, { cwd: workspace, stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

function cleanup() {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
}

mkdirSync(path.join(workspace, 'docs'), { recursive: true });
mkdirSync(path.join(workspace, 'src'), { recursive: true });
writeFileSync(path.join(workspace, 'README.md'), '# Agent Smoke\n\nSearchable capacitor.\n');
writeFileSync(path.join(workspace, 'docs', 'guide.md'), '# Guide\n');
writeFileSync(path.join(workspace, 'src', 'index.ts'), 'export const value = 1;\n');
git(['init', '-b', 'main']);
git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'add', '.']);
git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'feat: initial']);

const reference = JSON.stringify({
  version: 1,
  kind: 'wsl',
  distro: 'Smoke',
  path: agentWorkspace,
});
const child = spawn(
  process.execPath,
  [path.join(root, 'out', 'main', 'wsl-agent.js'), '--workspace', reference],
  {
    env: { ...process.env, XDG_DATA_HOME: dataDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);

let buffer = '';
let stderr = '';
let seq = 0;
const responses = new Map();
const events = [];

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.kind === 'response') responses.set(message.response.id, message.response);
    if (message.kind === 'event') events.push(message.event);
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

async function waitFor(predicate, label, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - start > timeout) {
      throw new Error(`timeout waiting for ${label}; stderr=${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function send(method, params) {
  const id = `r${++seq}`;
  child.stdin.write(
    JSON.stringify({ kind: 'request', request: { id, version: 1, method, params } }) + '\n',
  );
  return waitFor(() => responses.get(id), method);
}

async function expectOk(method, params) {
  const response = await send(method, params);
  if (!response.ok) throw new Error(`${method} failed: ${JSON.stringify(response)}`);
  return response.result;
}

try {
  await expectOk('protocol.handshake', { clientProtocolVersion: 1, minProtocolVersion: 1 });
  const opened = await expectOk('workspace.open', {
    reference: { version: 1, kind: 'wsl', distro: 'Smoke', path: agentWorkspace },
  });
  if (opened.label !== `Smoke:${agentWorkspace}`) throw new Error(`bad label: ${opened.label}`);

  const tree = await expectOk('workspace.tree', {});
  if (!tree.children.some((child) => child.path === 'README.md'))
    throw new Error('README missing from tree');

  const read = await expectOk('file.read', { path: 'README.md' });
  if (!read.content.includes('Searchable capacitor'))
    throw new Error('file read returned unexpected content');

  const status = await waitFor(async () => {
    const next = await expectOk('index.status', {});
    return next.filesIndexed > 0 ? next : null;
  }, 'index files');
  if (!status.filesIndexed) throw new Error('index did not record files');

  const search = await expectOk('search.query', { query: 'capacitor' });
  if (!search.some((hit) => hit.path === 'README.md'))
    throw new Error('search did not find README');

  const gitOverview = await expectOk('git.overview', {});
  if (!gitOverview.isRepo || gitOverview.branch !== 'main') throw new Error('git overview failed');
  const history = await expectOk('git.fileHistory', { path: 'README.md' });
  if (!history.length) throw new Error('git file history failed');

  const edit = await expectOk('file.applyEdit', {
    path: 'README.md',
    oldText: 'Searchable capacitor.',
    newText: 'Searchable inductor.',
  });
  if (!edit.ok) throw new Error(`apply edit failed: ${edit.error}`);
  const edited = await expectOk('file.read', { path: 'README.md' });
  if (!edited.content.includes('Searchable inductor.')) throw new Error('edited content missing');

  writeFileSync(path.join(workspace, 'docs', 'new.md'), '# New\n');
  await waitFor(
    () =>
      events.find(
        (event) =>
          event.type === 'watcher.batch' &&
          event.data.events.some((watchEvent) => watchEvent.path === 'docs/new.md'),
      ),
    'watcher event',
  );

  const escape = await send('file.read', { path: '../README.md' });
  if (escape.ok || escape.error.code !== 'path-escape') {
    throw new Error(`path traversal was not rejected: ${JSON.stringify(escape)}`);
  }

  await expectOk('agent.shutdown', {});
  console.log('[livedocs-smoke] WSL agent protocol smoke ok');
  cleanup();
} catch (err) {
  child.kill();
  cleanup();
  console.error(err);
  process.exit(1);
}
