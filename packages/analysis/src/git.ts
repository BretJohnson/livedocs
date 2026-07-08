import { simpleGit, type SimpleGit } from 'simple-git';
import type { CommitRecord } from '@livedocs/store';

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
}

const FIELD_SEP = '\u001f';
const COMMIT_SEP = '\u001e';

/** Git metadata reader. Every method degrades gracefully for non-repos. */
export class GitService {
  private readonly git: SimpleGit;

  constructor(workspaceRoot: string) {
    this.git = simpleGit({ baseDir: workspaceRoot });
  }

  async info(): Promise<GitInfo> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) return { isRepo: false };
      const branch = (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      return { isRepo: true, branch };
    } catch {
      return { isRepo: false };
    }
  }

  /** Recent commits with per-commit changed files, newest first. */
  async recentCommits(limit = 50): Promise<CommitRecord[]> {
    try {
      // COMMIT_SEP leads each record so a commit's --name-status lines stay
      // inside its own chunk when splitting.
      const format = `${COMMIT_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s`;
      const raw = await this.git.raw([
        'log',
        `-n${limit}`,
        `--pretty=format:${format}`,
        '--name-status',
      ]);
      return parseLogWithFiles(raw);
    } catch {
      return [];
    }
  }

  async fileHistory(relPath: string, limit = 30): Promise<CommitRecord[]> {
    try {
      const format = `${COMMIT_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%s`;
      const raw = await this.git.raw([
        'log',
        `-n${limit}`,
        `--pretty=format:${format}`,
        '--follow',
        '--',
        relPath,
      ]);
      return parseLogWithFiles(raw);
    } catch {
      return [];
    }
  }

  /** Unified diff of the most recent commits, for AI change summaries. */
  async recentDiff(commits = 5, maxChars = 60_000): Promise<string> {
    try {
      const count = await this.git.raw(['rev-list', '--count', 'HEAD']);
      const n = Math.min(commits, Math.max(parseInt(count.trim(), 10) - 1, 0));
      if (n === 0) return '';
      const diff = await this.git.raw(['diff', `HEAD~${n}`, 'HEAD', '--stat', '--patch']);
      return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n… (diff truncated)` : diff;
    } catch {
      return '';
    }
  }
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
