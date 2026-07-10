import {
  availableGenerators,
  getGenerator,
  type GeneratorContext,
  type GeneratorParams,
} from '@livedocs/generators';
import type { AIService } from '@livedocs/ai';
import type { GenKey, GenResult, WorkspaceInfo, WorkspaceStore } from '@livedocs/store';

export interface GeneratorWorkspace {
  readonly info: WorkspaceInfo;
  readonly store: WorkspaceStore;
}

export interface GeneratorRuntime {
  ai?(workspace: GeneratorWorkspace): AIService | null | undefined;
}

function contextFor(workspace: GeneratorWorkspace, runtime: GeneratorRuntime): GeneratorContext {
  return {
    store: workspace.store,
    workspaceRoot: workspace.info.path,
    ai: runtime.ai?.(workspace) ?? undefined,
  };
}

function parseParams(params: string): GeneratorParams {
  try {
    return JSON.parse(params) as GeneratorParams;
  } catch {
    return {};
  }
}

async function runAndSave(
  workspace: GeneratorWorkspace,
  key: GenKey,
  runtime: GeneratorRuntime,
): Promise<GenResult> {
  const generator = getGenerator(key.generator);
  if (!generator) {
    return { status: 'unknown-generator', name: key.generator, available: availableGenerators() };
  }
  const ctx = contextFor(workspace, runtime);
  if (generator.kind === 'ai' && !ctx.ai) {
    return { status: 'needs-run', name: key.generator, reason: 'ai-unconfigured' };
  }
  try {
    const result = await generator.generate(ctx, parseParams(key.params));
    const output = JSON.stringify(result.root);
    workspace.store.saveArtifact({
      docPath: key.docPath,
      generator: key.generator,
      params: key.params,
      output,
      provenance: result.provenance,
      inputDigest: result.inputDigest,
    });
    return { status: 'ok', output, provenance: result.provenance, stale: false };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve a generated section for the reading view. Deterministic generators
 * run on first sight; AI generators wait for an explicit user action so
 * opening a document is never a surprise provider call.
 */
export async function getArtifact(
  workspace: GeneratorWorkspace,
  key: GenKey,
  runtime: GeneratorRuntime = {},
): Promise<GenResult> {
  const generator = getGenerator(key.generator);
  if (!generator) {
    return { status: 'unknown-generator', name: key.generator, available: availableGenerators() };
  }
  const existing = workspace.store.getArtifact(key.docPath, key.generator, key.params);
  if (existing) {
    return {
      status: 'ok',
      output: existing.output,
      provenance: existing.provenance,
      stale: existing.stale,
    };
  }
  if (generator.kind === 'ai') {
    const ctx = contextFor(workspace, runtime);
    return {
      status: 'needs-run',
      name: key.generator,
      reason: ctx.ai ? 'ai-explicit' : 'ai-unconfigured',
    };
  }
  return runAndSave(workspace, key, runtime);
}

export async function refreshArtifact(
  workspace: GeneratorWorkspace,
  key: GenKey,
  runtime: GeneratorRuntime = {},
): Promise<GenResult> {
  return runAndSave(workspace, key, runtime);
}

/**
 * Compare each stored artifact's input digest against current analysis state;
 * flip stale flags and return the keys whose staleness changed.
 */
export function recomputeStaleness(
  workspace: GeneratorWorkspace,
  runtime: GeneratorRuntime = {},
): GenKey[] {
  const ctx = contextFor(workspace, runtime);
  const changed: GenKey[] = [];
  for (const artifact of workspace.store.allArtifacts()) {
    const generator = getGenerator(artifact.generator);
    if (!generator) continue;
    // AI artifacts are still checked for staleness without an active provider:
    // fold the artifact's stored model into the digest so repository-input
    // changes flip the stale flag even though refresh must wait for setup.
    const digestCtx: GeneratorContext =
      generator.kind === 'ai' && !ctx.ai ? { ...ctx, modelHint: artifact.provenance.model } : ctx;
    let digest: string;
    try {
      digest = generator.inputDigest(digestCtx, parseParams(artifact.params));
    } catch {
      continue;
    }
    const stale = digest !== artifact.inputDigest;
    if (stale !== artifact.stale) {
      workspace.store.setArtifactStale(
        artifact.docPath,
        artifact.generator,
        artifact.params,
        stale,
      );
      changed.push({
        docPath: artifact.docPath,
        generator: artifact.generator,
        params: artifact.params,
      });
    }
  }
  return changed;
}
