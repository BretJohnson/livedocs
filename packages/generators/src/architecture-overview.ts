import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';
import type { Provenance } from '@livedocs/store';
import { digestOf, paragraph, root } from './mdast-helpers.js';
import type { Generator, GeneratorContext } from './types.js';

interface ModuleSnapshot {
  dir: string;
  files: number;
  languages: string[];
  exports: string[];
}

function moduleSnapshot(ctx: GeneratorContext): {
  modules: ModuleSnapshot[];
  deps: string[];
  readme: string;
} {
  const files = ctx.store.listFiles();
  const symbols = ctx.store.allSymbols();
  const byDir = new Map<string, { files: number; languages: Set<string> }>();
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, 2).join('/') : '(root)';
    const bucket = byDir.get(dir) ?? { files: 0, languages: new Set<string>() };
    bucket.files += 1;
    if (f.language) bucket.languages.add(f.language);
    byDir.set(dir, bucket);
  }
  const exportsByDir = new Map<string, string[]>();
  for (const s of symbols) {
    const dir = s.filePath.includes('/') ? s.filePath.split('/').slice(0, 2).join('/') : '(root)';
    const bucket = exportsByDir.get(dir) ?? [];
    if (bucket.length < 25) bucket.push(s.name);
    exportsByDir.set(dir, bucket);
  }
  const modules = [...byDir.entries()]
    .sort(([, a], [, b]) => b.files - a.files)
    .slice(0, 40)
    .map(([dir, info]) => ({
      dir,
      files: info.files,
      languages: [...info.languages].sort(),
      exports: exportsByDir.get(dir) ?? [],
    }));
  const deps = ctx.store
    .allDependencies()
    .filter((d) => d.depType === 'prod')
    .map((d) => d.name)
    .slice(0, 60);
  const readmeFile = files.find((f) => f.path.toLowerCase() === 'readme.md');
  const readme = readmeFile
    ? (ctx.store.getIndexedContent(readmeFile.path) ?? '').split('\n').slice(0, 40).join('\n')
    : '';
  return { modules, deps, readme };
}

const SYSTEM_PROMPT = `You are a senior engineer writing concise architecture documentation.
Given a structural snapshot of a repository (directories, file counts, languages, exported
symbols, dependencies), write a short module/architecture overview in Markdown.
Rules: use only the provided data — never invent modules or behavior; 150-300 words;
start with a one-paragraph summary, then a bullet list of the main modules with one line each;
plain Markdown only (no front matter, no top-level heading).`;

/** AI-generated summary of the module structure captured in the index. */
export const architectureOverviewGenerator: Generator = {
  name: 'architecture-overview',
  kind: 'ai',
  description: 'AI-written overview of the module structure from the repository index',
  inputDigest(ctx) {
    const { modules, deps } = moduleSnapshot(ctx);
    return digestOf({ modules, deps, model: ctx.ai?.model ?? ctx.modelHint ?? null });
  },
  async generate(ctx) {
    if (!ctx.ai) {
      throw new Error('architecture-overview requires a configured AI provider');
    }
    const { modules, deps, readme } = moduleSnapshot(ctx);
    const inputDigest = this.inputDigest(ctx, {});
    const promptPayload = JSON.stringify(
      { modules, dependencies: deps, readmeExcerpt: readme },
      null,
      2,
    );

    const result = await ctx.ai.stream({
      system: SYSTEM_PROMPT,
      prompt: `Repository snapshot:\n\n${promptPayload}`,
      inputDigest,
    });

    let parsed: Root;
    try {
      parsed = unified().use(remarkParse).use(remarkGfm).parse(result.text) as Root;
    } catch {
      parsed = root([paragraph(result.text)]);
    }

    const provenance: Provenance = {
      generator: 'architecture-overview',
      kind: 'ai',
      model: result.provenance.model,
      timestamp: result.provenance.timestamp,
      inputDigest,
      cacheHit: result.provenance.cacheHit,
      inputSummary: `${modules.length} module buckets, ${deps.length} dependencies`,
    };
    return { root: parsed, provenance, inputDigest };
  },
};
