import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const MIRROR_FORMAT = 1;
export const METADATA_DIR = '.livedocs-mirror';
export const OWNER_FILE = `${METADATA_DIR}/owner.json`;
export const MANIFEST_FILE = `${METADATA_DIR}/source-manifest.json`;
export const FINGERPRINT_FILE = `${METADATA_DIR}/windows-dependencies.json`;
export const SESSION_FILE = `${METADATA_DIR}/session.json`;
export const MODES = new Set(['dev', 'build', 'dist', 'launch', 'clean']);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'out',
  'dist',
  'build',
  'release',
  'coverage',
  'playwright-report',
  'test-results',
  METADATA_DIR,
]);

export function isWsl(env = process.env, procVersion = '') {
  return Boolean(env.WSL_INTEROP || env.WSL_DISTRO_NAME || /microsoft|wsl/i.test(procVersion));
}

export function canonicalDistro(value) {
  const distro = value?.trim();
  if (!distro || /[\0\r\n]/.test(distro)) throw new Error('A valid WSL distro name is required.');
  return distro;
}

export function canonicalPosixPath(value) {
  if (!value || value.includes('\0')) throw new Error('A valid POSIX checkout path is required.');
  const normalized = path.posix.resolve('/', value);
  if (!normalized.startsWith('/')) throw new Error(`Invalid POSIX checkout path: ${value}`);
  return normalized;
}

export function mirrorIdentity(distro, checkoutPath) {
  const source = `${canonicalDistro(distro)}\0${canonicalPosixPath(checkoutPath)}`;
  const slug =
    canonicalDistro(distro)
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-|-$/g, '') || 'wsl';
  return `${slug}-${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
}

export function normalizeRelative(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('\0'))
    throw new Error('Invalid mirror path.');
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Path escapes the LiveDocs mirror: ${relativePath}`);
  }
  return normalized;
}

