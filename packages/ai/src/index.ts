import { createHash } from 'node:crypto';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, type LanguageModel } from 'ai';

export type AIProviderId = 'anthropic' | 'openai' | 'google' | 'ollama' | 'mock';

export interface AIConfig {
  provider: AIProviderId;
  model: string;
  apiKey?: string;
  /** For self-hosted providers (Ollama). */
  baseUrl?: string;
}

export const DEFAULT_MODELS: Record<AIProviderId, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
  ollama: 'llama3.2',
  mock: 'mock-model',
};

export interface AIProvenance {
  model: string;
  timestamp: string;
  inputDigest: string;
  cacheHit: boolean;
}

export interface AICache {
  get(key: string): { response: string; model: string } | null;
  set(key: string, response: string, model: string): void;
}

export interface StreamRequest {
  system?: string;
  prompt: string;
  /**
   * Digest of the source material the prompt was built from. Part of the
   * cache key, so changed inputs always miss the cache.
   */
  inputDigest?: string;
  /** Skip cache read (still writes on completion). */
  refresh?: boolean;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export interface StreamResult {
  text: string;
  provenance: AIProvenance;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Cache key per spec: hash(model + prompt + input digest). */
export function cacheKey(
  model: string,
  system: string,
  prompt: string,
  inputDigest: string,
): string {
  return sha256(JSON.stringify({ model, system, prompt, inputDigest }));
}

function createModel(config: AIConfig): LanguageModel {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.model);
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        baseURL: config.baseUrl ?? 'http://localhost:11434/v1',
      })(config.model);
    case 'mock':
      throw new Error('mock provider is handled without an SDK model');
  }
}

async function streamMock(request: StreamRequest): Promise<string> {
  const words = `Mock AI response. The request asked: ${request.prompt.slice(0, 160)}`.split(' ');
  let text = '';
  for (const word of words) {
    if (request.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const chunk = (text ? ' ' : '') + word;
    text += chunk;
    request.onChunk?.(chunk);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return text;
}

/**
 * Provider-independent AI access: streaming, cancellation, response caching
 * keyed by hash(model + prompt + input digest), and provenance on every
 * result. All app code talks to this interface; the Vercel AI SDK is an
 * implementation detail.
 */
export class AIService {
  constructor(
    private readonly config: AIConfig,
    private readonly cache?: AICache,
  ) {}

  get model(): string {
    return this.config.model;
  }

  get provider(): AIProviderId {
    return this.config.provider;
  }

  async stream(request: StreamRequest): Promise<StreamResult> {
    const system = request.system ?? '';
    const inputDigest = request.inputDigest ?? sha256(request.prompt);
    const key = cacheKey(this.config.model, system, request.prompt, inputDigest);

    if (this.cache && !request.refresh) {
      const hit = this.cache.get(key);
      if (hit) {
        request.onChunk?.(hit.response);
        return {
          text: hit.response,
          provenance: {
            model: hit.model,
            timestamp: new Date().toISOString(),
            inputDigest,
            cacheHit: true,
          },
        };
      }
    }

    let text: string;
    if (this.config.provider === 'mock') {
      text = await streamMock(request);
    } else {
      const result = streamText({
        model: createModel(this.config),
        system: request.system,
        prompt: request.prompt,
        abortSignal: request.signal,
      });
      text = '';
      for await (const chunk of result.textStream) {
        text += chunk;
        request.onChunk?.(chunk);
      }
    }

    // Only completed responses are cached — a cancelled stream never persists.
    this.cache?.set(key, text, this.config.model);
    return {
      text,
      provenance: {
        model: this.config.model,
        timestamp: new Date().toISOString(),
        inputDigest,
        cacheHit: false,
      },
    };
  }
}
