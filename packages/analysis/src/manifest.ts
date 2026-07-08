import type { DependencyRecord } from '@livedocs/store';

/** Parse a package.json body into dependency rows. Returns [] on parse failure. */
export function parsePackageManifest(content: string): Omit<DependencyRecord, 'manifestPath'>[] {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }
  const out: Omit<DependencyRecord, 'manifestPath'>[] = [];
  const sections: [string, DependencyRecord['depType']][] = [
    ['dependencies', 'prod'],
    ['devDependencies', 'dev'],
    ['peerDependencies', 'peer'],
    ['optionalDependencies', 'optional'],
  ];
  for (const [section, depType] of sections) {
    const deps = json[section];
    if (deps && typeof deps === 'object') {
      for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
        if (typeof version === 'string') out.push({ name, version, depType });
      }
    }
  }
  return out;
}

export function manifestName(content: string): string | null {
  try {
    const json = JSON.parse(content) as Record<string, unknown>;
    return typeof json.name === 'string' ? json.name : null;
  } catch {
    return null;
  }
}
