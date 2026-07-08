import { safeStorage } from 'electron';
import { AIService, DEFAULT_MODELS, type AICache, type AIProviderId } from '@livedocs/ai';
import type { AppStore, WorkspaceStore } from '@livedocs/store';
import type { AIConfigView, AIProvider } from '../shared/ipc';

const PROVIDERS_NEEDING_KEY: AIProvider[] = ['anthropic', 'openai', 'google'];

function keySetting(provider: string): string {
  return `ai.key.${provider}`;
}

/**
 * API keys are encrypted with Electron safeStorage (OS keychain-backed) and
 * stored in the app database — never in workspace files or logs. When the OS
 * has no secret store (some Linux setups), we refuse to persist the key rather
 * than writing recoverable plaintext; the settings UI surfaces the
 * unavailable state via `secureStorageAvailable` and steers the user to a
 * local provider. Returns true when the key was securely stored (or cleared).
 */
export function storeApiKey(appStore: AppStore, provider: string, apiKey: string | null): boolean {
  if (apiKey === null) {
    appStore.setSetting(keySetting(provider), null);
    return true;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return false;
  }
  appStore.setSetting(
    keySetting(provider),
    `enc:${safeStorage.encryptString(apiKey).toString('base64')}`,
  );
  return true;
}

export function readApiKey(appStore: AppStore, provider: string): string | null {
  const stored = appStore.getSetting(keySetting(provider));
  if (!stored) return null;
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
  } catch {
    return null;
  }
  return null;
}

export function getAIConfigView(appStore: AppStore): AIConfigView {
  if (process.env.LIVEDOCS_AI_MOCK) {
    return {
      provider: 'mock',
      model: DEFAULT_MODELS.mock,
      baseUrl: null,
      hasApiKey: true,
      keyStorage: 'none',
      secureStorageAvailable: true,
    };
  }
  const provider = (appStore.getSetting('ai.provider') as AIProvider | null) ?? null;
  const stored = provider ? appStore.getSetting(keySetting(provider)) : null;
  const hasEncryptedKey = stored?.startsWith('enc:') ?? false;
  return {
    provider,
    model: appStore.getSetting('ai.model'),
    baseUrl: appStore.getSetting('ai.baseUrl'),
    hasApiKey: hasEncryptedKey,
    keyStorage: hasEncryptedKey ? 'encrypted' : 'none',
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

export function setAIConfig(
  appStore: AppStore,
  update: { provider: AIProvider; model: string; apiKey?: string | null; baseUrl?: string | null },
): AIConfigView {
  appStore.setSetting('ai.provider', update.provider);
  appStore.setSetting('ai.model', update.model || DEFAULT_MODELS[update.provider]);
  if (update.baseUrl !== undefined) appStore.setSetting('ai.baseUrl', update.baseUrl);
  if (update.apiKey !== undefined) storeApiKey(appStore, update.provider, update.apiKey);
  return getAIConfigView(appStore);
}

function cacheFor(store: WorkspaceStore): AICache {
  return {
    get: (key) => store.aiCacheGet(key),
    set: (key, response, model) => store.aiCacheSet(key, response, model),
  };
}

/**
 * Build an AIService for the current configuration, or null when
 * unconfigured (callers surface setup guidance instead of failing).
 */
export function buildAIService(
  appStore: AppStore,
  workspaceStore: WorkspaceStore,
): AIService | null {
  if (process.env.LIVEDOCS_AI_MOCK) {
    return new AIService(
      { provider: 'mock', model: DEFAULT_MODELS.mock },
      cacheFor(workspaceStore),
    );
  }
  const view = getAIConfigView(appStore);
  if (!view.provider || !view.model) return null;
  const apiKey = readApiKey(appStore, view.provider) ?? undefined;
  if (PROVIDERS_NEEDING_KEY.includes(view.provider) && !apiKey) return null;
  return new AIService(
    {
      provider: view.provider as AIProviderId,
      model: view.model,
      apiKey,
      baseUrl: view.baseUrl ?? undefined,
    },
    cacheFor(workspaceStore),
  );
}
