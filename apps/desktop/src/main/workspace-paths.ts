import path from 'node:path';

export function resolveInWorkspace(workspaceRoot: string, relPath: string): string {
  const absolute = path.resolve(workspaceRoot, relPath);
  const relative = path.relative(workspaceRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the workspace');
  }
  return absolute;
}
