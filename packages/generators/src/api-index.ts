import type { Provenance } from '@livedocs/store';
import {
  digestOf,
  heading,
  inlineCode,
  list,
  listItem,
  paragraph,
  root,
  text,
} from './mdast-helpers.js';
import type { Generator, GeneratorContext } from './types.js';

function snapshot(ctx: GeneratorContext) {
  return ctx.store.allSymbols().map((s) => [s.filePath, s.name, s.kind]);
}

/** Deterministic index of exported symbols, grouped by file. */
export const apiIndexGenerator: Generator = {
  name: 'api-index',
  kind: 'deterministic',
  description: 'Index of exported symbols grouped by source file',
  inputDigest: (ctx) => digestOf(snapshot(ctx)),
  async generate(ctx) {
    const symbols = ctx.store.allSymbols();
    const inputDigest = digestOf(symbols.map((s) => [s.filePath, s.name, s.kind]));
    const provenance: Provenance = {
      generator: 'api-index',
      kind: 'deterministic',
      timestamp: new Date().toISOString(),
      inputDigest,
      inputSummary: `${symbols.length} exported symbols from the workspace index`,
    };

    if (symbols.length === 0) {
      return {
        root: root([paragraph('No exported symbols were found in the workspace index.')]),
        provenance,
        inputDigest,
      };
    }

    const byFile = new Map<string, typeof symbols>();
    for (const s of symbols) {
      const bucket = byFile.get(s.filePath) ?? [];
      bucket.push(s);
      byFile.set(s.filePath, bucket);
    }

    const children = [...byFile.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([filePath, fileSymbols]) => [
        heading(4, filePath),
        list(
          fileSymbols
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => listItem([inlineCode(s.name), text(` — ${s.kind}`)])),
        ),
      ]);

    return { root: root(children), provenance, inputDigest };
  },
};
