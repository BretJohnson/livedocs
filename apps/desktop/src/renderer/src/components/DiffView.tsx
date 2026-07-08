import { diffLines } from 'diff';
import { useMemo } from 'react';

/** Unified line diff for reviewing AI-drafted section updates. */
export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const parts = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  return (
    <pre className="diff-view">
      {parts.map((part, i) => {
        const prefix = part.added ? '+' : part.removed ? '-' : ' ';
        const className = part.added
          ? 'diff-added'
          : part.removed
            ? 'diff-removed'
            : 'diff-context';
        return (
          <span key={i} className={className}>
            {part.value
              .replace(/\n$/, '')
              .split('\n')
              .map((line) => `${prefix} ${line}`)
              .join('\n')}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}
