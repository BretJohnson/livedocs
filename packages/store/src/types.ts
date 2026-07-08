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
  path: string;
  name: string;
  lastOpenedAt: number;
}
