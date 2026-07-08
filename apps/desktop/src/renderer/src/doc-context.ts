import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Root as MdastRoot } from 'mdast';
import type { Theme } from './theme';

/** Context the reading view provides to embedded components (links, generated sections). */
export interface DocContextValue {
  docPath: string;
  theme: Theme;
  openFile(path: string, anchor?: string): void;
  renderMdast(root: MdastRoot): ReactNode;
}

export const DocContext = createContext<DocContextValue | null>(null);

export function useDocContext(): DocContextValue {
  const value = useContext(DocContext);
  if (!value) throw new Error('DocContext missing');
  return value;
}
