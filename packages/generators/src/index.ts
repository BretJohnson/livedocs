import { apiIndexGenerator } from './api-index.js';
import { architectureOverviewGenerator } from './architecture-overview.js';
import { dbSchemaGenerator } from './db-schema.js';
import { dependencyGraphGenerator } from './dependency-graph.js';
import type { Generator } from './types.js';

export type { Generator, GeneratorContext, GeneratorParams, GeneratorResult } from './types.js';
export { apiIndexGenerator } from './api-index.js';
export { dependencyGraphGenerator } from './dependency-graph.js';
export { dbSchemaGenerator, parsePrismaModels, parseSqlTables } from './db-schema.js';
export { architectureOverviewGenerator } from './architecture-overview.js';
export { digestOf } from './mdast-helpers.js';

const registry = new Map<string, Generator>();

export function registerGenerator(generator: Generator): void {
  registry.set(generator.name, generator);
}

export function getGenerator(name: string): Generator | undefined {
  return registry.get(name);
}

export function availableGenerators(): string[] {
  return [...registry.keys()].sort();
}

registerGenerator(apiIndexGenerator);
registerGenerator(dependencyGraphGenerator);
registerGenerator(dbSchemaGenerator);
registerGenerator(architectureOverviewGenerator);
