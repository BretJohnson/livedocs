import { existsSync, rmSync, statSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import type { Migration } from './migrations.js';
import { runMigrations, validateMigrationVersion } from './migrations.js';

export const APP_DB_COMPATIBILITY_EPOCH = 1;
export const WORKSPACE_DB_COMPATIBILITY_EPOCH = 1;

const METADATA_TABLE = 'livedocs_database_metadata';
const EPOCH_KEY = 'compatibility_epoch';

export type DatabaseKind = 'app' | 'workspace';

export interface OpenCompatibleDatabaseOptions {
  filename: string;
  kind: DatabaseKind;
  compatibilityEpoch: number;
  migrations: Migration[];
  DatabaseConstructor: typeof BetterSqlite3;
  configure?: (db: Database) => void;
  onReset?: (message: string) => void;
}

export function readCompatibilityEpoch(db: Database): number | null {
  const hasMetadata = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .pluck()
    .get(METADATA_TABLE);
  if (!hasMetadata) return null;
  const stored = db
    .prepare(`SELECT value FROM ${METADATA_TABLE} WHERE key = ?`)
    .pluck()
    .get(EPOCH_KEY) as string | undefined;
  if (stored === undefined) return null;
  const epoch = Number(stored);
  return Number.isSafeInteger(epoch) && epoch >= 0 ? epoch : null;
}

export function openCompatibleDatabase(options: OpenCompatibleDatabaseOptions): Database {
  const existed = existsSync(options.filename) && statSync(options.filename).size > 0;
  let db: Database | null;
  try {
    db = new options.DatabaseConstructor(options.filename);
  } catch (error) {
    throw new Error(
      `Failed to inspect ${options.kind} database compatibility epoch: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  let storedEpoch: number | null = options.compatibilityEpoch;
  let resetFrom: string | null = null;
  if (existed) {
    try {
      storedEpoch = readCompatibilityEpoch(db);
    } catch {
      db.close();
      db = null;
      resetFrom = 'unreadable';
    }
  }

  if (db && existed && storedEpoch !== options.compatibilityEpoch) {
    db.close();
    db = null;
    resetFrom = storedEpoch === null ? 'legacy' : String(storedEpoch);
  }

  if (resetFrom !== null) {
    const message = `[livedocs-store] Resetting ${options.kind} database compatibility epoch ${resetFrom} -> ${options.compatibilityEpoch}`;
    (options.onReset ?? console.info)(message);
    try {
      removeDatabaseFiles(options.filename);
      db = new options.DatabaseConstructor(options.filename);
    } catch (error) {
      throw new Error(
        `Failed to reset ${options.kind} database compatibility epoch ${resetFrom} -> ${options.compatibilityEpoch}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  if (!db) {
    throw new Error(`Failed to open ${options.kind} database after compatibility inspection`);
  }

  try {
    validateMigrationVersion(db, options.migrations);
    initializeCompatibilityEpoch(db, options.compatibilityEpoch);
    options.configure?.(db);
    runMigrations(db, options.migrations);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeCompatibilityEpoch(db: Database, epoch: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${METADATA_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run(
    EPOCH_KEY,
    String(epoch),
  );
}

function removeDatabaseFiles(filename: string): void {
  for (const suffix of ['-wal', '-shm', '']) {
    rmSync(`${filename}${suffix}`, {
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
