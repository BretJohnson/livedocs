import { createWslWorkspaceReference, type WslWorkspaceReference } from './workspace-ref.js';

export const LIVEDOCS_PROTOCOL = 'livedocs';

export function parseWslLaunchUrl(raw: string): WslWorkspaceReference | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${LIVEDOCS_PROTOCOL}:` || url.hostname !== 'wsl') return null;
  const command = url.pathname.replace(/^\/+/, '');
  if (command !== 'open') return null;
  const distro = url.searchParams.get('distro');
  const workspacePath = url.searchParams.get('path');
  if (!distro || !workspacePath) return null;
  try {
    return createWslWorkspaceReference(
      distro,
      workspacePath,
      url.searchParams.get('name') ?? undefined,
    );
  } catch {
    return null;
  }
}

export function findWslLaunchUrl(argv: readonly string[]): string | null {
  return argv.find((arg) => parseWslLaunchUrl(arg) !== null) ?? null;
}
