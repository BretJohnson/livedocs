import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { openCompatibleDatabase, WORKSPACE_DB_COMPATIBILITY_EPOCH } from './database-lifecycle.js';
import { workspaceMigrations } from './migrations.js';
import { loadBetterSqlite3 } from './sqlite.js';
import type {
  CommitRecord,
  DependencyRecord,
  FileRecord,
  GeneratedArtifact,
  ImportRecord,
  Provenance,
  SearchResult,
  SymbolRecord,
} from './types.js';
import {
  workspaceReferenceName,
  workspaceStorageIdentity,
  type WorkspaceReference,
} from './workspace-ref.js';

const BetterSqlite3 = loadBetterSqlite3();

/** Stable on-disk name for a workspace database, derived from its absolute path. */
export function workspaceDbFileName(workspace: string | WorkspaceReference): string {
  const identity =
    typeof workspace === 'string' ? path.resolve(workspace) : workspaceStorageIdentity(workspace);
  const displayName =
    typeof workspace === 'string'
      ? path.basename(path.resolve(workspace))
      : workspaceReferenceName(workspace);
  const digest = createHash('sha256').update(identity).digest('hex');
  const base = path
    .basename(displayName)
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);
  return `${base}-${digest.slice(0, 16)}.db`;
}

export function openWorkspaceDb(dataDir: string, workspace: string | WorkspaceReference): Database {
  mkdirSync(dataDir, { recursive: true });
  return openCompatibleDatabase({
    filename: path.join(dataDir, workspaceDbFileName(workspace)),
    kind: 'workspace',
    compatibilityEpoch: WORKSPACE_DB_COMPATIBILITY_EPOCH,
    migrations: workspaceMigrations,
    DatabaseConstructor: BetterSqlite3,
    configure: (db) => {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    },
  });
}

/**
 * Typed accessors over a per-workspace SQLite database. All heavy state
 * (index, git metadata, generated artifacts, AI cache) lives here — nothing
 * is written into the user's repository.
 */
export class WorkspaceStore {
  constructor(readonly db: Database) {}

  static open(dataDir: string, workspace: string | WorkspaceReference): WorkspaceStore {
    return new WorkspaceStore(openWorkspaceDb(dataDir, workspace));
  }

  close(): void {
    this.db.close();
  }

  // ---- files & search ----

