import type { Element, Root, Text } from 'hast';
import GithubSlugger from 'github-slugger';
import { visit } from 'unist-util-visit';

export interface TocEntry {
  depth: number;
  id: string;
  text: string;
}

function textOf(node: Element | Text): string {
  if (node.type === 'text') return node.value;
  return node.children
    .map((child) => (child.type === 'text' || child.type === 'element' ? textOf(child) : ''))
    .join('');
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * hast-side pass: assign stable GitHub-style ids to headings (collecting the
 * table of contents) and lift <pre><code> blocks into <livedocs-code>
 * elements so the host can render them with syntax highlighting.
 */
export function rehypeLivedocs(collect?: (toc: TocEntry[]) => void) {
  return (tree: Root): void => {
    const slugger = new GithubSlugger();
    const toc: TocEntry[] = [];

    visit(tree, 'element', (node) => {
      if (HEADINGS.has(node.tagName)) {
        const text = textOf(node);
        const id = (node.properties.id as string | undefined) ?? slugger.slug(text);
        node.properties.id = id;
        toc.push({ depth: Number(node.tagName.slice(1)), id, text });
        return;
      }
      if (node.tagName === 'pre') {
        const code = node.children.find(
          (child): child is Element => child.type === 'element' && child.tagName === 'code',
        );
        if (!code) return;
        const className = (code.properties.className as string[] | undefined) ?? [];
        const langClass = className.find((c) => c.startsWith('language-'));
        const lang = langClass ? langClass.slice('language-'.length) : '';
        node.tagName = 'livedocs-code';
        node.properties = { lang, code: textOf(code) };
        node.children = [];
      }
    });

    collect?.(toc);
  };
}
