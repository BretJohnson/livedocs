import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVEDOCS_CONFIG,
  createDocumentSelector,
  loadLiveDocsConfig,
  normalizeWorkspacePath,
} from '../src/workspace-config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'livedocs-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('LiveDocs workspace configuration', () => {
  it('uses defaults when the root config is absent and ignores nested config', async () => {
    const root = await workspace();
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'livedocs.jsonc'), '{"docs":{"include":[]}}');

    await expect(loadLiveDocsConfig(root)).resolves.toEqual({ config: DEFAULT_LIVEDOCS_CONFIG });
  });

  it('parses comments and trailing commas while ignoring unknown properties', async () => {
    const root = await workspace();
    await writeFile(
      path.join(root, 'livedocs.jsonc'),
      `{
        // Documentation display rules
        "docs": {
          "include": ["docs/**",],
          "exclude": ["docs/archive/**"],
          "future": true,
        },
        "anotherFutureOption": {},
      }`,
    );

    await expect(loadLiveDocsConfig(root)).resolves.toEqual({
      config: { docs: { include: ['docs/**'], exclude: ['docs/archive/**'] } },
    });
  });

  it.each([
    ['malformed JSONC', '{"docs": {', /at 1:11/],
    ['non-object root', '[]', /JSON object/],
    ['invalid docs', '{"docs": []}', /`docs` must be an object/],
    ['invalid include type', '{"docs":{"include":"docs/**"}}', /docs\.include/],
    ['empty pattern', '{"docs":{"exclude":[""]}}', /docs\.exclude\[0\]/],
  ])('falls back atomically for %s', async (_name, source, expected) => {
    const root = await workspace();
    await writeFile(path.join(root, 'livedocs.jsonc'), source);

    const result = await loadLiveDocsConfig(root);
    expect(result.config).toBe(DEFAULT_LIVEDOCS_CONFIG);
    expect(result.diagnostic).toEqual({
      path: 'livedocs.jsonc',
      message: expect.stringMatching(expected),
    });
  });
});

describe('document selector', () => {
  it('recognizes Markdown and hides dot-prefixed directories by default', () => {
    const selector = createDocumentSelector(DEFAULT_LIVEDOCS_CONFIG);

    expect(selector.isDocument('README.md')).toBe(true);
    expect(selector.isDocument('docs/guide.markdown')).toBe(true);
    expect(selector.isDocument('docs/guide.ts')).toBe(false);
    expect(selector.isDocument('.agents/skills/review/SKILL.md')).toBe(false);
    expect(selector.isDocument('docs/.drafts/plan.md')).toBe(false);
    expect(selector.isDocument('.README.md')).toBe(true);
  });

  it('selects includes, lets explicit includes opt hidden docs in, and lets excludes win', () => {
    const selector = createDocumentSelector({
      docs: {
        include: ['docs/**', '.agents/skills/**/*.md'],
        exclude: ['**/archive/**', '**/private.md'],
      },
    });

    expect(selector.isDocument('docs/guide.md')).toBe(true);
    expect(selector.isDocument('notes.md')).toBe(false);
    expect(selector.isDocument('.agents/skills/review/SKILL.md')).toBe(true);
    expect(selector.isDocument('.agents/skills/review/private.md')).toBe(false);
    expect(selector.isDocument('docs/archive/old.md')).toBe(false);
  });

  it('treats a broad explicit include as hidden-directory opt-in', () => {
    const selector = createDocumentSelector({
      docs: { include: ['**/*.md'], exclude: [] },
    });

    expect(selector.isDocument('.skills/author/SKILL.md')).toBe(true);
  });

  it('normalizes Windows and POSIX paths to identical matching semantics', () => {
    const selector = createDocumentSelector({
      docs: { include: ['docs/**/*.md'], exclude: ['docs/private/**'] },
    });

    expect(normalizeWorkspacePath('docs\\guides\\start.md')).toBe('docs/guides/start.md');
    expect(selector.isDocument('docs/guides/start.md')).toBe(true);
    expect(selector.isDocument('docs\\guides\\start.md')).toBe(true);
    expect(selector.isDocument('docs\\private\\secret.md')).toBe(false);
  });
});
