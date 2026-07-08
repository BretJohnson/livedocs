import { useEffect, useState } from 'react';

let shikiModule: Promise<typeof import('shiki')> | null = null;

function loadShiki(): Promise<typeof import('shiki')> {
  shikiModule ??= import('shiki');
  return shikiModule;
}

export interface CodeBlockProps {
  lang?: string;
  code?: string;
}

/**
 * Syntax-highlighted code block (Shiki, dual light/dark themes via CSS
 * variables). Unknown languages — and the moment before highlighting
 * resolves — render as plain monospaced text, never an error.
 */
export function CodeBlock({ lang = '', code = '' }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    if (!lang) return;
    void (async () => {
      try {
        const shiki = await loadShiki();
        if (!(lang in shiki.bundledLanguages)) return;
        const rendered = await shiki.codeToHtml(code, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        });
        if (!cancelled) setHtml(rendered);
      } catch {
        // Highlighting is progressive enhancement; the plain block stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lang, code]);

  if (html) {
    return (
      <div className="code-block" data-lang={lang} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return (
    <div className="code-block" data-lang={lang || undefined}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
