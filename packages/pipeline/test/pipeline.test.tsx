import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { Root } from 'mdast';
import { createMarkdownRenderer } from '../src/index.js';

const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('markdown pipeline', () => {
  it('renders CommonMark and GFM constructs', () => {
    const renderer = createMarkdownRenderer();
    const out = html(
      renderer.render(
        '# Title\n\n' +
          '| a | b |\n|---|---|\n| 1 | 2 |\n\n' +
          '- [x] done\n- [ ] todo\n\n' +
          '~~gone~~ and https://example.com\n',
      ).element,
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<del>gone</del>');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('<a href="https://example.com">');
  });

  it('dispatches claimed fence languages to the registered component', () => {
    const renderer = createMarkdownRenderer({
      claimedLanguages: ['mermaid'],
      components: {
        'livedocs-fence': ({ lang, code }: { lang?: string; code?: string }) => (
          <div className="fence-stub" data-lang={lang}>
            {code}
          </div>
        ),
      },
    });
    const out = html(renderer.render('```mermaid\ngraph LR\nA-->B\n```\n').element);
    expect(out).toContain('class="fence-stub"');
    expect(out).toContain('data-lang="mermaid"');
    expect(out).toContain('A--&gt;B');
  });

  it('leaves unclaimed fences as plain code blocks (livedocs-code)', () => {
    const seen: string[] = [];
    const renderer = createMarkdownRenderer({
      claimedLanguages: ['mermaid'],
      components: {
        'livedocs-code': ({ lang, code }: { lang?: string; code?: string }) => {
          seen.push(lang ?? '');
          return <pre>{code}</pre>;
        },
      },
    });
    const out = html(renderer.render('```plantuml\n@startuml\n@enduml\n```\n').element);
    expect(seen).toEqual(['plantuml']);
    expect(out).toContain('@startuml');
  });

  it('generates a table of contents with stable heading ids', () => {
    const renderer = createMarkdownRenderer();
    const { element, toc } = renderer.render('# One\n\n## Two Words\n\n## Two Words\n');
    expect(toc).toEqual([
      { depth: 1, id: 'one', text: 'One' },
      { depth: 2, id: 'two-words', text: 'Two Words' },
      { depth: 2, id: 'two-words-1', text: 'Two Words' },
    ]);
    const out = html(element);
    expect(out).toContain('id="two-words-1"');
  });

  it('maps :::generated directives to the generated-section component', () => {
    const renderer = createMarkdownRenderer({
      components: {
        'livedocs-generated': ({ name, params }: { name?: string; params?: string }) => (
          <section className="gen-stub" data-name={name} data-params={params} />
        ),
      },
    });
    const out = html(
      renderer.render('before\n\n:::generated{name="api-index" scope="src"}\n:::\n\nafter').element,
    );
    expect(out).toContain('data-name="api-index"');
    expect(out).toContain('&quot;scope&quot;:&quot;src&quot;');
  });

  it('renders unknown directives as labeled containers, not errors', () => {
    const renderer = createMarkdownRenderer();
    const out = html(renderer.render(':::warning\nCareful.\n:::\n').element);
    expect(out).toContain('directive-warning');
    expect(out).toContain('Careful.');
  });

  it('renders stored mdast artifacts (renderMdast)', () => {
    const renderer = createMarkdownRenderer({
      claimedLanguages: ['mermaid'],
      components: {
        'livedocs-fence': ({ lang }: { lang?: string }) => (
          <div className="fence-stub" data-lang={lang} />
        ),
      },
    });
    const artifact: Root = {
      type: 'root',
      children: [
        { type: 'heading', depth: 3, children: [{ type: 'text', value: 'Generated' }] },
        { type: 'code', lang: 'mermaid', value: 'graph LR\nA-->B' },
      ],
    };
    const out = html(renderer.renderMdast(artifact));
    expect(out).toContain('<h3 id="generated">Generated</h3>');
    expect(out).toContain('data-lang="mermaid"');
  });
});
