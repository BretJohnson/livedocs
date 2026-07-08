import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Root as MdastRoot } from 'mdast';
import type { GenResult, Provenance } from '../../../shared/ipc';
import { api, useEvent } from '../api';
import { useDocContext } from '../doc-context';

export interface GeneratedSectionProps {
  name?: string;
  params?: string;
}

function ProvenancePopover({ provenance, stale }: { provenance: Provenance; stale: boolean }) {
  return (
    <div className="provenance-popover">
      <table>
        <tbody>
          <tr>
            <th>Generator</th>
            <td>
              {provenance.generator} ({provenance.kind})
            </td>
          </tr>
          {provenance.model && (
            <tr>
              <th>Model</th>
              <td>{provenance.model}</td>
            </tr>
          )}
          <tr>
            <th>Generated</th>
            <td>{new Date(provenance.timestamp).toLocaleString()}</td>
          </tr>
          <tr>
            <th>Inputs</th>
            <td>{provenance.inputSummary ?? '—'}</td>
          </tr>
          <tr>
            <th>Input digest</th>
            <td>
              <code>{provenance.inputDigest.slice(0, 16)}…</code>
            </td>
          </tr>
          {provenance.cacheHit !== undefined && (
            <tr>
              <th>Cache</th>
              <td>{provenance.cacheHit ? 'served from cache' : 'fresh generation'}</td>
            </tr>
          )}
          <tr>
            <th>Status</th>
            <td>{stale ? 'stale — inputs changed since generation' : 'current'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders a `:::generated{name=…}` directive. The authored file only ever
 * contains the directive marker; generated output lives in the workspace
 * store and is rendered here at view time.
 */
export function GeneratedSection({ name = '', params = '{}' }: GeneratedSectionProps) {
  const { docPath, renderMdast } = useDocContext();
  const [result, setResult] = useState<GenResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);
  const key = useMemo(
    () => ({ docPath, generator: name, params: params || '{}' }),
    [docPath, name, params],
  );

  const load = useCallback(() => {
    void api.invoke('gen:get', key).then(setResult);
  }, [key]);

  useEffect(load, [load]);

  useEvent('gen:staleChanged', ({ items }) => {
    if (items.some((i) => i.docPath === key.docPath && i.generator === key.generator)) load();
  });

  const refresh = useCallback(() => {
    setRunning(true);
    void api
      .invoke('gen:refresh', key)
      .then(setResult)
      .finally(() => setRunning(false));
  }, [key]);

  const body = useMemo(() => {
    if (!result) return <div className="generated-loading">Loading generated section…</div>;
    switch (result.status) {
      case 'ok':
        try {
          return renderMdast(JSON.parse(result.output) as MdastRoot);
        } catch {
          return <div className="generated-error">Stored artifact is corrupted; refresh.</div>;
        }
      case 'unknown-generator':
        return (
          <div className="generated-error">
            Unknown generator <code>{result.name}</code>. Available generators:{' '}
            {result.available.join(', ')}.
          </div>
        );
      case 'needs-run':
        return result.reason === 'ai-unconfigured' ? (
          <div className="generated-empty">
            This section is produced by the AI generator <code>{result.name}</code>, but no AI
            provider is configured. Open Settings to configure one, then generate.
          </div>
        ) : (
          <div className="generated-empty">
            <p>
              This section is produced by the AI generator <code>{result.name}</code>. Generation
              runs only when you ask for it.
            </p>
            <button className="primary" disabled={running} onClick={refresh}>
              {running ? 'Generating…' : 'Generate now'}
            </button>
          </div>
        );
      case 'error':
        return <div className="generated-error">Generator failed: {result.message}</div>;
    }
  }, [result, renderMdast, refresh, running]);

  const ok = result?.status === 'ok';
  return (
    <section className={`generated-section${ok && result.stale ? ' stale' : ''}`}>
      <header className="generated-header">
        <span className="generated-badge" title="Content produced by a generator, not authored">
          ⚙ generated · {name || '(unnamed)'}
        </span>
        {ok && result.stale && (
          <span className="stale-badge" title="Inputs changed since this was generated">
            stale
          </span>
        )}
        <span className="generated-actions">
          {ok && (
            <button
              className="icon-button"
              title="Provenance"
              onClick={() => setShowProvenance((v) => !v)}
            >
              ⓘ
            </button>
          )}
          {(ok || result?.status === 'error') && (
            <button className="icon-button" title="Refresh" disabled={running} onClick={refresh}>
              {running ? '…' : '↻'}
            </button>
          )}
        </span>
      </header>
      {showProvenance && ok && (
        <ProvenancePopover provenance={result.provenance} stale={result.stale} />
      )}
      <div className="generated-body">{body}</div>
    </section>
  );
}
