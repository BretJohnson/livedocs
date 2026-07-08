import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { unified, type Processor } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeReact, { type Components } from 'rehype-react';
import type { Root as MdastRoot } from 'mdast';
import type { Root as HastRoot } from 'hast';
import { remarkLivedocs } from './remark-livedocs.js';
import { rehypeLivedocs, type TocEntry } from './rehype-livedocs.js';

export interface MarkdownRendererOptions {
  /** Code-fence languages dispatched to the host instead of plain code. */
  claimedLanguages?: string[];
  /**
   * Tag → component map. Custom pipeline elements: 'livedocs-fence'
   * (claimed diagrams), 'livedocs-code' (highlightable code blocks),
   * 'livedocs-generated' (generated sections). Standard tags (a, img, …)
   * may also be overridden.
   */
  components?: Partial<Components> & Record<string, unknown>;
}

export interface RenderResult {
  element: ReactNode;
  toc: TocEntry[];
}

export interface MarkdownRenderer {
  /** Parse + transform + render an authored Markdown document. */
  render(markdown: string): RenderResult;
  /** Render an mdast tree (e.g. a stored generated artifact). */
  renderMdast(root: MdastRoot): ReactNode;
}

/**
 * Structured document pipeline: markdown → mdast → transforms → hast →
 * React elements. Never HTML strings, so diagrams and generated sections
 * are first-class components.
 */
export function createMarkdownRenderer(options: MarkdownRendererOptions = {}): MarkdownRenderer {
  const claimedLanguages = options.claimedLanguages ?? [];
  const components = options.components ?? {};

  const buildProcessor = (
    withParser: boolean,
    collect?: (toc: TocEntry[]) => void,
  ): Processor<MdastRoot, MdastRoot, HastRoot, HastRoot, ReactNode> => {
    let processor = unified();
    if (withParser) {
      processor = processor.use(remarkParse).use(remarkGfm).use(remarkDirective);
    }
    return processor
      .use(remarkLivedocs, { claimedLanguages })
      .use(remarkRehype)
      .use(rehypeLivedocs, collect)
      .use(rehypeReact, {
        Fragment,
        jsx,
        jsxs,
        components: components as Components,
      }) as unknown as Processor<MdastRoot, MdastRoot, HastRoot, HastRoot, ReactNode>;
  };

  return {
    render(markdown: string): RenderResult {
      let toc: TocEntry[] = [];
      const processor = buildProcessor(true, (t) => {
        toc = t;
      });
      const file = processor.processSync(markdown);
      return { element: file.result as ReactNode, toc };
    },
    renderMdast(root: MdastRoot): ReactNode {
      const processor = buildProcessor(false);
      const hast = processor.runSync(root);
      return processor.stringify(hast) as unknown as ReactNode;
    },
  };
}
