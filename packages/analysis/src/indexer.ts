import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WorkspaceStore } from '@livedocs/store';
import { extractorForLanguage } from './extractors.js';
import { createPathFilter, type PathFilter } from './ignore-rules.js';
import { detectLanguage, isIndexableText, isMarkdownPath } from './languages.js';
import { parsePackageManifest } from './manifest.js';

export interface IndexerOptions {
  maxFiles?: number;
}

export interface IndexProgress {
  indexed: number;
  total?: number;
}

const DEFAULT_MAX_FILES = 20_000;

/**
 * Builds and incrementally maintains the source index for one workspace.
 * Pure Node — runs the same inside a worker thread or a test.
 */
export class Indexer {
  private readonly filter: PathFilter;
  private readonly maxFiles: number;

  constructor(
    private readonly store: WorkspaceStore,
    private readonly workspaceRoot: string,
    options: IndexerOptions = {},
  ) {
    this.filter = createPathFilter(workspaceRoot);
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  }

  /** Walk the workspace and index every non-ignored file. Removes stale rows. */
  async fullScan(onProgress?: (progress: IndexProgress) => void): Promise<number> {
    const found = new Set<string>();
    let indexed = 0;
    const walk = async (dirRel: string): Promise<void> => {
      if (found.size >= this.maxFiles) return;
      const entries = await fs.readdir(path.join(this.workspaceRoot, dirRel), {
        withFileTypes: true,
      });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (found.size >= this.maxFiles) return;
        const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (entry.isDirectory() ? this.filter.ignoresDirectory(rel) : this.filter.ignores(rel))
          continue;
        if (entry.isDirectory()) {
          await walk(rel);
        } else if (entry.isFile()) {
          found.add(rel);
          await this.indexFile(rel);
          indexed += 1;
          if (indexed % 50 === 0) onProgress?.({ indexed });
        }
      }
    };
    await walk('');

    // Drop rows for files that no longer exist.
    for (const file of this.store.listFiles()) {
      if (!found.has(file.path)) this.store.removeFile(file.path);
    }
    onProgress?.({ indexed, total: indexed });
    return indexed;
  }

  /** Incrementally apply watcher events. Returns paths actually re-indexed. */
  async applyChanges(
    changed: string[],
    removed: string[],
  ): Promise<{ changed: string[]; removed: string[] }> {
    const indexedPaths: string[] = [];
    for (const rel of changed) {
      if (this.filter.ignores(rel)) continue;
      try {
        await this.indexFile(rel);
        indexedPaths.push(rel);
      } catch {
        // Race: file may already be gone.
        this.store.removeFile(rel);
      }
    }
    for (const rel of removed) {
      this.store.removeFile(rel);
    }
    return { changed: indexedPaths, removed };
  }

  private async indexFile(rel: string): Promise<void> {
    const absolute = path.join(this.workspaceRoot, rel);
    const stat = await fs.stat(absolute);
    const language = detectLanguage(rel);
    const indexable = isIndexableText(language, stat.size);
    const content = indexable ? await fs.readFile(absolute, 'utf8') : null;
    const hash = content !== null ? sha1(content) : `${stat.size}:${stat.mtimeMs}`;

    const existing = this.store.getFile(rel);
    if (existing && existing.contentHash === hash) return;

    this.store.upsertFile(
      {
        path: rel,
        language,
        size: stat.size,
        mtime: Math.round(stat.mtimeMs),
        contentHash: hash,
        isMarkdown: isMarkdownPath(rel),
      },
      content,
    );

    if (content !== null) {
      const extractor = extractorForLanguage(language);
      if (extractor) {
        const { symbols, imports } = await extractor.extract(rel, content, this.workspaceRoot);
        this.store.replaceSymbols(rel, symbols);
        this.store.replaceImports(rel, imports);
      }
      if (path.basename(rel) === 'package.json') {
        this.store.replaceDependencies(rel, parsePackageManifest(content));
      }
    }
  }
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}
