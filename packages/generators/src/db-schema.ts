import type { Provenance } from '@livedocs/store';
import { digestOf, heading, inlineCode, paragraph, root, table, text } from './mdast-helpers.js';
import type { Generator, GeneratorContext } from './types.js';
import type { RootContent } from 'mdast';

interface ParsedModel {
  source: string;
  name: string;
  fields: { name: string; type: string }[];
}

function schemaFiles(ctx: GeneratorContext): { path: string; content: string }[] {
  return ctx.store
    .listFiles()
    .filter((f) => f.language === 'prisma' || f.language === 'sql')
    .map((f) => ({ path: f.path, content: ctx.store.getIndexedContent(f.path) ?? '' }))
    .filter((f) => f.content.length > 0);
}

export function parsePrismaModels(path: string, content: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const modelRe = /(?:^|\n)\s*model\s+(\w+)\s*\{([^}]*)\}/g;
  for (const match of content.matchAll(modelRe)) {
    const [, name, body] = match;
    const fields = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'))
      .map((line) => {
        const [fieldName, fieldType] = line.split(/\s+/);
        return { name: fieldName ?? '', type: fieldType ?? '' };
      })
      .filter((f) => f.name && f.type);
    models.push({ source: path, name, fields });
  }
  return models;
}

export function parseSqlTables(path: string, content: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const tableRe =
    /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi;
  for (const match of content.matchAll(tableRe)) {
    const [, name, body] = match;
    const fields = body
      .split(',')
      .map((line) => line.trim())
      .filter((line) => line && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line))
      .map((line) => {
        const [fieldName, ...rest] = line.split(/\s+/);
        return { name: fieldName.replace(/[`"[\]]/g, ''), type: rest.join(' ') };
      })
      .filter((f) => f.name);
    models.push({ source: path, name, fields });
  }
  return models;
}

/** Deterministic database schema summary from Prisma schemas and SQL DDL. */
export const dbSchemaGenerator: Generator = {
  name: 'db-schema',
  kind: 'deterministic',
  description: 'Database schema summary detected from Prisma schema files and SQL DDL',
  inputDigest: (ctx) => digestOf(schemaFiles(ctx)),
  async generate(ctx) {
    const files = schemaFiles(ctx);
    const inputDigest = digestOf(files);
    const models = files.flatMap((f) =>
      f.path.endsWith('.prisma')
        ? parsePrismaModels(f.path, f.content)
        : parseSqlTables(f.path, f.content),
    );

    const provenance: Provenance = {
      generator: 'db-schema',
      kind: 'deterministic',
      timestamp: new Date().toISOString(),
      inputDigest,
      inputSummary:
        files.length > 0
          ? `${models.length} models/tables from ${files.map((f) => f.path).join(', ')}`
          : 'no schema definitions found',
    };

    if (models.length === 0) {
      return {
        root: root([
          paragraph(
            'No database schema input was found in this workspace (looked for Prisma schema files and SQL DDL).',
          ),
        ]),
        provenance,
        inputDigest,
      };
    }

    const children: RootContent[] = models.flatMap((model): RootContent[] => [
      heading(4, model.name),
      paragraph([text('Defined in '), inlineCode(model.source)]),
      table(
        ['Field', 'Type'],
        model.fields.map((f) => [[inlineCode(f.name)], [text(f.type)]]),
      ),
    ]);

    return { root: root(children), provenance, inputDigest };
  },
};
