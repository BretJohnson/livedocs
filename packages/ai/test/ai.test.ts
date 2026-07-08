import { describe, expect, it } from 'vitest';
import { AIService, cacheKey, sha256, type AICache } from '../src/index.js';

function memoryCache(): AICache & { store: Map<string, { response: string; model: string }> } {
  const store = new Map<string, { response: string; model: string }>();
  return {
    store,
    get: (key) => store.get(key) ?? null,
    set: (key, response, model) => {
      store.set(key, { response, model });
    },
  };
}

describe('cache keying', () => {
  it('is stable for identical inputs and sensitive to each component', () => {
    const base = cacheKey('m', 's', 'p', 'd');
    expect(cacheKey('m', 's', 'p', 'd')).toBe(base);
    expect(cacheKey('m2', 's', 'p', 'd')).not.toBe(base);
    expect(cacheKey('m', 's2', 'p', 'd')).not.toBe(base);
    expect(cacheKey('m', 's', 'p2', 'd')).not.toBe(base);
    expect(cacheKey('m', 's', 'p', 'd2')).not.toBe(base);
  });

  it('sha256 digests are hex and deterministic', () => {
    expect(sha256('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('abc')).toBe(sha256('abc'));
  });
});

describe('AIService (mock provider)', () => {
  it('streams chunks and reports fresh provenance', async () => {
    const service = new AIService({ provider: 'mock', model: 'mock-model' }, memoryCache());
    const chunks: string[] = [];
    const result = await service.stream({
      prompt: 'What does the watcher do?',
      inputDigest: 'digest-1',
      onChunk: (c) => chunks.push(c),
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(result.text);
    expect(result.provenance).toMatchObject({
      model: 'mock-model',
      inputDigest: 'digest-1',
      cacheHit: false,
    });
  });

  it('serves an unchanged request from cache with cacheHit provenance', async () => {
    const cache = memoryCache();
    const service = new AIService({ provider: 'mock', model: 'mock-model' }, cache);
    const first = await service.stream({ prompt: 'p', inputDigest: 'd' });
    expect(cache.store.size).toBe(1);
    const second = await service.stream({ prompt: 'p', inputDigest: 'd' });
    expect(second.text).toBe(first.text);
    expect(second.provenance.cacheHit).toBe(true);
  });

  it('misses the cache when the input digest changes', async () => {
    const cache = memoryCache();
    const service = new AIService({ provider: 'mock', model: 'mock-model' }, cache);
    await service.stream({ prompt: 'p', inputDigest: 'd1' });
    const second = await service.stream({ prompt: 'p', inputDigest: 'd2' });
    expect(second.provenance.cacheHit).toBe(false);
    expect(cache.store.size).toBe(2);
  });

  it('refresh bypasses the cache read but still writes', async () => {
    const cache = memoryCache();
    const service = new AIService({ provider: 'mock', model: 'mock-model' }, cache);
    await service.stream({ prompt: 'p', inputDigest: 'd' });
    const second = await service.stream({ prompt: 'p', inputDigest: 'd', refresh: true });
    expect(second.provenance.cacheHit).toBe(false);
  });

  it('cancellation aborts the stream and caches nothing', async () => {
    const cache = memoryCache();
    const service = new AIService({ provider: 'mock', model: 'mock-model' }, cache);
    const controller = new AbortController();
    const pending = service.stream({
      prompt: 'p',
      inputDigest: 'd',
      signal: controller.signal,
      onChunk: () => controller.abort(),
    });
    await expect(pending).rejects.toThrow();
    expect(cache.store.size).toBe(0);
  });
});
