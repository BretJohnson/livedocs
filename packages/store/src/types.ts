import type { WorkspaceKind, WorkspaceReference } from './workspace-ref.js';

export interface FileRecord {
  path: string;
  language: string | null;
  size: number;
  mtime: number;
  contentHash: string;
  isMarkdown: boolean;
}

export interface SymbolRecord {
  filePath: string;
  name: string;
  kind: string;
}

export interface ImportRecord {
  sourcePath: string;
  specifier: string;
  resolvedPath: string | null;
}

export interface DependencyRecord {
  manifestPath: string;
  name: string;
  version: string;
  depType: 'prod' | 'dev' | 'peer' | 'optional';
}

export interface CommitFileRecord {
  path: string;
  status: string;
}

export interface CommitRecord {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  files: CommitFileRecord[];
}

export interface Provenance {
  generator: string;
  kind: 'deterministic' | 'ai';
  model?: string;
  timestamp: string;
  inputDigest: string;
  cacheHit?: boolean;
  inputSummary?: string;
}

export interface GeneratedArtifact {
  docPath: string;
  generator: string;
  params: string;
  /** Serialized mdast root produced by the generator. */
  output: string;
  provenance: Provenance;
  inputDigest: string;
  stale: boolean;
  createdAt: number;
}

export interface SearchResult {
  path: string;
  snippet: string;
  isMarkdown: boolean;
  language: string | null;
}

export interface RecentWorkspace {
  reference: WorkspaceReference;
  kind: WorkspaceKind;
  path: string;
  name: string;
  label: string;
  distro?: string;
  lastOpenedAt: number;
}

export interface WorkspaceInfo {
  reference: WorkspaceReference;
  kind: WorkspaceKind;
  path: string;
  name: string;
  label: string;
  configDiagnostic?: WorkspaceConfigDiagnostic;
}

export interface WorkspaceConfigDiagnostic {
  path: 'livedocs.jsonc';
  message: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  isMarkdown?: boolean;
  /** Whether this Markdown file is selected for docs-focused navigation. */
  isDocument?: boolean;
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
   * API keys cannot be saved.
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

export type AIStreamEvent =
  | { requestId: string; type: 'chunk'; text: string }
  | { requestId: string; type: 'done'; text: string; provenance: Provenance }
  | { requestId: string; type: 'error'; message: string }
  | { requestId: string; type: 'cancelled' };
