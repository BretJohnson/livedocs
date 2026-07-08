import type { Root } from 'mdast';
import type { Provenance, WorkspaceStore } from '@livedocs/store';
import type { AIService } from '@livedocs/ai';

export interface GeneratorContext {
  store: WorkspaceStore;
  workspaceRoot: string;
  /** Present only when an AI provider is configured. */
  ai?: AIService;
  /**
   * Model to fold into an AI generator's input digest when no live AI service
   * is available (e.g. staleness recompute after the provider was removed).
   * Lets staleness track repository-input changes using the artifact's stored
   * model even though a refresh must still wait for provider configuration.
   */
  modelHint?: string;
}

export interface GeneratorResult {
  root: Root;
  provenance: Provenance;
  inputDigest: string;
}

export type GeneratorParams = Record<string, string>;

/**
 * A generator is a pure function over the analysis store:
 * (store, params) → mdast subtree + provenance + input digest.
 * `inputDigest` must be cheap — it runs on every watcher batch to detect
 * staleness without regenerating.
 */
export interface Generator {
  name: string;
  kind: 'deterministic' | 'ai';
  description: string;
  inputDigest(ctx: GeneratorContext, params: GeneratorParams): string;
  generate(ctx: GeneratorContext, params: GeneratorParams): Promise<GeneratorResult>;
}
