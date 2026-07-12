import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { Minimatch } from 'minimatch';
import { isMarkdownPath } from './languages.js';

export const LIVEDOCS_CONFIG_FILENAME = 'livedocs.jsonc';

export interface LiveDocsConfig {
  docs: {
    include: readonly string[];
    exclude: readonly string[];
  };
}

export interface LiveDocsConfigDiagnostic {
  path: typeof LIVEDOCS_CONFIG_FILENAME;
  message: string;
}

export interface LoadedLiveDocsConfig {
  config: LiveDocsConfig;
  diagnostic?: LiveDocsConfigDiagnostic;
}

export interface DocumentSelector {
  isDocument(relPath: string): boolean;
}

export const DEFAULT_LIVEDOCS_CONFIG: LiveDocsConfig = Object.freeze({
  docs: Object.freeze({ include: Object.freeze([]), exclude: Object.freeze([]) }),
});

const MATCH_OPTIONS = {
  dot: true,
  nocase: false,
  windowsPathsNoEscape: true,
} as const;

/** Load and validate only the configuration at the workspace root. */
export async function loadLiveDocsConfig(workspaceRoot: string): Promise<LoadedLiveDocsConfig> {
  const configPath = path.join(workspaceRoot, LIVEDOCS_CONFIG_FILENAME);
  let source: string;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { config: DEFAULT_LIVEDOCS_CONFIG };
    return invalid(`Could not read configuration: ${errorMessage(error)}`);
  }

  try {
    const raw = JSON5.parse(source) as unknown;
    return { config: validateConfig(raw) };
  } catch (error) {
    return invalid(errorMessage(error));
  }
}

/** Compile path matching once for an effective configuration. */
export function createDocumentSelector(config: LiveDocsConfig): DocumentSelector {
  const includes = config.docs.include.map(compileGlob);
  const excludes = config.docs.exclude.map(compileGlob);

  return {
    isDocument(relPath: string): boolean {
      const normalized = normalizeWorkspacePath(relPath);
      if (!isMarkdownPath(normalized)) return false;

      const included = includes.length === 0 || includes.some((glob) => glob.match(normalized));
      if (!included) return false;

      const hasHiddenDirectory = normalized
        .split('/')
        .slice(0, -1)
        .some((segment) => segment.startsWith('.'));
      if (hasHiddenDirectory && includes.length === 0) return false;

      return !excludes.some((glob) => glob.match(normalized));
    },
  };
}

export function normalizeWorkspacePath(relPath: string): string {
  return relPath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function validateConfig(value: unknown): LiveDocsConfig {
  if (!isRecord(value)) throw new Error('Configuration must be a JSON object.');
  if (value.docs === undefined) return DEFAULT_LIVEDOCS_CONFIG;
  if (!isRecord(value.docs)) throw new Error('`docs` must be an object.');

  const include = validateGlobs(value.docs.include, 'docs.include');
  const exclude = validateGlobs(value.docs.exclude, 'docs.exclude');
  return { docs: { include, exclude } };
}

function validateGlobs(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`\`${field}\` must be an array of glob strings.`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.includes('\0')) {
      throw new Error(`\`${field}[${index}]\` must be a non-empty glob string.`);
    }
    try {
      compileGlob(entry);
    } catch (error) {
      throw new Error(`\`${field}[${index}]\` is not a valid glob: ${errorMessage(error)}`);
    }
    return entry;
  });
}

function compileGlob(pattern: string): Minimatch {
  return new Minimatch(pattern.replaceAll('\\', '/'), MATCH_OPTIONS);
}

function invalid(message: string): LoadedLiveDocsConfig {
  return {
    config: DEFAULT_LIVEDOCS_CONFIG,
    diagnostic: { path: LIVEDOCS_CONFIG_FILENAME, message },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
