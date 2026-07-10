import path from 'node:path';

export type WorkspaceKind = 'local' | 'wsl';

export interface LocalWorkspaceReference {
  kind: 'local';
  path: string;
  name?: string;
}

export interface WslWorkspaceReference {
  kind: 'wsl';
  distro: string;
  path: string;
  name?: string;
}

export type WorkspaceReference = LocalWorkspaceReference | WslWorkspaceReference;

export interface SerializedWorkspaceReference {
  version: 1;
  kind: WorkspaceKind;
  path: string;
  name?: string;
  distro?: string;
}

export type WorkspaceOpenRequest =
  { path: string } | { reference: WorkspaceReference } | WorkspaceReference;

function optionalName(name?: string): { name?: string } {
  const trimmed = name?.trim();
  return trimmed ? { name: trimmed } : {};
}

function deserializeName(name: unknown): string | undefined {
  if (name === undefined) return undefined;
  if (typeof name !== 'string') throw new Error('Invalid workspace reference');
  return name;
}

export function normalizeWslPath(workspacePath: string): string {
  if (!workspacePath || workspacePath.includes('\0')) {
    throw new Error('WSL workspace path must be a non-empty POSIX path');
  }
  if (workspacePath.includes('\\')) {
    throw new Error('WSL workspace path must use POSIX separators');
  }
  const normalized = path.posix.normalize(workspacePath);
  if (!path.posix.isAbsolute(normalized)) {
    throw new Error('WSL workspace path must be absolute');
  }
  return normalized;
}

export function createLocalWorkspaceReference(
  workspacePath: string,
  name?: string,
): LocalWorkspaceReference {
  if (!workspacePath || workspacePath.includes('\0')) {
    throw new Error('Local workspace path must be a non-empty path');
  }
  return { kind: 'local', path: path.resolve(workspacePath), ...optionalName(name) };
}

export function createWslWorkspaceReference(
  distro: string,
  workspacePath: string,
  name?: string,
): WslWorkspaceReference {
  const trimmedDistro = distro.trim();
  if (!trimmedDistro || trimmedDistro.includes('\0')) {
    throw new Error('WSL distro must be non-empty');
  }
  return {
    kind: 'wsl',
    distro: trimmedDistro,
    path: normalizeWslPath(workspacePath),
    ...optionalName(name),
  };
}

export function parseWslUncWorkspacePath(
  workspacePath: string,
  name?: string,
): WslWorkspaceReference | null {
  const normalized = workspacePath.replace(/\\/g, '/');
  const match = normalized.match(/^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)(?:\/(.*))?$/i);
  if (!match) return null;

  const [, distro, rest = ''] = match;
  const posixPath = `/${rest}`;
  try {
    return createWslWorkspaceReference(distro, posixPath, name);
  } catch {
    return null;
  }
}

export function normalizeWorkspaceReference(reference: WorkspaceReference): WorkspaceReference {
  if (reference.kind === 'wsl') {
    return createWslWorkspaceReference(reference.distro, reference.path, reference.name);
  }
  return (
    parseWslUncWorkspacePath(reference.path, reference.name) ??
    createLocalWorkspaceReference(reference.path, reference.name)
  );
}

export function workspaceReferenceName(reference: WorkspaceReference): string {
  if (reference.name) return reference.name;
  const base =
    reference.kind === 'wsl'
      ? path.posix.basename(reference.path)
      : path.basename(path.resolve(reference.path));
  return base || reference.path;
}

export function workspaceReferenceLabel(reference: WorkspaceReference): string {
  return reference.kind === 'wsl'
    ? `${reference.distro}:${reference.path}`
    : path.resolve(reference.path);
}

export function workspaceReferenceKey(reference: WorkspaceReference): string {
  const normalized = normalizeWorkspaceReference(reference);
  if (normalized.kind === 'wsl') {
    return `wsl:${encodeURIComponent(normalized.distro)}:${encodeURIComponent(normalized.path)}`;
  }
  return `local:${normalized.path}`;
}

export function workspaceStorageIdentity(reference: WorkspaceReference): string {
  const normalized = normalizeWorkspaceReference(reference);
  if (normalized.kind === 'wsl') {
    return `wsl://${encodeURIComponent(normalized.distro)}${normalized.path}`;
  }
  return normalized.path;
}

export function serializeWorkspaceReference(reference: WorkspaceReference): string {
  const normalized = normalizeWorkspaceReference(reference);
  return JSON.stringify({
    version: 1,
    kind: normalized.kind,
    path: normalized.path,
    ...(normalized.kind === 'wsl' ? { distro: normalized.distro } : {}),
    ...optionalName(normalized.name),
  } satisfies SerializedWorkspaceReference);
}

export function deserializeWorkspaceReference(
  value: string | SerializedWorkspaceReference,
): WorkspaceReference {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Workspace reference must be an object');
  }
  const candidate = parsed as Partial<SerializedWorkspaceReference> & { name?: unknown };
  if (candidate.version !== 1) throw new Error('Unsupported workspace reference version');
  const name = deserializeName(candidate.name);
  if (candidate.kind === 'wsl') {
    if (typeof candidate.distro !== 'string' || typeof candidate.path !== 'string') {
      throw new Error('Invalid WSL workspace reference');
    }
    return createWslWorkspaceReference(candidate.distro, candidate.path, name);
  }
  if (candidate.kind === 'local' && typeof candidate.path === 'string') {
    return createLocalWorkspaceReference(candidate.path, name);
  }
  throw new Error('Invalid workspace reference');
}

export function workspaceOpenRequestToReference(request: WorkspaceOpenRequest): WorkspaceReference {
  if ('reference' in request) return normalizeWorkspaceReference(request.reference);
  if ('kind' in request) return normalizeWorkspaceReference(request);
  return parseWslUncWorkspacePath(request.path) ?? createLocalWorkspaceReference(request.path);
}
