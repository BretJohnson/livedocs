// electron-rebuild (run from apps/desktop) traverses workspace links and also
// rebuilds @livedocs/store's better-sqlite3 copy for Electron's ABI. That copy
// must stay Node-ABI so Vitest can load it. This script rebuilds it for Node.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const storePkg = path.join(root, '..', 'packages', 'store', 'package.json');
const require = createRequire(storePkg);
const moduleDir = realpathSync(path.dirname(require.resolve('better-sqlite3/package.json')));

try {
  // Cheap check: if it already loads under this Node, nothing to do.
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
  console.log('[rebuild-store-sqlite] store better-sqlite3 already Node-ABI, skipping');
} catch {
  console.log(`[rebuild-store-sqlite] rebuilding ${moduleDir} for Node ${process.version}`);
  execSync('npm run install', { cwd: moduleDir, stdio: 'inherit' });
}