export function containedPath(root, relativePath) {
  const relative = normalizeRelative(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relative.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes the LiveDocs mirror: ${relativePath}`);
  }
  return resolved;
}

export function shouldSync(relativePath, isDirectory = false) {
  const relative = normalizeRelative(relativePath);
  const parts = relative.split('/');
  if (parts.some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))) return false;
  const name = parts.at(-1);
  if (
    !isDirectory &&
    name.startsWith('.env') &&
    name !== '.env.example' &&
    !name.endsWith('.example')
  )
    return false;
  if (!isDirectory && (name.endsWith('.log') || name === '.DS_Store')) return false;
  return true;
}

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function isTransientSourceRace(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
}

export function collectSourceFiles(sourceRoot, options = {}) {
  const files = new Map();
  const previousFiles = options.previousFiles ?? {};
  const readDetails =
    options.readDetails ??
    ((source, relative) => {
      const stats = statSync(source);
      const previous = previousFiles[relative];
      if (previous?.size === stats.size && previous?.mtimeMs === stats.mtimeMs) return previous;
      return { hash: hashFile(source), size: stats.size, mtimeMs: stats.mtimeMs };
    });
  function visit(directory, prefix = '') {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (prefix && isTransientSourceRace(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (shouldSync(relative, true)) visit(path.join(directory, entry.name), relative);
      } else if (entry.isFile() && shouldSync(relative, false)) {
        const source = path.join(directory, entry.name);
        try {
          files.set(relative, readDetails(source, relative));
        } catch (error) {
          if (!isTransientSourceRace(error)) throw error;
        }
      }
    }
  }
  visit(sourceRoot);
  return files;
}

export function sourceSnapshot(files) {
  const hash = createHash('sha256');
  for (const [relative, details] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(relative).update('\0').update(details.hash).update('\0');
  }
  return hash.digest('hex');
}

export function expectedOwner(distro, checkoutPath) {
  return {
    product: 'LiveDocs',
    purpose: 'wsl-windows-dev-mirror',
    format: MIRROR_FORMAT,
    identity: mirrorIdentity(distro, checkoutPath),
    distro: canonicalDistro(distro),
    sourcePath: canonicalPosixPath(checkoutPath),
    generated: true,
    warning: 'DISPOSABLE: generated from WSL. Do not edit; synchronization is one-way.',
  };
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function assertOwnedMirror(mirrorRoot, owner) {
  const actual = readJson(containedPath(mirrorRoot, OWNER_FILE));
  if (
    !actual ||
    actual.product !== owner.product ||
    actual.purpose !== owner.purpose ||
    actual.identity !== owner.identity ||
    actual.format !== owner.format
  ) {
    throw new Error(`Refusing to use unowned or incompatible Windows mirror: ${mirrorRoot}`);
  }
  return actual;
}

export function ensureOwnedMirror(mirrorRoot, owner) {
  if (existsSync(mirrorRoot)) {
    const entries = readdirSync(mirrorRoot);
    if (entries.length > 0) return assertOwnedMirror(mirrorRoot, owner);
  }
  mkdirSync(path.join(mirrorRoot, METADATA_DIR), { recursive: true });
  writeFileSync(containedPath(mirrorRoot, OWNER_FILE), `${JSON.stringify(owner, null, 2)}\n`);
  writeFileSync(
    path.join(mirrorRoot, 'README-LIVEDOCS-MIRROR.txt'),
    `${owner.warning}\nSource: ${owner.distro}:${owner.sourcePath}\n`,
  );
  return owner;
}

export function reconcileSource(sourceRoot, mirrorRoot, owner, options = {}) {
  assertOwnedMirror(mirrorRoot, owner);
  const previous = readJson(containedPath(mirrorRoot, MANIFEST_FILE), { files: {} });
  const current = collectSourceFiles(sourceRoot, {
    previousFiles: options.incremental ? previous.files : undefined,
    readDetails: options.readDetails,
  });
  const copyFile = options.copyFile ?? cpSync;
  let copied = 0;
  let removed = 0;
  for (const [relative, details] of current) {
    const destination = containedPath(mirrorRoot, relative);
    if (
      previous.files?.[relative]?.hash !== details.hash ||
      !existsSync(destination) ||
      (!options.incremental && hashFile(destination) !== details.hash)
    ) {
      try {
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFile(path.join(sourceRoot, ...relative.split('/')), destination, {
          dereference: true,
        });
        copied += 1;
      } catch (error) {
        if (!isTransientSourceRace(error)) throw error;
        current.delete(relative);
      }
    }
  }
  for (const relative of Object.keys(previous.files ?? {})) {
    if (!current.has(relative)) {
      const destination = containedPath(mirrorRoot, relative);
      if (existsSync(destination)) rmSync(destination, { force: true });
      removed += 1;
    }
  }
  const files = Object.fromEntries([...current].sort(([a], [b]) => a.localeCompare(b)));
  const snapshot = sourceSnapshot(current);
  writeFileSync(
    containedPath(mirrorRoot, MANIFEST_FILE),
    `${JSON.stringify({ format: MIRROR_FORMAT, snapshot, files }, null, 2)}\n`,
  );
  return { copied, removed, total: current.size, snapshot, files: current };
}

export function dependencyFingerprint(sourceRoot, windows) {
  const candidates = [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/electron.vite.config.ts',
    'scripts/rebuild-store-sqlite.mjs',
  ];
  for (const directory of ['apps', 'packages']) {
    const root = path.join(sourceRoot, directory);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(`${directory}/${entry.name}/package.json`);
    }
  }
  const hash = createHash('sha256');
  hash.update(
    `mirror=${MIRROR_FORMAT}\0node=${windows.nodeVersion}\0abi=${windows.nodeAbi}\0pnpm=${windows.pnpmVersion}\0`,
  );
  for (const relative of [...new Set(candidates)].sort()) {
    const file = path.join(sourceRoot, ...relative.split('/'));
    if (existsSync(file))
      hash.update(relative).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.digest('hex');
}

export function removeOwnedMirror(mirrorRoot, owner) {
  assertOwnedMirror(mirrorRoot, owner);
  const resolved = realpathSync(mirrorRoot);
  const parent = realpathSync(path.dirname(mirrorRoot));
  if (path.dirname(resolved) !== parent || resolved === parent)
    throw new Error(`Unsafe mirror cleanup target: ${mirrorRoot}`);
  rmSync(resolved, { recursive: true, force: true });
}

export function listOwnedMirrors(mirrorBase) {
  if (!existsSync(mirrorBase)) return [];
  return readdirSync(mirrorBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const root = path.join(mirrorBase, entry.name);
      const owner = readJson(path.join(root, OWNER_FILE));
      return owner?.product === 'LiveDocs' && owner?.purpose === 'wsl-windows-dev-mirror'
        ? [{ root, owner }]
        : [];
    });
}

export function parseMode(value) {
  const mode = value || 'dev';
  if (!MODES.has(mode))
    throw new Error(`Unknown mode "${mode}". Expected one of: ${[...MODES].join(', ')}.`);
  return mode;
}

export function parsePackageManager(packageJson) {
  const match = /^pnpm@([^+]+)/.exec(packageJson.packageManager ?? '');
  if (!match) throw new Error('The root package.json must pin pnpm in packageManager.');
  return match[1];
}

export function validatePrerequisites(prerequisites, pinnedPnpm, mode) {
  const missing = [];
  if (!prerequisites?.nodePath || !prerequisites?.nodeVersion || !prerequisites?.nodeAbi)
    missing.push('Windows Node.js');
  if (!prerequisites?.pnpmVersion || !prerequisites?.pnpmJsPath)
    missing.push(`Windows pnpm ${pinnedPnpm}`);
  else if (prerequisites.pnpmVersion !== pinnedPnpm)
    missing.push(`Windows pnpm ${pinnedPnpm} (found ${prerequisites.pnpmVersion})`);
  if (!prerequisites?.localAppData) missing.push('Windows LOCALAPPDATA');
  if (!prerequisites?.buildTools && !['launch', 'clean'].includes(mode))
    missing.push('Visual Studio C++ Build Tools');
  return missing;
}

export function windowsCommandForMode(mode) {
  const commands = {
    dev: ['--filter', '@livedocs/desktop', 'dev'],
    build: ['--filter', '@livedocs/desktop', 'build'],
    dist: ['--filter', '@livedocs/desktop', 'dist:win'],
  };
  const command = commands[mode];
  if (!command) throw new Error(`Mode ${mode} does not run a Windows pnpm build command.`);
  return [...command];
}

export function windowsPathToWsl(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (!match) throw new Error(`Expected an absolute Windows drive path, got: ${value}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

export function wslPathToWindows(value) {
  const match = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(canonicalPosixPath(value));
  if (!match) throw new Error(`Expected a WSL-mounted Windows path, got: ${value}`);
  return `${match[1].toUpperCase()}:\\${(match[2] ?? '').replaceAll('/', '\\')}`;
}
