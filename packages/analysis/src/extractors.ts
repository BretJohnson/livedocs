import { existsSync } from 'node:fs';
import path from 'node:path';
import { init as esLexerInit, parse as esLexerParse } from 'es-module-lexer';

export interface ExtractedSymbol {
  name: string;
  kind: string;
}

export interface ExtractedImport {
  specifier: string;
  /** Workspace-relative path when the specifier resolves to a file in the workspace. */
  resolvedPath: string | null;
}

export interface Extraction {
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
}

export interface LanguageExtractor {
  languages: string[];
  extract(relPath: string, content: string, workspaceRoot: string): Promise<Extraction>;
}

const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
];

function resolveRelativeImport(
  specifier: string,
  fromRelPath: string,
  workspaceRoot: string,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const baseDir = path.dirname(fromRelPath);
  const joined = path.join(baseDir, specifier);
  // "./foo.js" in TS source often means "./foo.ts" on disk.
  const candidates = [
    joined,
    joined.replace(/\.(js|mjs|cjs)$/, '.ts'),
    joined.replace(/\.(js|jsx)$/, '.tsx'),
  ];
  for (const candidate of candidates) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const rel = candidate + suffix;
      if (existsSync(path.join(workspaceRoot, rel))) {
        return rel.split(path.sep).join('/');
      }
    }
  }
  return null;
}

/**
 * Fast lexer-based extractor for exported symbols and the import graph.
 * es-module-lexer is not a full TS parser; files it cannot lex simply yield
 * no symbols (the file stays indexed). A ts-morph-based extractor can replace
 * this behind the same interface if fidelity becomes a problem.
 */
export const tsJsExtractor: LanguageExtractor = {
  languages: ['typescript', 'javascript'],
  async extract(relPath, content, workspaceRoot) {
    await esLexerInit;
    try {
      const [imports, exports] = esLexerParse(content, relPath);
      const seenImports = new Map<string, ExtractedImport>();
      for (const imp of imports) {
        const specifier = imp.n;
        if (!specifier || seenImports.has(specifier)) continue;
        seenImports.set(specifier, {
          specifier,
          resolvedPath: resolveRelativeImport(specifier, relPath, workspaceRoot),
        });
      }
      const symbols: ExtractedSymbol[] = [];
      const seenSymbols = new Set<string>();
      for (const exp of exports) {
        if (!exp.n || seenSymbols.has(exp.n)) continue;
        seenSymbols.add(exp.n);
        symbols.push({ name: exp.n, kind: 'export' });
      }
      return { symbols, imports: [...seenImports.values()] };
    } catch {
      return { symbols: [], imports: [] };
    }
  },
};

const extractors: LanguageExtractor[] = [tsJsExtractor];

export function extractorForLanguage(language: string | null): LanguageExtractor | null {
  if (!language) return null;
  return extractors.find((e) => e.languages.includes(language)) ?? null;
}
