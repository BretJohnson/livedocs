import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  GitService,
  watchWorkspace,
  type WatchEvent,
  type WorkspaceWatcher,
} from '@livedocs/analysis';
import { AppStore, WorkspaceStore } from '@livedocs/store';
import type { IndexStatus, WorkspaceInfo } from '../shared/ipc';
import { broadcast } from './ipc';
import { IndexerHost } from './indexer-host';
import { recomputeStaleness } from './generator-host';

let appStore: AppStore | null = null;

export function dataDir(): string {
  return path.join(app.getPath('userData'), 'livedocs-data');
}

export function getAppStore(): AppStore {
  appStore ??= AppStore.open(dataDir());
  return appStore;
}

/** Everything scoped to one open workspace; disposed when switching. */
export class Session {
  readonly store: WorkspaceStore;
  readonly git: GitService;
  private readonly watcher: WorkspaceWatcher;
  private readonly indexer: IndexerHost;
  indexState: IndexStatus['state'] = 'scanning';

  constructor(readonly info: WorkspaceInfo) {
    this.store = WorkspaceStore.open(dataDir(), info.path);
    this.git = new GitService(info.path);

    this.indexer = new IndexerHost(
      { dataDir: dataDir(), workspaceRoot: info.path },
      {
        onScanComplete: () => {
          this.indexState = 'ready';
          broadcast('index:status', this.indexStatus());
          this.afterIndexUpdate([], []);
        },
        onProgress: () => broadcast('index:status', this.indexStatus()),
        onBatchComplete: (changed, removed) => this.afterIndexUpdate(changed, removed),
        onError: (message) => console.error('[livedocs] indexer error:', message),
      },
    );

    this.watcher = watchWorkspace(info.path, (events) => this.onWatchBatch(events));
    this.indexer.fullScan();
    void this.refreshGit();
  }

  indexStatus(): IndexStatus {
    return { state: this.indexState, filesIndexed: this.store.fileCount() };
  }

  private onWatchBatch(events: WatchEvent[]): void {
    broadcast('watcher:batch', { events });
    const changed = events
      .filter((e) => e.type === 'add' || e.type === 'change')
      .map((e) => e.path);
    const removed = events.filter((e) => e.type === 'unlink').map((e) => e.path);
    if (changed.length > 0 || removed.length > 0) {
      this.indexer.applyChanges(changed, removed);
    }
  }

  /** Runs after the worker persisted index changes: staleness + git + notify. */
  private afterIndexUpdate(changed: string[], removed: string[]): void {
    broadcast('index:updated', { changed, removed });
    const staleChanges = recomputeStaleness(this);
    if (staleChanges.length > 0) broadcast('gen:staleChanged', { items: staleChanges });
    void this.refreshGit();
  }

  private async refreshGit(): Promise<void> {
    const info = await this.git.info();
    if (!info.isRepo) return;
    const commits = await this.git.recentCommits(50);
    if (commits.length > 0) this.store.replaceCommits(commits);
  }

  dispose(): void {
    void this.watcher.close();
    void this.indexer.dispose();
    this.store.close();
  }
}

let current: Session | null = null;

export function getSession(): Session | null {
  return current;
}

export function requireSession(): Session {
  if (!current) throw new Error('No workspace is open');
  return current;
}

export async function openWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
  const resolved = path.resolve(workspacePath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);

  current?.dispose();
  const info: WorkspaceInfo = { path: resolved, name: path.basename(resolved) };
  current = new Session(info);
  getAppStore().touchRecentWorkspace(resolved, info.name);
  broadcast('workspace:changed', info);
  return info;
}
