import {
  type AIStartRequest,
  type CommitRecord,
  type FileContent,
  type GenKey,
  type GenResult,
  type GitOverview,
  type IndexStatus,
  type SearchResult,
  type TreeNode,
  type WorkspaceBackend,
  type WorkspaceBackendEmit,
  type WorkspaceInfo,
  type WorkspaceReference,
  type WslWorkspaceReference,
} from '@livedocs/store';
import { WslAgentClient } from './agent-client';
import { getAppStore } from './session';

export class AgentWorkspaceBackend implements WorkspaceBackend {
  readonly kind = 'wsl' as const;
  private client: WslAgentClient | null = null;
  private info: WorkspaceInfo | null = null;

  constructor(private readonly emit: WorkspaceBackendEmit) {}

  async open(reference: WorkspaceReference): Promise<WorkspaceInfo> {
    if (reference.kind !== 'wsl') {
      throw new Error('Agent backend can only open WSL workspace references');
    }
    this.emit('workspace:connection', { state: 'connecting', reference });
    const previousClient = this.client;
    const previousInfo = this.info;
    const client = new WslAgentClient({
      reference,
      onEvent: (event) => {
        if (this.client !== client) return;
        switch (event.type) {
          case 'watcher.batch':
            this.emit('watcher:batch', event.data);
            break;
          case 'index.updated':
            this.emit('index:updated', event.data);
            break;
          case 'index.status':
            this.emit('index:status', event.data);
            break;
          case 'gen.staleChanged':
            this.emit('gen:staleChanged', event.data);
            break;
          case 'workspace.changed':
            this.info = event.data;
            this.emit('workspace:changed', event.data);
            break;
          case 'agent.disconnected':
            this.emit('workspace:connection', {
              state: 'disconnected',
              message: event.data.message,
              reference,
            });
            break;
          case 'ai.stream':
            this.emit('ai:stream', event.data);
            break;
        }
      },
      onExit: (message) => {
        if (this.client !== client) return;
        this.emit('workspace:connection', { state: 'disconnected', message, reference });
      },
    });
    try {
      await client.connect();
      const info = await client.request('workspace.open', { reference });
      this.client = client;
      this.info = info;
      await previousClient?.dispose();
      getAppStore().touchRecentWorkspace(reference, this.info.name);
      this.emit('workspace:connection', { state: 'connected', reference });
      this.emit('workspace:changed', this.info);
      return this.info;
    } catch (err) {
      this.client = previousClient;
      this.info = previousInfo;
      await client.dispose();
      throw err;
    }
  }

  current(): WorkspaceInfo | null {
    return this.info;
  }

  async close(): Promise<void> {
    const previous = this.client;
    this.client = null;
    this.info = null;
    await previous?.dispose();
  }

  tree(): Promise<TreeNode | null> {
    return this.requireClient().request('workspace.tree', {});
  }

  readFile(path: string): Promise<FileContent> {
    return this.requireClient().request('file.read', { path });
  }

  applyEdit(
    path: string,
    oldText: string,
    newText: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.requireClient().request('file.applyEdit', { path, oldText, newText });
  }

  search(query: string): Promise<SearchResult[]> {
    return this.requireClient().request('search.query', { query });
  }

  gitOverview(): Promise<GitOverview> {
    return this.requireClient().request('git.overview', {});
  }

  gitFileHistory(path: string): Promise<CommitRecord[]> {
    return this.requireClient().request('git.fileHistory', { path });
  }

  indexStatus(): Promise<IndexStatus> {
    return this.requireClient().request('index.status', {});
  }

  getArtifact(key: GenKey): Promise<GenResult> {
    return this.requireClient().request('gen.get', key);
  }

  refreshArtifact(key: GenKey): Promise<GenResult> {
    return this.requireClient().request('gen.refresh', key);
  }

  startAI(request: AIStartRequest): Promise<{ requestId: string } | { error: 'not-configured' }> {
    return this.requireClient().request('ai.start', request);
  }

  cancelAI(requestId: string): Promise<void> {
    return this.requireClient().request('ai.cancel', { requestId });
  }

  private requireClient(): WslAgentClient {
    if (!this.client) throw new Error('No WSL workspace agent is connected');
    return this.client;
  }
}

export function isWslReference(reference: WorkspaceReference): reference is WslWorkspaceReference {
  return reference.kind === 'wsl';
}
