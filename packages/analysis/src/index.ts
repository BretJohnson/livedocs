export { createPathFilter, DEFAULT_IGNORES, type PathFilter } from './ignore-rules.js';
export { detectLanguage, isMarkdownPath, isIndexableText } from './languages.js';
export {
  tsJsExtractor,
  extractorForLanguage,
  type LanguageExtractor,
  type Extraction,
  type ExtractedImport,
  type ExtractedSymbol,
} from './extractors.js';
export { parsePackageManifest, manifestName } from './manifest.js';
export { Indexer, type IndexerOptions, type IndexProgress } from './indexer.js';
export {
  watchWorkspace,
  type WatchEvent,
  type WatchEventType,
  type WorkspaceWatcher,
} from './watcher.js';
export { GitService, parseLogWithFiles, type GitInfo } from './git.js';
export {
  LIVEDOCS_CONFIG_FILENAME,
  DEFAULT_LIVEDOCS_CONFIG,
  loadLiveDocsConfig,
  createDocumentSelector,
  normalizeWorkspacePath,
  type LiveDocsConfig,
  type LiveDocsConfigDiagnostic,
  type LoadedLiveDocsConfig,
  type DocumentSelector,
} from './workspace-config.js';
export {
  startIndexerWorker,
  type IndexerWorkerData,
  type IndexerWorkerRequest,
  type IndexerWorkerResponse,
} from './worker.js';
