import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';

const require = createRequire(import.meta.url);

export function loadBetterSqlite3(): typeof BetterSqlite3 {
  const moduleId = process.env.LIVEDOCS_BETTER_SQLITE3 || 'better-sqlite3';
  return require(moduleId) as typeof BetterSqlite3;
}
