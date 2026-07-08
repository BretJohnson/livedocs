import type { TocEntry } from '@livedocs/pipeline';

/** Resolve a document-relative link target to a workspace-relative path. */
export function resolveRelative(fromDoc: string, relative: string): string {
  const parts = fromDoc.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

interface ScannedHeading {
  depth: number;
  /** Byte offset of the heading line start. */
  start: number;
}

/**
 * Scan raw Markdown for ATX headings (skipping fenced code), in document
 * order. The Nth scanned heading corresponds to the Nth TOC entry produced
 * by the pipeline, which lets us map a heading id back to its source range.
 */
export function scanHeadings(markdown: string): ScannedHeading[] {
  const headings: ScannedHeading[] = [];
  let offset = 0;
  let inFence = false;
  let fenceMarker = '';
  for (const line of markdown.split('\n')) {
    const trimmed = line.trimStart();
    if (inFence) {
      if (trimmed.startsWith(fenceMarker)) inFence = false;
    } else if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = true;
      fenceMarker = trimmed.slice(0, 3);
    } else {
      const match = /^(#{1,6})\s/.exec(line);
      if (match) headings.push({ depth: match[1].length, start: offset });
    }
    offset += line.length + 1;
  }
  return headings;
}

/**
 * The authored source of the section starting at the heading with `id`:
 * from its heading line to the next heading of equal or shallower depth.
 */
export function sectionSourceForHeading(
  markdown: string,
  toc: TocEntry[],
  id: string,
): string | null {
  const index = toc.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const scanned = scanHeadings(markdown);
  if (scanned.length !== toc.length) return null; // setext headings etc — bail safely
  const target = scanned[index];
  let end = markdown.length;
  for (let i = index + 1; i < scanned.length; i++) {
    if (scanned[i].depth <= target.depth) {
      end = scanned[i].start;
      break;
    }
  }
  return markdown.slice(target.start, end).replace(/\n+$/, '\n');
}
