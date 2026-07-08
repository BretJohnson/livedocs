import { useEffect, useState } from 'react';
import type { AIConfigView, AIProvider } from '../../../shared/ipc';
import { api } from '../api';

const PROVIDER_HINTS: Record<
  Exclude<AIProvider, 'mock'>,
  { label: string; model: string; needsKey: boolean }
> = {
  anthropic: { label: 'Anthropic', model: 'claude-sonnet-5', needsKey: true },
  openai: { label: 'OpenAI', model: 'gpt-4o', needsKey: true },
  google: { label: 'Google', model: 'gemini-2.5-flash', needsKey: true },
  ollama: { label: 'Ollama (local)', model: 'llama3.2', needsKey: false },
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AIConfigView | null>(null);
  const [provider, setProvider] = useState<Exclude<AIProvider, 'mock'>>('anthropic');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.invoke('ai:getConfig', undefined).then((c) => {
      setConfig(c);
      if (c.provider && c.provider !== 'mock') setProvider(c.provider);
      setModel(c.model ?? '');
      setBaseUrl(c.baseUrl ?? '');
    });
  }, []);

  const hint = PROVIDER_HINTS[provider];

  const save = async (): Promise<void> => {
    const updated = await api.invoke('ai:setConfig', {
      provider,
      model: model.trim() || hint.model,
      apiKey: apiKey ? apiKey : undefined,
      baseUrl: provider === 'ollama' ? baseUrl.trim() || null : undefined,
    });
    setConfig(updated);
    setApiKey('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Settings — AI provider</strong>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </header>

        <p className="muted">
          LiveDocs works fully without AI. Configuring a provider enables explanations, summaries,
          drafting, and the architecture-overview generator. Keys are stored in your OS secure
          storage — never in the workspace.
        </p>

        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => {
              const next = e.target.value as Exclude<AIProvider, 'mock'>;
              setProvider(next);
              setModel(PROVIDER_HINTS[next].model);
            }}
          >
            {Object.entries(PROVIDER_HINTS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Model
          <input
            type="text"
            value={model}
            placeholder={hint.model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>

        {hint.needsKey && (
          <label>
            API key
            <input
              type="password"
              value={apiKey}
              placeholder={config?.hasApiKey ? '(saved — leave blank to keep)' : 'paste API key'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
        )}

        {provider === 'ollama' && (
          <label>
            Base URL
            <input
              type="text"
              value={baseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
        )}

        {hint.needsKey && config && !config.secureStorageAvailable && (
          <div className="warning">
            No OS secret store is available on this system, so cloud provider API keys can’t be
            stored securely and won’t be saved. Use a local provider (Ollama), or enable an OS
            secret store (e.g. gnome-keyring) to use cloud providers.
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={() => void save()}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
