import path from 'node:path';
import type { Stats } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import { createPathFilter } from './ignore-rules.js';
import { LIVEDOCS_CONFIG_FILENAME } from './workspace-config.js';

export type WatchEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface WatchEvent {
  type: WatchEventType;
  /** Workspace-relative path with forward slashes. */
  path: string;
}

export interface WorkspaceWatcher {
  /** Resolves after chokidar's initial scan is complete and changes can no longer be missed. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * Watch a workspace with .gitignore-derived exclusions, delivering events in
 * debounced batches so bursts (branch switches, builds) arrive as one update.
 */
export function watchWorkspace(
  workspaceRoot: string,
  onBatch: (events: WatchEvent[]) => void,
  debounceMs = 250,
): WorkspaceWatcher {
  const filter = createPathFilter(workspaceRoot);
  let pending = new Map<string, WatchEvent>();
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    if (pending.size === 0) return;
    const events = [...pending.values()];
    pending = new Map();
    onBatch(events);
  };

  const watcher: FSWatcher = chokidar.watch(workspaceRoot, {
    ignoreInitial: true,
    ignored: (absPath: string, stats?: Stats) => {
      const rel = path.relative(workspaceRoot, absPath);
      if (!rel || rel.startsWith('..')) return false;
      if (isLiveDocsConfigPath(rel)) return false;
      // Apply directory-only rules (`secret/`) once chokidar knows the entry
      // is a directory, so ignored directories are not descended into.
      return stats?.isDirectory() ? filter.ignoresDirectory(rel) : filter.ignores(rel);
    },
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  const record = (type: WatchEventType) => (absPath: string) => {
    const rel = path.relative(workspaceRoot, absPath).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return;
    if (isLiveDocsConfigPath(rel)) {
      pending.set(`${type}:${rel}`, { type, path: rel });
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
      return;
    }
    const isDir = type === 'addDir' || type === 'unlinkDir';
    if (isDir ? filter.ignoresDirectory(rel) : filter.ignores(rel)) return;
    pending.set(`${type}:${rel}`, { type, path: rel });
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  watcher.on('add', record('add'));
  watcher.on('change', record('change'));
  watcher.on('unlink', record('unlink'));
  watcher.on('addDir', record('addDir'));
  watcher.on('unlinkDir', record('unlinkDir'));

  const ready = new Promise<void>((resolve) => watcher.once('ready', resolve));
  return {
    ready,
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
}

function isLiveDocsConfigPath(relPath: string): boolean {
  return relPath.split(path.sep).join('/') === LIVEDOCS_CONFIG_FILENAME;
}
