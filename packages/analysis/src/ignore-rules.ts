import { readFileSync } from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** Paths excluded from watching/indexing even without a .gitignore. */
export const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  '.cache',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'target',
  '.DS_Store',
];

export interface PathFilter {
  /** True when the workspace-relative path should be ignored. */
  ignores(relPath: string): boolean;
  /**
   * True when the workspace-relative *directory* path should be ignored.
   * Directory-only `.gitignore` rules (e.g. `secret/`) match the directory
   * boundary rather than the bare path, so callers that know an entry is a
   * directory must use this to avoid traversing/watching ignored directories.
   */
  ignoresDirectory(relPath: string): boolean;
}

/** Build an ignore filter from defaults plus the workspace's root .gitignore. */
export function createPathFilter(workspaceRoot: string): PathFilter {
  const ig: Ignore = ignore();
  ig.add(DEFAULT_IGNORES.map((d) => `${d}/`));
  ig.add(DEFAULT_IGNORES);
  try {
    ig.add(readFileSync(path.join(workspaceRoot, '.gitignore'), 'utf8'));
  } catch {
    // No .gitignore — defaults only.
  }
  const normalize = (relPath: string): string => relPath.split(path.sep).join('/');
  return {
    ignores(relPath: string): boolean {
      const normalized = normalize(relPath);
      if (!normalized || normalized === '.') return false;
      return ig.ignores(normalized);
    },
    ignoresDirectory(relPath: string): boolean {
      const normalized = normalize(relPath);
      if (!normalized || normalized === '.') return false;
      // Check both the bare path and the directory boundary so directory-only
      // rules (`secret/`) match while file rules still apply.
      return ig.ignores(normalized) || ig.ignores(`${normalized}/`);
    },
  };
}
