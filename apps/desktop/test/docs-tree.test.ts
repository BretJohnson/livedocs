import { describe, expect, it } from 'vitest';
import type { TreeNode } from '@livedocs/store';
import { pruneToDocs } from '../src/renderer/src/docs-tree';

describe('docs tree pruning', () => {
  it('keeps selected documents and removes files and branches with no selected documents', () => {
    const tree: TreeNode = {
      name: 'workspace',
      path: '',
      type: 'dir',
      children: [
        { name: 'README.md', path: 'README.md', type: 'file', isMarkdown: true, isDocument: true },
        { name: 'source.ts', path: 'source.ts', type: 'file', isMarkdown: false },
        {
          name: '.agents',
          path: '.agents',
          type: 'dir',
          children: [
            {
              name: 'SKILL.md',
              path: '.agents/SKILL.md',
              type: 'file',
              isMarkdown: true,
              isDocument: false,
            },
          ],
        },
      ],
    };

    expect(pruneToDocs(tree)).toEqual({
      ...tree,
      children: [tree.children![0]],
    });
  });

  it('returns null when no selected documents remain', () => {
    expect(
      pruneToDocs({
        name: 'workspace',
        path: '',
        type: 'dir',
        children: [
          { name: 'hidden.md', path: '.drafts/hidden.md', type: 'file', isDocument: false },
        ],
      }),
    ).toBeNull();
  });
});
