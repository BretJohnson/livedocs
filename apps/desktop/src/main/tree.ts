import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createPathFilter, isMarkdownPath } from '@livedocs/analysis';
import type { TreeNode } from '../shared/ipc';

const MAX_NODES = 8000;

/** Build the workspace file tree from disk, honoring ignore rules. */
export async function buildTree(workspaceRoot: string): Promise<TreeNode> {
  const filter = createPathFilter(workspaceRoot);
  let nodes = 0;

  const walk = async (dirRel: string, name: string): Promise<TreeNode> => {
    const children: TreeNode[] = [];
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(path.join(workspaceRoot, dirRel), { withFileTypes: true });
    } catch {
      // Unreadable directory — show it empty rather than failing the tree.
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (nodes >= MAX_NODES) break;
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory() ? filter.ignoresDirectory(rel) : filter.ignores(rel)) continue;
      nodes += 1;
      if (entry.isDirectory()) {
        children.push(await walk(rel, entry.name));
      } else if (entry.isFile()) {
        children.push({
          name: entry.name,
          path: rel,
          type: 'file',
          isMarkdown: isMarkdownPath(rel),
        });
      }
    }
    return { name, path: dirRel, type: 'dir', children };
  };

  return walk('', path.basename(workspaceRoot));
}
