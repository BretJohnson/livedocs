import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { CodeBlock, createMarkdownRenderer, type TocEntry } from '@livedocs/pipeline';
import type { CommitRecord, FileContent } from '../../../shared/ipc';
import { api, useEvent } from '../api';
import { claimedDiagramLanguages } from '../diagrams';
import { DocContext, type DocContextValue } from '../doc-context';
import { resolveRelative, sectionSourceForHeading } from '../sections';
import type { Theme } from '../theme';
import { DiagramBlock } from './DiagramBlock';
import { GeneratedSection } from './GeneratedSection';
import { Toc } from './Toc';

export interface AIActions {
  explain(selection: string): void;
  summarizeDoc(): void;
  summarizeChanges(): void;
  draft(sectionText: string): void;
}

export interface ReadingViewProps {
  filePath: string;
  anchor?: string;
  theme: Theme;
  gitAvailable: boolean;
  openFile: (relPath: string, anchor?: string) => void;
  ai: AIActions;
}

function FileHistory({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const [commits, setCommits] = useState<CommitRecord[] | null>(null);
  useEffect(() => {
    void api.invoke('git:fileHistory', { path: filePath }).then(setCommits);
  }, [filePath]);
  return (
    <div className="history-popover">
      <header>
        <strong>History — {filePath}</strong>
        <button className="icon-button" onClick={onClose}>
          ✕
        </button>
      </header>
      {!commits && <div className="muted">Loading…</div>}
      {commits && commits.length === 0 && <div className="muted">No history for this file.</div>}
      {commits && (
        <ul>
          {commits.map((c) => (
            <li key={c.hash}>
              <code>{c.hash.slice(0, 8)}</code> {new Date(c.date).toLocaleDateString()} —{' '}
              {c.message} <span className="muted">({c.author})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reading surface for Markdown documents and source files. */
export function ReadingView({
  filePath,
  anchor,
  theme,
  gitAvailable,
  openFile,
  ai,
}: ReadingViewProps) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectionButton, setSelectionButton] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const tocRef = useRef<TocEntry[]>([]);

  const load = useCallback(() => {
    api.invoke('file:read', { path: filePath }).then(
      (f) => {
        setFile(f);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [filePath]);

  useEffect(() => {
    setShowHistory(false);
    setSelectionButton(null);
    load();
  }, [load]);

  // Live refresh: re-read when the file changes on disk.
  useEvent('watcher:batch', ({ events }) => {
    for (const event of events) {
      if (event.path === filePath) {
        if (event.type === 'unlink') {
          setError('This file was deleted from disk.');
        } else {
          load();
        }
        return;
      }
    }
  });

  const scrollToAnchor = useCallback((id: string) => {
    const el = articleRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const draftForHeading = useCallback(
    (id: string) => {
      if (!file) return;
      const section = sectionSourceForHeading(file.content, tocRef.current, id);
      if (section) ai.draft(section);
    },
    [file, ai],
  );

  const renderer = useMemo(() => {
    const heading =
      (Tag: 'h1' | 'h2' | 'h3' | 'h4') =>
      ({ children, id, ...rest }: { children?: ReactNode; id?: string }) => (
        <Tag id={id} {...rest} className="doc-heading">
          {children}
          {id && Tag !== 'h1' && (
            <button
              className="section-action"
              title="Draft an update to this section with AI"
              onClick={() => draftForHeading(id)}
            >
              ✎
            </button>
          )}
        </Tag>
      );
    return createMarkdownRenderer({
      claimedLanguages: claimedDiagramLanguages(),
      components: {
        a: ({ href, children }: { href?: string; children?: ReactNode }) => (
          <a
            href={href ?? '#'}
            onClick={(e) => {
              e.preventDefault();
              if (!href) return;
              if (/^https?:/.test(href)) {
                void api.invoke('file:openExternal', { url: href });
              } else if (href.startsWith('#')) {
                scrollToAnchor(href.slice(1));
              } else {
                const [target, hash] = href.split('#');
                openFile(resolveRelative(filePath, target), hash);
              }
            }}
          >
            {children}
          </a>
        ),
        h1: heading('h1'),
        h2: heading('h2'),
        h3: heading('h3'),
        h4: heading('h4'),
        'livedocs-code': CodeBlock,
        'livedocs-fence': (props: { lang?: string; code?: string }) => (
          <DiagramBlock {...props} theme={theme} />
        ),
        'livedocs-generated': GeneratedSection,
      },
    });
  }, [filePath, theme, openFile, scrollToAnchor, draftForHeading]);

  const rendered = useMemo(() => {
    if (!file) return null;
    if (file.isMarkdown) {
      const result = renderer.render(file.content);
      tocRef.current = result.toc;
      return result;
    }
    tocRef.current = [];
    return {
      element: <CodeBlock lang={file.language ?? ''} code={file.content} />,
      toc: [] as TocEntry[],
    };
  }, [file, renderer]);

  useEffect(() => {
    if (anchor && rendered) {
      // Wait a frame so heading ids exist in the DOM.
      requestAnimationFrame(() => scrollToAnchor(anchor));
    }
  }, [anchor, rendered, scrollToAnchor]);

  const docContext: DocContextValue = useMemo(
    () => ({
      docPath: filePath,
      theme,
      openFile,
      renderMdast: (root) => renderer.renderMdast(root),
    }),
    [filePath, theme, openFile, renderer],
  );

  const onMouseUp = (e: ReactMouseEvent) => {
    const text = window.getSelection()?.toString().trim() ?? '';
    if (text.length >= 3) {
      setSelectionButton({ x: e.clientX, y: e.clientY, text });
    } else {
      setSelectionButton(null);
    }
  };

  if (error) {
    return (
      <div className="reading-view">
        <div className="doc-error">
          Could not read <code>{filePath}</code>: {error}
        </div>
      </div>
    );
  }
  if (!file || !rendered) return <div className="reading-view muted">Loading…</div>;

  return (
    <DocContext.Provider value={docContext}>
      <div className="reading-view">
        <div className="doc-toolbar">
          <span className="doc-path" title={filePath}>
            {filePath}
          </span>
          <span className="doc-actions">
            <button onClick={ai.summarizeDoc} title="AI summary of this document">
              Summarize
            </button>
            {gitAvailable && (
              <>
                <button
                  onClick={ai.summarizeChanges}
                  title="AI summary of recent repository changes"
                >
                  Recent changes
                </button>
                <button onClick={() => setShowHistory((v) => !v)}>History</button>
              </>
            )}
          </span>
        </div>
        {showHistory && <FileHistory filePath={filePath} onClose={() => setShowHistory(false)} />}
        <div className="doc-layout">
          <article
            className={`doc-article${file.isMarkdown ? '' : ' doc-source'}`}
            ref={articleRef}
            onMouseUp={onMouseUp}
          >
            {rendered.element}
          </article>
          <Toc entries={rendered.toc} onNavigate={scrollToAnchor} />
        </div>
        {selectionButton && (
          <button
            className="explain-fab"
            style={{ left: selectionButton.x, top: selectionButton.y + 14 }}
            onClick={() => {
              ai.explain(selectionButton.text);
              setSelectionButton(null);
            }}
          >
            ✨ Explain
          </button>
        )}
      </div>
    </DocContext.Provider>
  );
}
