/**
 * The single typed IPC contract shared by main, preload, and renderer.
 * `InvokeMap` covers renderer→main request/response; `EventMap` covers
 * main→renderer pushes.
 */
import type {
  AIConfigView,
  AIProvider,
  AIStartRequest,
  AIStreamEvent,
  CommitRecord,
  FileContent,
  GenKey,
  GenResult,
  GitOverview,
  IndexStatus,
  Provenance,
  RecentWorkspace,
  SearchResult,
  TreeNode,
  WatcherEvent,
  WatcherEventType,
  WorkspaceInfo,
  WorkspaceOpenRequest,
  WorkspaceReference,
} from '@livedocs/store';

export type {
  AIConfigView,
  AIProvider,
  AIStartRequest,
  AIStreamEvent,
  CommitRecord,
  FileContent,
  GenKey,
  GenResult,
  GitOverview,
  IndexStatus,
  Provenance,
  RecentWorkspace,
  SearchResult,
  TreeNode,
  WatcherEvent,
  WatcherEventType,
  WorkspaceInfo,
  WorkspaceOpenRequest,
  WorkspaceReference,
};

export interface InvokeMap {
  'workspace:openDialog': { req: void; res: WorkspaceInfo | null };
  'workspace:open': { req: WorkspaceOpenRequest; res: WorkspaceInfo };
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

export interface EventMap {
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
  'workspace:connection',
];

/** Shape of the API the preload script exposes as `window.livedocs`. */
export interface LiveDocsBridge {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload: InvokeMap[C]['req'],
  ): Promise<InvokeMap[C]['res']>;
  on<C extends EventChannel>(channel: C, listener: (data: EventMap[C]) => void): () => void;
}
