import type {
  AIStartRequest,
  AIStreamEvent,
  CommitRecord,
  FileContent,
  GenKey,
  GenResult,
  GitOverview,
  IndexStatus,
  SearchResult,
  TreeNode,
  WatcherEvent,
  WorkspaceInfo,
} from './types.js';
import type { WorkspaceKind, WorkspaceReference } from './workspace-ref.js';

export interface WorkspaceBackendEventMap {
  'watcher:batch': { events: WatcherEvent[] };
  'index:updated': { changed: string[]; removed: string[] };
  'index:status': IndexStatus;
  'gen:staleChanged': { items: GenKey[] };
  'ai:stream': AIStreamEvent;
  'workspace:changed': WorkspaceInfo | null;
  'workspace:connection': {
    state: 'connecting' | 'connected' | 'disconnected' | 'error';
    message?: string;
    reference?: WorkspaceReference;
  };
}

export type WorkspaceBackendEventChannel = keyof WorkspaceBackendEventMap;
export type WorkspaceBackendEmit = <C extends WorkspaceBackendEventChannel>(
  channel: C,
  data: WorkspaceBackendEventMap[C],
) => void;

export interface WorkspaceBackend {
  readonly kind: WorkspaceKind;
  open(reference: WorkspaceReference): Promise<WorkspaceInfo>;
  current(): WorkspaceInfo | null;
  close(): Promise<void> | void;
  tree(): Promise<TreeNode | null>;
  readFile(path: string): Promise<FileContent>;
  applyEdit(
    path: string,
    oldText: string,
    newText: string,
  ): Promise<{ ok: boolean; error?: string }>;
  search(query: string): Promise<SearchResult[]> | SearchResult[];
  gitOverview(): Promise<GitOverview>;
  gitFileHistory(path: string): Promise<CommitRecord[]>;
  indexStatus(): Promise<IndexStatus> | IndexStatus;
  getArtifact(key: GenKey): Promise<GenResult>;
  refreshArtifact(key: GenKey): Promise<GenResult>;
  startAI(request: AIStartRequest): Promise<{ requestId: string } | { error: 'not-configured' }>;
  cancelAI(requestId: string): Promise<void> | void;
}
