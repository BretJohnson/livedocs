import { useMemo } from 'react';
import { CodeBlock, createMarkdownRenderer } from '@livedocs/pipeline';
import type { Provenance } from '../../../shared/ipc';
import { api } from '../api';

export type AIPanelState =
  | { status: 'not-configured'; title: string }
  | { status: 'streaming'; title: string; requestId: string; text: string }
  | { status: 'done'; title: string; text: string; provenance: Provenance }
  | { status: 'error'; title: string; message: string }
  | { status: 'cancelled'; title: string };

export function ProvenanceLine({ provenance }: { provenance: Provenance }) {
  return (
    <div className="provenance-line">
      {provenance.model ?? provenance.generator} ·{' '}
      {new Date(provenance.timestamp).toLocaleTimeString()}
      {provenance.cacheHit !== undefined && (
        <span className={`cache-badge${provenance.cacheHit ? ' hit' : ''}`}>
          {provenance.cacheHit ? 'cached' : 'fresh'}
        </span>
      )}
    </div>
  );
}

/**
 * Slide-over panel for streamed AI results (explain / summarize). Output is
 * presented as document content with provenance, not a chat transcript.
 */
export function AIPanel({
  state,
  onClose,
  onOpenSettings,
}: {
  state: AIPanelState;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const renderer = useMemo(
    () =>
      createMarkdownRenderer({
        components: {
          'livedocs-code': CodeBlock,
          a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
            <a
              href={href ?? '#'}
              onClick={(e) => {
                e.preventDefault();
                if (href && /^https?:/.test(href))
                  void api.invoke('file:openExternal', { url: href });
              }}
            >
              {children}
            </a>
          ),
        },
      }),
    [],
  );

  return (
    <aside className="ai-panel">
      <header>
        <strong>{state.title}</strong>
        <span>
          {state.status === 'streaming' && (
            <button onClick={() => void api.invoke('ai:cancel', { requestId: state.requestId })}>
              Cancel
            </button>
          )}
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </span>
      </header>
      <div className="ai-panel-body">
        {state.status === 'not-configured' && (
          <div className="ai-setup">
            <p>
              No AI provider is configured, so AI-assisted actions are unavailable. Everything else
              in LiveDocs works without one.
            </p>
            <p>
              To enable explanation, summaries, and drafting: open Settings, pick a provider
              (Anthropic, OpenAI, Google, or a local Ollama), choose a model, and paste an API key.
            </p>
            <button className="primary" onClick={onOpenSettings}>
              Open Settings
            </button>
          </div>
        )}
        {state.status === 'streaming' && (
          <div className="ai-streaming">
            {state.text ? <pre className="stream-text">{state.text}</pre> : <em>Thinking…</em>}
          </div>
        )}
        {state.status === 'done' && (
          <div className="ai-result">
            {renderer.render(state.text).element}
            <ProvenanceLine provenance={state.provenance} />
          </div>
        )}
        {state.status === 'error' && (
          <div className="generated-error">AI request failed: {state.message}</div>
        )}
        {state.status === 'cancelled' && (
          <div className="muted">Generation cancelled. Nothing was saved.</div>
        )}
      </div>
    </aside>
  );
}
