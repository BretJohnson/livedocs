import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalWorkspaceReference, type TreeNode, type WorkspaceInfo } from '@livedocs/store';
import { WorkspaceService, type WorkspaceIndexerDriver } from '../src/main/node-workspace-service';

function noOpIndexer(): WorkspaceIndexerDriver {
  return {
    fullScan() {},
    applyChanges() {},
    dispose() {},
  };
}

function fileNode(tree: TreeNode | null, relPath: string): TreeNode | undefined {
  if (!tree) return undefined;
  if (tree.type === 'file') return tree.path === relPath ? tree : undefined;
  for (const child of tree.children ?? []) {
    const found = fileNode(child, relPath);
    if (found) return found;
  }
  return undefined;
}

describe('workspace configuration service integration', () => {
  it('reloads document classification even when root livedocs.jsonc is gitignored', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'livedocs-service-config-'));
    const dataDir = path.join(root, '.data');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await mkdir(dataDir);
    await writeFile(path.join(root, '.gitignore'), '*.jsonc\n.data/\n');
    await writeFile(path.join(root, 'README.md'), '# Root\n');
    await writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n');

    let resolveConfigChange: ((info: WorkspaceInfo) => void) | undefined;
    const service = new WorkspaceService({
      dataDir,
      createIndexer: noOpIndexer,
      events: {
        onConfigChanged: (info) => resolveConfigChange?.(info),
      },
    });
    const nextConfigChange = async (action: () => Promise<void>): Promise<WorkspaceInfo> => {
      const changed = new Promise<WorkspaceInfo>((resolve) => {
        resolveConfigChange = resolve;
      });
      await action();
      try {
        return await Promise.race([
          changed,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timed out waiting for config reload')), 10_000),
          ),
        ]);
      } finally {
        resolveConfigChange = undefined;
      }
    };

    try {
      await service.open(createLocalWorkspaceReference(root));
      expect(fileNode(await service.tree(), 'README.md')?.isDocument).toBe(true);

      const validInfo = await nextConfigChange(() =>
        writeFile(path.join(root, 'livedocs.jsonc'), '{ "docs": { "include": ["docs/**"] } }\n'),
      );
      expect(validInfo.configDiagnostic).toBeUndefined();
      expect(fileNode(await service.tree(), 'README.md')?.isDocument).toBe(false);
      expect(fileNode(await service.tree(), 'docs/guide.md')?.isDocument).toBe(true);

      const invalidInfo = await nextConfigChange(() =>
        writeFile(path.join(root, 'livedocs.jsonc'), '{ "docs": { "include": false } }\n'),
      );
      expect(invalidInfo.configDiagnostic?.message).toContain('docs.include');
      expect(fileNode(await service.tree(), 'README.md')?.isDocument).toBe(true);

      const removedInfo = await nextConfigChange(() => unlink(path.join(root, 'livedocs.jsonc')));
      expect(removedInfo.configDiagnostic).toBeUndefined();
      expect(fileNode(await service.tree(), 'README.md')?.isDocument).toBe(true);
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
