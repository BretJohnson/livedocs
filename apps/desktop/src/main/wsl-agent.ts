import { existsSync } from 'node:fs';
import path from 'node:path';

function configureAgentSqliteModule(): void {
  if (process.env.LIVEDOCS_BETTER_SQLITE3) return;
  const candidates = [
    path.resolve(import.meta.dirname, '../../../../packages/store/node_modules/better-sqlite3'),
    path.resolve(process.cwd(), 'packages/store/node_modules/better-sqlite3'),
  ];
  const moduleDir = candidates.find((candidate) =>
    existsSync(path.join(candidate, 'package.json')),
  );
  if (moduleDir) process.env.LIVEDOCS_BETTER_SQLITE3 = moduleDir;
}

configureAgentSqliteModule();

const { runWslAgent } = await import('./wsl-agent-runner');

void runWslAgent().catch((err) => {
  console.error('[livedocs-agent] fatal:', err);
  process.exit(1);
});
