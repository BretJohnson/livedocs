/**
 * The single typed IPC contract shared by main, preload, and renderer.
 * `InvokeMap` covers renderer→main request/response; `EventMap` covers
 * main→renderer pushes.
 */
import type { CommitRecord, Provenance, RecentWorkspace, SearchResult } from '@livedocs/store';

export type { CommitRecord, Provenance, RecentWorkspace, SearchResult };

export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  isMarkdown?: boolean;
  children?: TreeNode[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string | null;
  isMarkdown: boolean;
  mtime: number;
}

export interface GitOverview {
  isRepo: boolean;
  branch?: string;
  commits: CommitRecord[];
}

export interface IndexStatus {
  state: 'idle' | 'scanning' | 'ready';
  filesIndexed: number;
}

export type GenResult =
  | { status: 'ok'; output: string; provenance: Provenance; stale: boolean }
  | { status: 'unknown-generator'; name: string; available: string[] }
  | { status: 'needs-run'; name: string; reason: 'ai-explicit' | 'ai-unconfigured' }
  | { status: 'error'; message: string };

export type AIProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'mock';

export interface AIConfigView {
  provider: AIProvider | null;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  keyStorage: 'encrypted' | 'none';
  /**
   * Whether OS-backed secure storage is available. When false, cloud provider
   * API keys cannot be saved (we never persist plaintext); the settings UI
   * explains this and steers the user toward a local provider.
   */
  secureStorageAvailable: boolean;
}

export type AIStartRequest =
  | { kind: 'explain'; docPath: string; selection: string }
  | { kind: 'summarize-doc'; docPath: string }
  | { kind: 'summarize-changes' }
  | { kind: 'draft'; docPath: string; sectionText: string; instruction: string };

export type WatcherEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface WatcherEvent {
  type: WatcherEventType;
  /** Workspace-relative path. */
  path: string;
}

export interface GenKey {
  docPath: string;
  generator: string;
  params: string;
}

export interface InvokeMap {
  'workspace:openDialog': { req: void; res: WorkspaceInfo | null };
  'workspace:open': { req: { path: string }; res: WorkspaceInfo };
  'workspace:current': { req: void; res: WorkspaceInfo | null };
  'workspace:recents': { req: void; res: RecentWorkspace[] };
  'workspace:tree': { req: void; res: TreeNode | null };
  'file:read': { req: { path: string }; res: FileContent };
  'file:openExternal': { req: { url: string }; res: void };
  'file:applyEdit': {
    req: { path: string; oldText: string; newText: string };
    res: { ok: boolean; error?: string };
  };
  'search:query': { req: { query: string }; res: SearchResult[] };
  'git:overview': { req: void; res: GitOverview };
  'git:fileHistory': { req: { path: string }; res: CommitRecord[] };
  'index:status': { req: void; res: IndexStatus };
  'gen:get': { req: GenKey; res: GenResult };
  'gen:refresh': { req: GenKey; res: GenResult };
  'ai:getConfig': { req: void; res: AIConfigView };
  'ai:setConfig': {
    req: {
      provider: AIProvider;
      model: string;
      apiKey?: string | null;
      baseUrl?: string | null;
    };
    res: AIConfigView;
  };
  'ai:start': {
    req: AIStartRequest;
    res: { requestId: string } | { error: 'not-configured' };
  };
  'ai:cancel': { req: { requestId: string }; res: void };
}

export type AIStreamEvent =
  | { requestId: string; type: 'chunk'; text: string }
  | { requestId: string; type: 'done'; text: string; provenance: Provenance }
  | { requestId: string; type: 'error'; message: string }
  | { requestId: string; type: 'cancelled' };

export interface EventMap {
  'watcher:batch': { events: WatcherEvent[] };
  'index:updated': { changed: string[]; removed: string[] };
  'index:status': IndexStatus;
  'gen:staleChanged': { items: GenKey[] };
  'ai:stream': AIStreamEvent;
  'workspace:changed': WorkspaceInfo | null;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;

export const INVOKE_CHANNELS: InvokeChannel[] = [
  'workspace:openDialog',
  'workspace:open',
  'workspace:current',
  'workspace:recents',
  'workspace:tree',
  'file:read',
  'file:openExternal',
  'file:applyEdit',
  'search:query',
  'git:overview',
  'git:fileHistory',
  'index:status',
  'gen:get',
  'gen:refresh',
  'ai:getConfig',
  'ai:setConfig',
  'ai:start',
  'ai:cancel',
];

export const EVENT_CHANNELS: EventChannel[] = [
  'watcher:batch',
  'index:updated',
  'index:status',
  'gen:staleChanged',
  'ai:stream',
  'workspace:changed',
];

/** Shape of the API the preload script exposes as `window.livedocs`. */
export interface LiveDocsBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload: InvokeMap[C]['req'],
  ): Promise<InvokeMap[C]['res']>;
  on<C extends EventChannel>(channel: C, listener: (data: EventMap[C]) => void): () => void;
}
