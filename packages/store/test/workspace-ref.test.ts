import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  AGENT_PROTOCOL_VERSION,
  createLocalWorkspaceReference,
  createWslWorkspaceReference,
  deserializeWorkspaceReference,
  findWslLaunchUrl,
  isProtocolVersionCompatible,
  parseWslUncWorkspacePath,
  parseWslLaunchUrl,
  serializeWorkspaceReference,
  workspaceOpenRequestToReference,
  workspaceReferenceKey,
  workspaceReferenceLabel,
  workspaceStorageIdentity,
} from '../src/index.js';

describe('workspace references', () => {
  it('serializes and deserializes local references with stable labels', () => {
    const ref = createLocalWorkspaceReference('/tmp/project');
    const expectedPath = path.resolve('/tmp/project');
    const roundTrip = deserializeWorkspaceReference(serializeWorkspaceReference(ref));

    expect(roundTrip).toEqual(ref);
    expect(workspaceReferenceLabel(ref)).toBe(expectedPath);
    expect(workspaceReferenceKey(ref)).toBe(`local:${expectedPath}`);
  });

  it('preserves WSL distro and POSIX path identity', () => {
    const ubuntu = createWslWorkspaceReference('Ubuntu', '/home/bret/src/livedocs');
    const debian = createWslWorkspaceReference('Debian', '/home/bret/src/livedocs');

    expect(workspaceReferenceLabel(ubuntu)).toBe('Ubuntu:/home/bret/src/livedocs');
    expect(workspaceStorageIdentity(ubuntu)).not.toBe(workspaceStorageIdentity(debian));
    expect(deserializeWorkspaceReference(serializeWorkspaceReference(ubuntu))).toEqual(ubuntu);
  });

  it('rejects invalid WSL paths before they become workspace identities', () => {
    expect(() => createWslWorkspaceReference('Ubuntu', 'relative/path')).toThrow(/absolute/);
    expect(() => createWslWorkspaceReference('Ubuntu', String.raw`C:\repo`)).toThrow(/POSIX/);
  });

  it('rejects serialized references with a non-string name', () => {
    expect(() =>
      deserializeWorkspaceReference({
        version: 1,
        kind: 'wsl',
        distro: 'Ubuntu',
        path: '/home/me/repo',
        name: 42 as unknown as string,
      }),
    ).toThrow(/Invalid workspace reference/);
  });

  it('keeps backward-compatible open requests for local paths', () => {
    expect(workspaceOpenRequestToReference({ path: '/tmp/project' })).toMatchObject({
      kind: 'local',
      path: path.resolve('/tmp/project'),
    });
  });

  it('converts WSL UNC workspace paths to agent-backed references', () => {
    expect(parseWslUncWorkspacePath(String.raw`\\wsl$\Ubuntu\home\bret\src\livedocs`)).toEqual(
      createWslWorkspaceReference('Ubuntu', '/home/bret/src/livedocs'),
    );
    expect(
      workspaceOpenRequestToReference({
        path: String.raw`\\wsl.localhost\Ubuntu-24.04\home\bret\my repo`,
      }),
    ).toEqual(createWslWorkspaceReference('Ubuntu-24.04', '/home/bret/my repo'));
  });

  it('normalizes old local references that point at WSL UNC paths', () => {
    expect(
      workspaceOpenRequestToReference({
        reference: {
          kind: 'local',
          path: String.raw`\\wsl$\Ubuntu\home\bret\src\livedocs`,
        },
      }),
    ).toEqual(createWslWorkspaceReference('Ubuntu', '/home/bret/src/livedocs'));
  });
});

describe('WSL launch helpers', () => {
  it('parses a WSL launch URL', () => {
    const ref = createWslWorkspaceReference('Ubuntu 24.04', '/home/me/my repo');
    const url = 'livedocs://wsl/open?distro=Ubuntu+24.04&path=%2Fhome%2Fme%2Fmy+repo';

    expect(parseWslLaunchUrl(url)).toEqual(ref);
    expect(findWslLaunchUrl(['--flag', url])).toBe(url);
  });

  it('ignores malformed WSL launch URLs', () => {
    const malformed = 'livedocs://wsl/open?distro=Ubuntu&path=relative';
    const valid = 'livedocs://wsl/open?distro=Ubuntu&path=%2Fhome%2Fme%2Frepo';

    expect(parseWslLaunchUrl(malformed)).toBeNull();
    expect(findWslLaunchUrl(['--flag', malformed])).toBeNull();
    expect(findWslLaunchUrl([malformed, valid])).toBe(valid);
  });
});

describe('agent protocol', () => {
  it('accepts compatible version ranges and rejects mismatches', () => {
    expect(
      isProtocolVersionCompatible(
        { protocolVersion: AGENT_PROTOCOL_VERSION, minProtocolVersion: AGENT_PROTOCOL_VERSION },
        { protocolVersion: AGENT_PROTOCOL_VERSION, minProtocolVersion: AGENT_PROTOCOL_VERSION },
      ),
    ).toBe(true);
    expect(
      isProtocolVersionCompatible(
        { protocolVersion: 1, minProtocolVersion: 1 },
        { protocolVersion: 3, minProtocolVersion: 2 },
      ),
    ).toBe(false);
  });
});
