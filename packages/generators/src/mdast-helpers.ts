import { createHash } from 'node:crypto';
import type {
  Code,
  Heading,
  InlineCode,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
  Text,
} from 'mdast';

export const text = (value: string): Text => ({ type: 'text', value });
export const inlineCode = (value: string): InlineCode => ({ type: 'inlineCode', value });

export const paragraph = (children: PhrasingContent[] | string): Paragraph => ({
  type: 'paragraph',
  children: typeof children === 'string' ? [text(children)] : children,
});

export const heading = (depth: Heading['depth'], value: string): Heading => ({
  type: 'heading',
  depth,
  children: [text(value)],
});

export const code = (lang: string, value: string): Code => ({ type: 'code', lang, value });

export const listItem = (children: PhrasingContent[]): ListItem => ({
  type: 'listItem',
  children: [{ type: 'paragraph', children }],
});

export const list = (items: ListItem[]): List => ({
  type: 'list',
  ordered: false,
  spread: false,
  children: items,
});

const cell = (children: PhrasingContent[]): TableCell => ({ type: 'tableCell', children });

export function table(header: string[], rows: PhrasingContent[][][]): Table {
  const headerRow: TableRow = {
    type: 'tableRow',
    children: header.map((h) => cell([text(h)])),
  };
  const bodyRows: TableRow[] = rows.map((r) => ({
    type: 'tableRow',
    children: r.map(cell),
  }));
  return { type: 'table', align: header.map(() => null), children: [headerRow, ...bodyRows] };
}

export const root = (children: RootContent[]): Root => ({ type: 'root', children });

export function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
