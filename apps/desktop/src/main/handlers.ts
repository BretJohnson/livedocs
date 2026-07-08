import { dialog, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detectLanguage, isMarkdownPath } from '@livedocs/analysis';
import type { FileContent } from '../shared/ipc';
import { handle } from './ipc';
import { getAIConfigView, setAIConfig } from './ai-config';
import { cancelAIRequest, startAIRequest } from './ai-workflows';
import { getArtifact, refreshArtifact } from './generator-host';
import { getAppStore, getSession, openWorkspace, requireSession } from './session';
import { buildTree } from './tree';

function resolveInWorkspace(workspaceRoot: string, relPath: string): string {
  const absolute = path.resolve(workspaceRoot, relPath);
  if (path.relative(workspaceRoot, absolute).startsWith('..')) {
    throw new Error('Path escapes the workspace');
  }
  return absolute;
}

export function registerHandlers(): void {
  // ---- workspace ----
  handle('workspace:openDialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openWorkspace(result.filePaths[0]);
  });

  handle('workspace:open', ({ path: workspacePath }) => openWorkspace(workspacePath));
  handle('workspace:current', () => getSession()?.info ?? null);
  handle('workspace:recents', () => getAppStore().recentWorkspaces());
  handle('workspace:tree', async () => {
    const session = getSession();
    return session ? buildTree(session.info.path) : null;
  });

  // ---- files ----
  handle('file:read', async ({ path: relPath }): Promise<FileContent> => {
    const session = requireSession();
    const absolute = resolveInWorkspace(session.info.path, relPath);
    const [content, stat] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)]);
    return {
      path: relPath,
      content,
      language: detectLanguage(relPath),
      isMarkdown: isMarkdownPath(relPath),
      mtime: Math.round(stat.mtimeMs),
    };
  });

  handle('file:openExternal', async ({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      await shell.openExternal(url);
    }
  });

  // Draft-update apply path: replace an exact section occurrence, only ever
  // after explicit user acceptance in the diff review UI.
  handle('file:applyEdit', async ({ path: relPath, oldText, newText }) => {
    const session = requireSession();
    const absolute = resolveInWorkspace(session.info.path, relPath);
    const content = await fs.readFile(absolute, 'utf8');
    const first = content.indexOf(oldText);
    if (first === -1) {
      return { ok: false, error: 'The original section changed on disk; re-run the draft.' };
    }
    if (content.indexOf(oldText, first + 1) !== -1) {
      return { ok: false, error: 'The section text is ambiguous (multiple occurrences).' };
    }
    await fs.writeFile(
      absolute,
      content.slice(0, first) + newText + content.slice(first + oldText.length),
      'utf8',
    );
    return { ok: true };
  });

  // ---- search / git / index ----
  handle('search:query', ({ query }) => requireSession().store.search(query));

  handle('git:overview', async () => {
    const session = requireSession();
    const info = await session.git.info();
    if (!info.isRepo) return { isRepo: false, commits: [] };
    return { isRepo: true, branch: info.branch, commits: session.store.recentCommits(50) };
  });

  handle('git:fileHistory', ({ path: relPath }) => requireSession().git.fileHistory(relPath));

  handle('index:status', () => {
    const session = getSession();
    return session ? session.indexStatus() : { state: 'idle' as const, filesIndexed: 0 };
  });

  // ---- generated sections ----
  handle('gen:get', (key) => getArtifact(requireSession(), key));
  handle('gen:refresh', (key) => refreshArtifact(requireSession(), key));

  // ---- ai ----
  handle('ai:getConfig', () => getAIConfigView(getAppStore()));
  handle('ai:setConfig', (update) => setAIConfig(getAppStore(), update));
  handle('ai:start', (request) => startAIRequest(request));
  handle('ai:cancel', ({ requestId }) => cancelAIRequest(requestId));
}
