import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GitService,
  Indexer,
  detectLanguage,
  isMarkdownPath,
  watchWorkspace,
  type WatchEvent,
  type WorkspaceWatcher,
} from '@livedocs/analysis';
import {
  WorkspaceStore,
  workspaceReferenceLabel,
  workspaceReferenceName,
  type FileContent,
  type GenKey,
  type GenResult,
  type GitOverview,
  type IndexStatus,
  type SearchResult,
  type TreeNode,
  type WorkspaceInfo,
  type WorkspaceReference,
} from '@livedocs/store';
import {
  getArtifact,
  recomputeStaleness,
  refreshArtifact,
  type GeneratorRuntime,
} from './generator-host';
import { buildTree } from './tree';
import { resolveInWorkspace } from './workspace-paths';

export interface WorkspaceServiceEvents {
  onWatcherBatch?(events: WatchEvent[]): void;
  onIndexUpdated?(changed: string[], removed: string[]): void;
  onIndexStatus?(status: IndexStatus): void;
  onGeneratedStaleChanged?(items: GenKey[]): void;
  onWorkspaceChanged?(info: WorkspaceInfo | null): void;
}

export type NodeWorkspaceServiceEvents = WorkspaceServiceEvents;

export interface WorkspaceIndexerCallbacks {
  onProgress?(): void;
  onScanComplete?(): void;
  onBatchComplete?(changed: string[], removed: string[]): void;
  onError?(message: string): void;
}

export interface WorkspaceIndexerDriver {
  fullScan(): Promise<void> | void;
  applyChanges(changed: string[], removed: string[]): Promise<void> | void;
  dispose(): Promise<void> | void;
}

export interface WorkspaceIndexerFactoryContext {
  dataDir: string;
  workspaceRoot: string;
  reference: WorkspaceReference;
  store: WorkspaceStore;
  callbacks: WorkspaceIndexerCallbacks;
}

export type WorkspaceIndexerFactory = (
  context: WorkspaceIndexerFactoryContext,
) => WorkspaceIndexerDriver;

export interface WorkspaceServiceOptions {
  dataDir: string;
  events?: WorkspaceServiceEvents;
  createIndexer?: WorkspaceIndexerFactory;
  generatorRuntime?: GeneratorRuntime;
  logPrefix?: string;
  notifyWorkspaceClosed?: boolean;
}

export function defaultAgentDataDir(): string {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'livedocs', 'agent');
}

class DirectIndexerDriver implements WorkspaceIndexerDriver {
  constructor(
    private readonly indexer: Indexer,
    private readonly callbacks: WorkspaceIndexerCallbacks,
  ) {}

  async fullScan(): Promise<void> {
    await this.indexer.fullScan(() => this.callbacks.onProgress?.());
    this.callbacks.onScanComplete?.();
  }

  async applyChanges(changed: string[], removed: string[]): Promise<void> {
    const result = await this.indexer.applyChanges(changed, removed);
    this.callbacks.onBatchComplete?.(result.changed, result.removed);
  }

  dispose(): void {}
}

function createDirectIndexer(context: WorkspaceIndexerFactoryContext): WorkspaceIndexerDriver {
  return new DirectIndexerDriver(
    new Indexer(context.store, context.workspaceRoot),
    context.callbacks,
  );
}

export class WorkspaceService {
  private workspaceStore: WorkspaceStore | null = null;
  private workspaceGit: GitService | null = null;
  private watcher: WorkspaceWatcher | null = null;
  private indexer: WorkspaceIndexerDriver | null = null;
  private workspaceInfo: WorkspaceInfo | null = null;
  private indexState: IndexStatus['state'] = 'idle';
  private readonly dataDir: string;
  private readonly events: WorkspaceServiceEvents;
  private readonly createIndexer: WorkspaceIndexerFactory;
  private readonly generatorRuntime: GeneratorRuntime;
  private readonly logPrefix: string;
  private readonly notifyWorkspaceClosed: boolean;

  constructor(options: WorkspaceServiceOptions) {
    this.dataDir = options.dataDir;
    this.events = options.events ?? {};
    this.createIndexer = options.createIndexer ?? createDirectIndexer;
    this.generatorRuntime = options.generatorRuntime ?? {};
    this.logPrefix = options.logPrefix ?? '[livedocs-service]';
    this.notifyWorkspaceClosed = options.notifyWorkspaceClosed ?? true;
  }

  get info(): WorkspaceInfo {
    return this.requireInfo();
  }

  get store(): WorkspaceStore {
    return this.requireStore();
  }

  get git(): GitService {
    return this.requireGit();
  }