  upsertFile(file: FileRecord, content: string | null): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO files (path, language, size, mtime, content_hash, is_markdown, indexed_at)
           VALUES (@path, @language, @size, @mtime, @contentHash, @isMarkdown, @indexedAt)
           ON CONFLICT(path) DO UPDATE SET
             language=@language, size=@size, mtime=@mtime, content_hash=@contentHash,
             is_markdown=@isMarkdown, indexed_at=@indexedAt`,
        )
        .run({
          path: file.path,
          language: file.language,
          size: file.size,
          mtime: file.mtime,
          contentHash: file.contentHash,
          isMarkdown: file.isMarkdown ? 1 : 0,
          indexedAt: Date.now(),
        });
      this.db.prepare('DELETE FROM search_index WHERE path = ?').run(file.path);
      if (content !== null) {
        this.db
          .prepare('INSERT INTO search_index (path, content) VALUES (?, ?)')
          .run(file.path, content);
      }
    });
    tx();
  }

  removeFile(filePath: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
      this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
      this.db.prepare('DELETE FROM imports WHERE source_path = ?').run(filePath);
      this.db.prepare('DELETE FROM dependencies WHERE manifest_path = ?').run(filePath);
      this.db.prepare('DELETE FROM search_index WHERE path = ?').run(filePath);
    });
    tx();
  }

  getFile(filePath: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath) as
      Record<string, unknown> | undefined;
    return row ? rowToFile(row) : null;
  }

  listFiles(): FileRecord[] {
    const rows = this.db.prepare('SELECT * FROM files ORDER BY path').all() as Record<
      string,
      unknown
    >[];
    return rows.map(rowToFile);
  }

  fileCount(): number {
    return this.db.prepare('SELECT COUNT(*) AS n FROM files').pluck().get() as number;
  }

  getIndexedContent(filePath: string): string | null {
    const row = this.db
      .prepare('SELECT content FROM search_index WHERE path = ?')
      .pluck()
      .get(filePath) as string | undefined;
    return row ?? null;
  }

  search(query: string, limit = 50): SearchResult[] {
    const terms = query
      .split(/\s+/)
      .map((t) => t.replace(/"/g, '""'))
      .filter(Boolean);
    if (terms.length === 0) return [];
    // Quote each token (avoids FTS5 syntax errors on user input) with prefix matching.
    const match = terms.map((t) => `"${t}"*`).join(' ');
    try {
      const rows = this.db
        .prepare(
          `SELECT s.path AS path,
                  snippet(search_index, 1, '', '', ' … ', 14) AS snippet,
                  f.is_markdown AS is_markdown,
                  f.language AS language
           FROM search_index s
           LEFT JOIN files f ON f.path = s.path
           WHERE search_index MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(match, limit) as Record<string, unknown>[];
      return rows.map((r) => ({
        path: r.path as string,
        snippet: r.snippet as string,
        isMarkdown: Boolean(r.is_markdown),
        language: (r.language as string | null) ?? null,
      }));
    } catch {
      return [];
    }
  }

  // ---- symbols / imports / dependencies ----

  replaceSymbols(filePath: string, symbols: Omit<SymbolRecord, 'filePath'>[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM symbols WHERE file_path = ?').run(filePath);
      const insert = this.db.prepare(
        'INSERT INTO symbols (file_path, name, kind) VALUES (?, ?, ?)',
      );
      for (const s of symbols) insert.run(filePath, s.name, s.kind);
    });
    tx();
  }

  allSymbols(): SymbolRecord[] {
    const rows = this.db
      .prepare('SELECT file_path, name, kind FROM symbols ORDER BY file_path, name')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      filePath: r.file_path as string,
      name: r.name as string,
      kind: r.kind as string,
    }));
  }

  replaceImports(sourcePath: string, imports: Omit<ImportRecord, 'sourcePath'>[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM imports WHERE source_path = ?').run(sourcePath);
      const insert = this.db.prepare(
        'INSERT INTO imports (source_path, specifier, resolved_path) VALUES (?, ?, ?)',
      );
      for (const i of imports) insert.run(sourcePath, i.specifier, i.resolvedPath);
    });
    tx();
  }

  allImports(): ImportRecord[] {
    const rows = this.db
      .prepare('SELECT source_path, specifier, resolved_path FROM imports ORDER BY source_path')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      sourcePath: r.source_path as string,
      specifier: r.specifier as string,
      resolvedPath: (r.resolved_path as string | null) ?? null,
    }));
  }

  replaceDependencies(manifestPath: string, deps: Omit<DependencyRecord, 'manifestPath'>[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM dependencies WHERE manifest_path = ?').run(manifestPath);
      const insert = this.db.prepare(
        'INSERT INTO dependencies (manifest_path, name, version, dep_type) VALUES (?, ?, ?, ?)',
      );
      for (const d of deps) insert.run(manifestPath, d.name, d.version, d.depType);
    });
    tx();
  }

  allDependencies(): DependencyRecord[] {
    const rows = this.db
      .prepare('SELECT manifest_path, name, version, dep_type FROM dependencies ORDER BY name')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      manifestPath: r.manifest_path as string,
      name: r.name as string,
      version: r.version as string,
      depType: r.dep_type as DependencyRecord['depType'],
    }));
  }

  // ---- git ----

  replaceCommits(commits: CommitRecord[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM commits').run();
      this.db.prepare('DELETE FROM commit_files').run();
      const insertCommit = this.db.prepare(
        'INSERT INTO commits (hash, author, email, date, message, seq) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const insertFile = this.db.prepare(
        'INSERT INTO commit_files (commit_hash, path, status) VALUES (?, ?, ?)',
      );
      commits.forEach((c, i) => {
        insertCommit.run(c.hash, c.author, c.email, c.date, c.message, i);
        for (const f of c.files) insertFile.run(c.hash, f.path, f.status);
      });
    });
    tx();
  }

  recentCommits(limit = 30): CommitRecord[] {
    const rows = this.db.prepare('SELECT * FROM commits ORDER BY seq LIMIT ?').all(limit) as Record<
      string,
      unknown
    >[];
    const files = this.db.prepare('SELECT path, status FROM commit_files WHERE commit_hash = ?');
    return rows.map((r) => ({
      hash: r.hash as string,
      author: (r.author as string) ?? '',
      email: (r.email as string) ?? '',
      date: (r.date as string) ?? '',
      message: (r.message as string) ?? '',
      files: (files.all(r.hash) as Record<string, unknown>[]).map((f) => ({
        path: f.path as string,
        status: f.status as string,
      })),
    }));
  }

  // ---- generated artifacts ----

  saveArtifact(artifact: Omit<GeneratedArtifact, 'stale' | 'createdAt'>): void {
    this.db
      .prepare(
        `INSERT INTO generated_artifacts
           (doc_path, generator, params, output, provenance, input_digest, stale, created_at)
         VALUES (@docPath, @generator, @params, @output, @provenance, @inputDigest, 0, @createdAt)
         ON CONFLICT(doc_path, generator, params) DO UPDATE SET
           output=@output, provenance=@provenance, input_digest=@inputDigest,
           stale=0, created_at=@createdAt`,
      )
      .run({
        docPath: artifact.docPath,
        generator: artifact.generator,
        params: artifact.params,
        output: artifact.output,
        provenance: JSON.stringify(artifact.provenance),
        inputDigest: artifact.inputDigest,
        createdAt: Date.now(),
      });
  }

  getArtifact(docPath: string, generator: string, params: string): GeneratedArtifact | null {
    const row = this.db
      .prepare(
        'SELECT * FROM generated_artifacts WHERE doc_path = ? AND generator = ? AND params = ?',
      )
      .get(docPath, generator, params) as Record<string, unknown> | undefined;
    return row ? rowToArtifact(row) : null;
  }

  allArtifacts(): GeneratedArtifact[] {
    const rows = this.db.prepare('SELECT * FROM generated_artifacts').all() as Record<
      string,
      unknown
    >[];
    return rows.map(rowToArtifact);
  }

  setArtifactStale(docPath: string, generator: string, params: string, stale: boolean): void {
    this.db
      .prepare(
        'UPDATE generated_artifacts SET stale = ? WHERE doc_path = ? AND generator = ? AND params = ?',
      )
      .run(stale ? 1 : 0, docPath, generator, params);
  }

  // ---- ai cache ----

  aiCacheGet(key: string): { response: string; model: string; createdAt: number } | null {
    const row = this.db.prepare('SELECT * FROM ai_cache WHERE key = ?').get(key) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      response: row.response as string,
      model: row.model as string,
      createdAt: row.created_at as number,
    };
  }

  aiCacheSet(key: string, response: string, model: string): void {
    this.db
      .prepare(
        `INSERT INTO ai_cache (key, response, model, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET response=excluded.response, model=excluded.model,
           created_at=excluded.created_at`,
      )
      .run(key, response, model, Date.now());
  }
}

function rowToFile(row: Record<string, unknown>): FileRecord {
  return {
    path: row.path as string,
    language: (row.language as string | null) ?? null,
    size: row.size as number,
    mtime: row.mtime as number,
    contentHash: row.content_hash as string,
    isMarkdown: Boolean(row.is_markdown),
  };
}

function rowToArtifact(row: Record<string, unknown>): GeneratedArtifact {
  return {
    docPath: row.doc_path as string,
    generator: row.generator as string,
    params: row.params as string,
    output: row.output as string,
    provenance: JSON.parse(row.provenance as string) as Provenance,
    inputDigest: row.input_digest as string,
    stale: Boolean(row.stale),
    createdAt: row.created_at as number,
  };
}
