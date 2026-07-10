import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { CommitRecord } from '@livedocs/store';

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
}

interface RepoContext {
  workspacePathspec?: string;
}

const FIELD_SEP = '\u001f';
const COMMIT_SEP = '\u001e';

/** Git metadata reader. Every method degrades gracefully for non-repos. */
export class GitService {
  private readonly git: SimpleGit;

  constructor(private readonly workspaceRoot: string) {
    this.git = simpleGit({ baseDir: workspaceRoot });
  }

  async info(): Promise<GitInfo> {
    try {
      if (!(await this.repoContext())) return { isRepo: false };
      const branch = (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      return { isRepo: true, branch };
    } catch {
      return { isRepo: false };
    }
  }

  /** Recent commits with per-commit changed files, newest first. */
  async recentCommits(limit = 50): Promise<CommitRecord[]> {
    try {
      const context = await this.repoContext();
      if (!context) return [];
      // COMMIT_SEP leads each record so a commit's --name-status lines stay
      // inside its own chunk when splitting.
      const format = `${COMMIT_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s`;
      const raw = await this.git.raw([
        'log',
        `-n${limit}`,
        `--pretty=format:${format}`,
        '--name-status',
        ...pathspecArgs(context),
      ]);
      return relativizeCommitFiles(parseLogWithFiles(raw), context);
    } catch {
      return [];
    }
  }

  async fileHistory(relPath: string, limit = 30): Promise<CommitRecord[]> {
    try {
      const context = await this.repoContext();
      if (!context) return [];
      const pathspec = pathspecForWorkspacePath(context, relPath);
      if (!pathspec) return [];
      const format = `${COMMIT_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s`;
      const raw = await this.git.raw([
        'log',
        `-n${limit}`,
        `--pretty=format:${format}`,
        '--follow',
        '--',
        pathspec,
      ]);
      return relativizeCommitFiles(parseLogWithFiles(raw), context);
    } catch {
      return [];
    }
  }

  /** Unified diff of the most recent commits, for AI change summaries. */
  async recentDiff(commits = 5, maxChars = 60_000): Promise<string> {
    try {
      const context = await this.repoContext();
      if (!context) return '';
      const hashes = (
        await this.git.raw(['log', `-n${commits + 1}`, '--format=%H', ...pathspecArgs(context)])
      )
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const base = hashes.at(-1);
      if (hashes.length < 2 || !base) return '';
      const diff = await this.git.raw([
        'diff',
        base,
        'HEAD',
        '--stat',
        '--patch',
        ...pathspecArgs(context),
      ]);
      return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n… (diff truncated)` : diff;
    } catch {
      return '';
    }
  }

  private async repoContext(): Promise<RepoContext | null> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) return null;
    const topLevel = (await this.git.revparse(['--show-toplevel'])).trim();
    const relative = path.relative(path.resolve(topLevel), path.resolve(this.workspaceRoot));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return {
      workspacePathspec: normalizeGitPath(relative) || undefined,
    };
  }
}

function normalizeGitPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  return normalized === '.' ? '' : normalized;
}

function workspaceRelativePath(relPath: string): string | null {
  const normalized = normalizeGitPath(relPath);
  if (!normalized || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function pathspecArgs(context: RepoContext): string[] {
  return context.workspacePathspec ? ['--', topPathspec(context.workspacePathspec)] : [];
}

function pathspecForWorkspacePath(context: RepoContext, relPath: string): string | null {
  const normalized = workspaceRelativePath(relPath);
  if (!normalized) return null;
  const repoPath = context.workspacePathspec
    ? path.posix.join(context.workspacePathspec, normalized)
    : normalized;
  return context.workspacePathspec ? topPathspec(repoPath) : repoPath;
}

function topPathspec(repoPath: string): string {
  return `:(top)${repoPath}`;
}

function relativizeCommitFiles(commits: CommitRecord[], context: RepoContext): CommitRecord[] {
  if (!context.workspacePathspec) return commits;
  return commits.map((commit) => ({
    ...commit,
    files: commit.files
      .map((file) => {
        const relative = path.posix.relative(
          context.workspacePathspec ?? '',
          normalizeGitPath(file.path),
        );
        if (!relative || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
          return null;
        }
        return { ...file, path: relative };
      })
      .filter((file): file is CommitRecord['files'][number] => file !== null),
  }));
}

export function parseLogWithFiles(raw: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  for (const chunk of raw.split(COMMIT_SEP)) {
    const text = chunk.replace(/^\n+/, '');
    if (!text.trim()) continue;
    const [headerLine, ...rest] = text.split('\n');
    const fields = headerLine.split(FIELD_SEP);
    if (fields.length < 5) continue;
    const [hash, author, email, date, message] = fields;
    const files = rest
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [status, ...parts] = line.split('\t');
        return { status: status.trim(), path: parts.at(-1) ?? '' };
      })
      .filter((f) => f.path);
    commits.push({ hash, author, email, date, message, files });
  }
  return commits;
}
