import type { Provenance } from '@livedocs/store';
import { code, digestOf, paragraph, root } from './mdast-helpers.js';
import type { Generator, GeneratorContext, GeneratorParams } from './types.js';

const MAX_EDGES = 80;

/** Collapse a file path to a module bucket (top one or two segments). */
function moduleBucket(filePath: string, depth: number): string {
  const parts = filePath.split('/');
  return parts.slice(0, Math.min(depth, parts.length - 1) || 1).join('/') || filePath;
}

function sanitizeId(name: string): string {
  return `n_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function internalEdges(ctx: GeneratorContext, depth: number): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const imp of ctx.store.allImports()) {
    if (!imp.resolvedPath) continue;
    const from = moduleBucket(imp.sourcePath, depth);
    const to = moduleBucket(imp.resolvedPath, depth);
    if (from === to) continue;
    const set = edges.get(from) ?? new Set<string>();
    set.add(to);
    edges.set(from, set);
  }
  return edges;
}

function buildInputs(ctx: GeneratorContext, params: GeneratorParams) {
  const depth = params.depth ? Math.max(1, parseInt(params.depth, 10) || 2) : 2;
  const edges = internalEdges(ctx, depth);
  const deps = ctx.store.allDependencies().filter((d) => d.depType === 'prod');
  return { depth, edges, deps };
}

/** Deterministic module/package dependency diagram, emitted as Mermaid. */
export const dependencyGraphGenerator: Generator = {
  name: 'dependency-graph',
  kind: 'deterministic',
  description: 'Module or package dependency diagram derived from the repository index',
  inputDigest(ctx, params) {
    const { edges, deps } = buildInputs(ctx, params);
    return digestOf([
      [...edges.entries()].map(([k, v]) => [k, [...v].sort()]).sort(),
      deps.map((d) => [d.manifestPath, d.name]),
    ]);
  },
  async generate(ctx, params) {
    const { edges, deps } = buildInputs(ctx, params);
    const inputDigest = this.inputDigest(ctx, params);

    const lines: string[] = ['graph LR'];
    let edgeCount = 0;
    let summary: string;

    if (edges.size > 0) {
      outer: for (const [from, targets] of [...edges.entries()].sort()) {
        for (const to of [...targets].sort()) {
          lines.push(`  ${sanitizeId(from)}["${from}"] --> ${sanitizeId(to)}["${to}"]`);
          edgeCount += 1;
          if (edgeCount >= MAX_EDGES) break outer;
        }
      }
      summary = `${edgeCount} internal module import edges`;
    } else if (deps.length > 0) {
      // No resolvable internal imports — fall back to manifest dependencies.
      lines.push('  root(("project"))');
      for (const dep of deps.slice(0, MAX_EDGES)) {
        lines.push(`  root --> ${sanitizeId(dep.name)}["${dep.name}"]`);
        edgeCount += 1;
      }
      summary = `${edgeCount} direct dependencies from package manifests`;
    } else {
      const provenance: Provenance = {
        generator: 'dependency-graph',
        kind: 'deterministic',
        timestamp: new Date().toISOString(),
        inputDigest,
        inputSummary: 'no analyzable dependencies',
      };
      return {
        root: root([
          paragraph(
            'No analyzable dependencies were found — the workspace has no resolvable internal imports and no recognized dependency manifest.',
          ),
        ]),
        provenance,
        inputDigest,
      };
    }

    const provenance: Provenance = {
      generator: 'dependency-graph',
      kind: 'deterministic',
      timestamp: new Date().toISOString(),
      inputDigest,
      inputSummary: summary,
    };
    const children = [code('mermaid', lines.join('\n'))];
    if (edgeCount >= MAX_EDGES) {
      children.push(code('text', `(truncated at ${MAX_EDGES} edges)`));
    }
    return { root: root(children), provenance, inputDigest };
  },
};
