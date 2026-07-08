import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '@livedocs/store';
import { AIService } from '@livedocs/ai';
import type { Code, Paragraph, Text } from 'mdast';
import {
  apiIndexGenerator,
  architectureOverviewGenerator,
  availableGenerators,
  dbSchemaGenerator,
  dependencyGraphGenerator,
  getGenerator,
  type GeneratorContext,
} from '../src/index.js';

let dir: string;
let store: WorkspaceStore;
let ctx: GeneratorContext;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'livedocs-gen-'));
  store = WorkspaceStore.open(dir, '/gen/workspace');
  ctx = { store, workspaceRoot: '/gen/workspace' };
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function addFile(filePath: string, language: string, content: string): void {
  store.upsertFile(
    {
      path: filePath,
      language,
      size: content.length,
      mtime: Date.now(),
      contentHash: content.slice(0, 8),
      isMarkdown: language === 'markdown',
    },
    content,
  );
}

function firstParagraphText(root: { children: unknown[] }): string {
  const para = root.children[0] as Paragraph;
  return (para.children[0] as Text).value;
}

describe('registry', () => {
  it('exposes the four foundation generators', () => {
    expect(availableGenerators()).toEqual([
      'api-index',
      'architecture-overview',
      'db-schema',
      'dependency-graph',
    ]);
    expect(getGenerator('api-index')?.kind).toBe('deterministic');
    expect(getGenerator('architecture-overview')?.kind).toBe('ai');
    expect(getGenerator('nope')).toBeUndefined();
  });
});

describe('api-index', () => {
  it('reports missing input instead of fabricating', async () => {
    const result = await apiIndexGenerator.generate(ctx, {});
    expect(firstParagraphText(result.root)).toMatch(/No exported symbols/);
  });

  it('groups symbols by file and digests change with the symbol table', async () => {
    store.replaceSymbols('src/a.ts', [{ name: 'alpha', kind: 'export' }]);
    const digest1 = apiIndexGenerator.inputDigest(ctx, {});
    const result = await apiIndexGenerator.generate(ctx, {});
    expect(result.inputDigest).toBe(digest1);
    expect(JSON.stringify(result.root)).toContain('alpha');
    expect(result.provenance.kind).toBe('deterministic');

    store.replaceSymbols('src/a.ts', [{ name: 'beta', kind: 'export' }]);
    expect(apiIndexGenerator.inputDigest(ctx, {})).not.toBe(digest1);
  });
});

describe('dependency-graph', () => {
  it('emits mermaid from internal import edges', async () => {
    store.replaceImports('src/app/main.ts', [
      { specifier: '../lib/util', resolvedPath: 'src/lib/util.ts' },
    ]);
    const result = await dependencyGraphGenerator.generate(ctx, {});
    const codeNode = result.root.children[0] as Code;
    expect(codeNode.type).toBe('code');
    expect(codeNode.lang).toBe('mermaid');
    expect(codeNode.value).toContain('graph LR');
    expect(codeNode.value).toContain('src/app');
    expect(codeNode.value).toContain('src/lib');
  });

  it('falls back to manifest dependencies when no imports resolve', async () => {
    store.replaceDependencies('package.json', [
      { name: 'react', version: '^19.0.0', depType: 'prod' },
    ]);
    const result = await dependencyGraphGenerator.generate(ctx, {});
    const codeNode = result.root.children[0] as Code;
    expect(codeNode.value).toContain('react');
  });

  it('states when nothing is analyzable', async () => {
    const result = await dependencyGraphGenerator.generate(ctx, {});
    expect(firstParagraphText(result.root)).toMatch(/No analyzable dependencies/);
  });

  it('staleness: digest changes when the import graph changes', () => {
    const before = dependencyGraphGenerator.inputDigest(ctx, {});
    // Import crossing module buckets (src/app → src/lib) creates a new edge.
    store.replaceImports('src/app/x.ts', [{ specifier: '../lib/y', resolvedPath: 'src/lib/y.ts' }]);
    expect(dependencyGraphGenerator.inputDigest(ctx, {})).not.toBe(before);
  });
});

describe('db-schema', () => {
  it('parses Prisma models', async () => {
    addFile(
      'prisma/schema.prisma',
      'prisma',
      'model User {\n  id Int @id\n  email String\n}\nmodel Post {\n  id Int @id\n}\n',
    );
    const result = await dbSchemaGenerator.generate(ctx, {});
    const json = JSON.stringify(result.root);
    expect(json).toContain('User');
    expect(json).toContain('email');
    expect(json).toContain('Post');
  });

  it('parses SQL DDL', async () => {
    addFile('db/init.sql', 'sql', 'CREATE TABLE users (\n id INTEGER PRIMARY KEY,\n name TEXT\n);');
    const result = await dbSchemaGenerator.generate(ctx, {});
    const json = JSON.stringify(result.root);
    expect(json).toContain('users');
    expect(json).toContain('name');
  });

  it('says no input was found when the workspace has no schema', async () => {
    const result = await dbSchemaGenerator.generate(ctx, {});
    expect(firstParagraphText(result.root)).toMatch(/No database schema input was found/);
  });
});

describe('architecture-overview (ai)', () => {
  function aiCtx(): GeneratorContext {
    const cache = new Map<string, { response: string; model: string }>();
    return {
      ...ctx,
      ai: new AIService(
        { provider: 'mock', model: 'mock-model' },
        {
          get: (k) => cache.get(k) ?? null,
          set: (k, response, model) => void cache.set(k, { response, model }),
        },
      ),
    };
  }

  it('requires a configured AI service', async () => {
    await expect(architectureOverviewGenerator.generate(ctx, {})).rejects.toThrow(/AI provider/);
  });

  it('produces mdast with AI provenance, and caches by input digest', async () => {
    addFile('src/index.ts', 'typescript', 'export const x = 1;');
    const context = aiCtx();
    const first = await architectureOverviewGenerator.generate(context, {});
    expect(first.provenance.kind).toBe('ai');
    expect(first.provenance.model).toBe('mock-model');
    expect(first.provenance.cacheHit).toBe(false);
    expect(first.root.type).toBe('root');
    expect(first.root.children.length).toBeGreaterThan(0);

    const second = await architectureOverviewGenerator.generate(context, {});
    expect(second.provenance.cacheHit).toBe(true);

    // Changing the indexed structure changes the digest (→ staleness).
    addFile('src/new-module.ts', 'typescript', 'export const y = 2;');
    expect(architectureOverviewGenerator.inputDigest(context, {})).not.toBe(first.inputDigest);
  });
});
