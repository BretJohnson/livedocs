import type { Theme } from './theme';

/**
 * Diagram renderer registry (language tag → async SVG renderer). Rendering
 * either returns an SVG string or throws — the caller shows an inline error
 * with the original source. Language tags without a registered renderer are
 * never claimed from the Markdown pipeline, so they fall back to plain code
 * blocks. Future formats (Graphviz WASM, PlantUML, D2) register here.
 */
export type DiagramRenderer = (code: string, theme: Theme) => Promise<string>;

const registry = new Map<string, DiagramRenderer>();

export function registerDiagramRenderer(lang: string, renderer: DiagramRenderer): void {
  registry.set(lang.toLowerCase(), renderer);
}

export function getDiagramRenderer(lang: string): DiagramRenderer | undefined {
  return registry.get(lang.toLowerCase());
}

export function claimedDiagramLanguages(): string[] {
  return [...registry.keys()];
}

// ---- Mermaid (renders client-side in the renderer process) ----

let mermaidCounter = 0;

const renderMermaid: DiagramRenderer = async (code, theme) => {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
  });
  // parse() first: it validates without leaving orphaned error nodes in the DOM.
  await mermaid.parse(code);
  const { svg } = await mermaid.render(`livedocs-mermaid-${mermaidCounter++}`, code);
  return svg;
};

registerDiagramRenderer('mermaid', renderMermaid);
