import type { Root } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';

export interface LivedocsRemarkOptions {
  /**
   * Code-fence languages claimed by registered transforms (e.g. 'mermaid').
   * Claimed fences become <livedocs-fence> elements; everything else stays a
   * normal code block.
   */
  claimedLanguages: string[];
}

/**
 * The pipeline extension point (mdast side): dispatches claimed code fences
 * and `:::generated` directives to custom elements the host application maps
 * to React components. Unknown directives degrade to labeled containers.
 */
export function remarkLivedocs(options: LivedocsRemarkOptions) {
  const claimed = new Set(options.claimedLanguages.map((l) => l.toLowerCase()));
  return (tree: Root): void => {
    visit(tree, 'code', (node, index, parent) => {
      const lang = node.lang?.toLowerCase() ?? '';
      if (!claimed.has(lang) || parent === undefined || index === undefined) return;
      // Replace the code node with a custom node so mdast-util-to-hast emits
      // a bare <livedocs-fence> element (a code node would stay wrapped in <pre>).
      parent.children[index] = {
        type: 'livedocsFence',
        data: {
          hName: 'livedocs-fence',
          hProperties: { lang, code: node.value },
        },
        children: [],
      } as never;
      return SKIP;
    });

    visit(tree, (node) => {
      if (
        node.type !== 'containerDirective' &&
        node.type !== 'leafDirective' &&
        node.type !== 'textDirective'
      ) {
        return;
      }
      const directive = node as typeof node & {
        name: string;
        attributes?: Record<string, string | null | undefined>;
        data?: Record<string, unknown>;
      };
      const attributes = directive.attributes ?? {};
      if (directive.name === 'generated' && node.type !== 'textDirective') {
        const { name, ...params } = attributes;
        directive.data = {
          ...directive.data,
          hName: 'livedocs-generated',
          hProperties: {
            name: name ?? '',
            params: JSON.stringify(
              Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v ?? ''])),
            ),
          },
        };
      } else {
        // Unknown directives render as a visible labeled container, never an error.
        directive.data = {
          ...directive.data,
          hName: node.type === 'textDirective' ? 'span' : 'div',
          hProperties: { className: ['directive', `directive-${directive.name}`] },
        };
      }
    });
  };
}
