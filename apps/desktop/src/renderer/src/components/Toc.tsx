import type { TocEntry } from '@livedocs/pipeline';

export function Toc({
  entries,
  onNavigate,
}: {
  entries: TocEntry[];
  onNavigate: (id: string) => void;
}) {
  if (entries.length < 2) return null;
  return (
    <nav className="toc" aria-label="Table of contents">
      <div className="toc-title">On this page</div>
      <ul>
        {entries.map((entry, i) => (
          <li key={`${entry.id}-${i}`} style={{ paddingLeft: `${(entry.depth - 1) * 12}px` }}>
            <button className="toc-link" onClick={() => onNavigate(entry.id)}>
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
