import type { TreeNode } from '../../shared/ipc';

/** Prune a full workspace tree to configured documents, omitting empty branches. */
export function pruneToDocs(node: TreeNode): TreeNode | null {
  if (node.type === 'file') return node.isDocument ? node : null;
  const children = (node.children ?? []).map(pruneToDocs).filter((c): c is TreeNode => c !== null);
  if (children.length === 0) return null;
  return { ...node, children };
}
