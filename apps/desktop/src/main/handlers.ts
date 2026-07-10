import { dialog, shell } from 'electron';
import { handle } from './ipc';
import { getAIConfigView, setAIConfig } from './ai-config';
import { getAppStore } from './session';
import { currentBackend, openWorkspaceRequest } from './workspace-router';

export function registerHandlers(): void {
  // ---- workspace ----
  handle('workspace:openDialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Workspace',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openWorkspaceRequest({ path: result.filePaths[0] });
  });

  handle('workspace:open', (request) => openWorkspaceRequest(request));
  handle('workspace:current', () => currentBackend().current());
  handle('workspace:recents', () => getAppStore().recentWorkspaces());
  handle('workspace:tree', () => currentBackend().tree());

  // ---- files ----
  handle('file:read', ({ path }) => currentBackend().readFile(path));

  handle('file:openExternal', async ({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      await shell.openExternal(url);
    }
  });

  // Draft-update apply path: replace an exact section occurrence, only ever
  // after explicit user acceptance in the diff review UI.
  handle('file:applyEdit', ({ path, oldText, newText }) =>
    currentBackend().applyEdit(path, oldText, newText),
  );

  // ---- search / git / index ----
  handle('search:query', ({ query }) => currentBackend().search(query));
  handle('git:overview', () => currentBackend().gitOverview());
  handle('git:fileHistory', ({ path }) => currentBackend().gitFileHistory(path));
  handle('index:status', () => currentBackend().indexStatus());

  // ---- generated sections ----
  handle('gen:get', (key) => currentBackend().getArtifact(key));
  handle('gen:refresh', (key) => currentBackend().refreshArtifact(key));

  // ---- ai ----
  handle('ai:getConfig', () => getAIConfigView(getAppStore()));
  handle('ai:setConfig', (update) => setAIConfig(getAppStore(), update));
  handle('ai:start', (request) => currentBackend().startAI(request));
  handle('ai:cancel', ({ requestId }) => currentBackend().cancelAI(requestId));
}
