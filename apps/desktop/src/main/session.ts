import { app } from 'electron';
import path from 'node:path';
import {
  AppStore,
  createLocalWorkspaceReference,
  type LocalWorkspaceReference,
  type WorkspaceInfo,
} from '@livedocs/store';
import { buildAIService } from './ai-config';
import { broadcast } from './ipc';
import { IndexerHost } from './indexer-host';
import {
  WorkspaceService,
  type WorkspaceIndexerDriver,
  type WorkspaceIndexerFactoryContext,
} from './node-workspace-service';

let appStore: AppStore | null = null;

export function dataDir(): string {
  return path.join(app.getPath('userData'), 'livedocs-data');
}

export function getAppStore(): AppStore {
  appStore ??= AppStore.open(dataDir());
  return appStore;
}

class WorkerIndexerDriver implements WorkspaceIndexerDriver {
  constructor(private readonly host: IndexerHost) {}

  fullScan(): void {
    this.host.fullScan();
  }

  applyChanges(changed: string[], removed: string[]): void {
    this.host.applyChanges(changed, removed);
  }

  dispose(): Promise<void> {
    return this.host.dispose();
  }
}

function createWorkerIndexer(context: WorkspaceIndexerFactoryContext): WorkspaceIndexerDriver {
  return new WorkerIndexerDriver(
    new IndexerHost(
      { dataDir: context.dataDir, workspaceRoot: context.workspaceRoot },
      {
        onScanComplete: () => context.callbacks.onScanComplete?.(),
        onProgress: () => context.callbacks.onProgress?.(),
        onBatchComplete: (changed, removed) =>
          context.callbacks.onBatchComplete?.(changed, removed),
        onError: (message) => context.callbacks.onError?.(message),
      },
    ),
  );
}

function createLocalService(): WorkspaceService {
  return new WorkspaceService({
    dataDir: dataDir(),
    createIndexer: createWorkerIndexer,
    generatorRuntime: {
      ai: (workspace) => buildAIService(getAppStore(), workspace.store),
    },
    events: {
      onWatcherBatch: (events) => broadcast('watcher:batch', { events }),
      onIndexUpdated: (changed, removed) => broadcast('index:updated', { changed, removed }),
      onIndexStatus: (status) => broadcast('index:status', status),
      onGeneratedStaleChanged: (items) => broadcast('gen:staleChanged', { items }),
      onConfigChanged: (info) => broadcast('workspace:changed', info),
    },
    logPrefix: '[livedocs]',
    notifyWorkspaceClosed: false,
  });
}

export type Session = WorkspaceService;

let current: WorkspaceService | null = null;

export function getSession(): Session | null {
  return current;
}

export function requireSession(): Session {
  if (!current) throw new Error('No workspace is open');
  return current;
}

export async function closeWorkspace(): Promise<void> {
  const previous = current;
  current = null;
  await previous?.close();
}

export async function openWorkspace(
  workspace: string | LocalWorkspaceReference,
): Promise<WorkspaceInfo> {
  const reference =
    typeof workspace === 'string'
      ? createLocalWorkspaceReference(
          path.resolve(workspace),
          path.basename(path.resolve(workspace)),
        )
      : createLocalWorkspaceReference(workspace.path, workspace.name);
  const service = createLocalService();
  const info = await service.open(reference);
  const previous = current;
  current = service;
  getAppStore().touchRecentWorkspace(reference, info.name);
  broadcast('workspace:changed', info);
  void previous?.close().catch((err) => {
    console.error('[livedocs] failed to close previous workspace:', err);
  });
  return info;
}