  async open(reference: WorkspaceReference): Promise<WorkspaceInfo> {
    const stat = await fs.stat(reference.path);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${reference.path}`);

    await this.close();

    this.workspaceInfo = {
      reference,
      kind: reference.kind,
      path: reference.path,
      name: workspaceReferenceName(reference),
      label: workspaceReferenceLabel(reference),
    };
    try {
      this.workspaceStore = WorkspaceStore.open(this.dataDir, reference);
      this.workspaceGit = new GitService(reference.path);
      this.indexState = 'scanning';
      this.indexer = this.createIndexer({
        dataDir: this.dataDir,
        workspaceRoot: reference.path,
        reference,
        store: this.workspaceStore,
        callbacks: this.indexerCallbacks(),
      });
      this.watcher = watchWorkspace(reference.path, (events) => this.onWatchBatch(events));
      this.events.onWorkspaceChanged?.(this.workspaceInfo);
      this.events.onIndexStatus?.(this.indexStatus());
      this.fullScan();
      void this.refreshGit();
      return this.workspaceInfo;
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  current(): WorkspaceInfo | null {
    return this.workspaceInfo;
  }

  async close(): Promise<void> {
    const hadWorkspace = this.workspaceInfo !== null;
    const watcher = this.watcher;
    const indexer = this.indexer;
    const store = this.workspaceStore;
    this.watcher = null;
    this.indexer = null;
    this.workspaceGit = null;
    this.workspaceStore = null;
    this.workspaceInfo = null;
    this.indexState = 'idle';
    await watcher?.close();
    await indexer?.dispose();
    store?.close();
    if (hadWorkspace && this.notifyWorkspaceClosed) {
      this.events.onWorkspaceChanged?.(null);
    }
  }

  async dispose(): Promise<void> {
    await this.close();
  }

  async tree(): Promise<TreeNode | null> {
    return this.workspaceInfo ? buildTree(this.workspaceInfo.path) : null;
  }

  async readFile(relPath: string): Promise<FileContent> {
    const info = this.requireInfo();
    const absolute = resolveInWorkspace(info.path, relPath);
    const [content, stat] = await Promise.all([fs.readFile(absolute, 'utf8'), fs.stat(absolute)]);
    return {
      path: relPath,
      content,
      language: detectLanguage(relPath),
      isMarkdown: isMarkdownPath(relPath),
      mtime: Math.round(stat.mtimeMs),
    };
  }

  async applyEdit(
    relPath: string,
    oldText: string,
    newText: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const info = this.requireInfo();
    const absolute = resolveInWorkspace(info.path, relPath);
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
  }

  search(query: string): SearchResult[] {
    return this.requireStore().search(query);
  }

  async gitOverview(): Promise<GitOverview> {
    const info = await this.requireGit().info();
    if (!info.isRepo) return { isRepo: false, commits: [] };
    return { isRepo: true, branch: info.branch, commits: this.requireStore().recentCommits(50) };
  }

  gitFileHistory(relPath: string) {
    return this.requireGit().fileHistory(relPath);
  }

  indexStatus(): IndexStatus {
    return {
      state: this.indexState,
      filesIndexed: this.workspaceStore?.fileCount() ?? 0,
    };
  }

  async getArtifact(key: GenKey): Promise<GenResult> {
    return getArtifact(this, key, this.generatorRuntime);
  }

  async refreshArtifact(key: GenKey): Promise<GenResult> {
    return refreshArtifact(this, key, this.generatorRuntime);
  }

  private indexerCallbacks(): WorkspaceIndexerCallbacks {
    return {
      onProgress: () => this.events.onIndexStatus?.(this.indexStatus()),
      onScanComplete: () => {
        this.indexState = 'ready';
        this.events.onIndexStatus?.(this.indexStatus());
        this.afterIndexUpdate([], []);
      },
      onBatchComplete: (changed, removed) => this.afterIndexUpdate(changed, removed),
      onError: (message) => this.logIndexerError(message),
    };
  }

  private fullScan(): void {
    const indexer = this.indexer;
    if (!indexer) return;
    void Promise.resolve(indexer.fullScan()).catch((err) => this.logIndexerError(err));
  }

  private onWatchBatch(events: WatchEvent[]): void {
    this.events.onWatcherBatch?.(events);
    const changed = events
      .filter((e) => e.type === 'add' || e.type === 'change')
      .map((e) => e.path);
    const removed = events.filter((e) => e.type === 'unlink').map((e) => e.path);
    if (changed.length > 0 || removed.length > 0) {
      this.applyIndexChanges(changed, removed);
    }
  }

  private applyIndexChanges(changed: string[], removed: string[]): void {
    const indexer = this.indexer;
    if (!indexer) return;
    void Promise.resolve(indexer.applyChanges(changed, removed)).catch((err) =>
      this.logIndexerError(err),
    );
  }

  private afterIndexUpdate(changed: string[], removed: string[]): void {
    this.events.onIndexUpdated?.(changed, removed);
    const stale = recomputeStaleness(this, this.generatorRuntime);
    if (stale.length > 0) this.events.onGeneratedStaleChanged?.(stale);
    void this.refreshGit();
  }

  private async refreshGit(): Promise<void> {
    const git = this.workspaceGit;
    const store = this.workspaceStore;
    if (!git || !store) return;
    const info = await git.info();
    if (!info.isRepo) return;
    const commits = await git.recentCommits(50);
    if (commits.length > 0) store.replaceCommits(commits);
  }

  private logIndexerError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${this.logPrefix} index error:`, message);
  }

  private requireInfo(): WorkspaceInfo {
    if (!this.workspaceInfo) throw new Error('No workspace is open');
    return this.workspaceInfo;
  }

  private requireStore(): WorkspaceStore {
    if (!this.workspaceStore) throw new Error('No workspace is open');
    return this.workspaceStore;
  }

  private requireGit(): GitService {
    if (!this.workspaceGit) throw new Error('No workspace is open');
    return this.workspaceGit;
  }
}

export class NodeWorkspaceService extends WorkspaceService {
  constructor(dataDir: string, events: NodeWorkspaceServiceEvents = {}) {
    super({
      dataDir,
      events,
      logPrefix: '[livedocs-agent]',
      notifyWorkspaceClosed: true,
    });
  }
}
