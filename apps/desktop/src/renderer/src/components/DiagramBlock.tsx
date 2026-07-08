import { useEffect, useState } from 'react';
import { getDiagramRenderer } from '../diagrams';
import type { Theme } from '../theme';
import { Lightbox } from './Lightbox';

export interface DiagramBlockProps {
  lang?: string;
  code?: string;
  theme: Theme;
}

type DiagramState =
  { status: 'rendering' } | { status: 'ok'; svg: string } | { status: 'error'; message: string };

/**
 * Renders a claimed code fence through the diagram registry. Invalid source
 * shows an inline error with the original code — the document never crashes.
 * Click a rendered diagram to enlarge (zoom + pan).
 */
export function DiagramBlock({ lang = '', code = '', theme }: DiagramBlockProps) {
  const [state, setState] = useState<DiagramState>({ status: 'rendering' });
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'rendering' });
    const renderer = getDiagramRenderer(lang);
    if (!renderer) {
      setState({ status: 'error', message: `No diagram renderer registered for "${lang}"` });
      return;
    }
    renderer(code, theme).then(
      (svg) => {
        if (!cancelled) setState({ status: 'ok', svg });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lang, code, theme]);

  if (state.status === 'error') {
    return (
      <div className="diagram-error">
        <div className="diagram-error-title">
          Failed to render {lang} diagram: {state.message}
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (state.status === 'rendering') {
    return <div className="diagram diagram-loading">Rendering {lang} diagram…</div>;
  }

  return (
    <>
      <div
        className="diagram"
        title="Click to enlarge"
        role="button"
        tabIndex={0}
        onClick={() => setEnlarged(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setEnlarged(true);
        }}
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      {enlarged && <Lightbox svg={state.svg} onClose={() => setEnlarged(false)} />}
    </>
  );
}
