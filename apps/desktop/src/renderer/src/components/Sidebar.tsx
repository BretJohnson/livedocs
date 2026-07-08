import { useEffect, useMemo, useState } from 'react';
import type { CommitRecord, GitOverview, SearchResult, TreeNode } from '../../../shared/ipc';
import { api } from '../api';

type Tab = 'docs' | 'files' | 'search' | 'history';

/** Prune the tree to Markdown files only (docs-first navigation). */
function pruneToDocs(node: TreeNode): TreeNode | null {
  if (node.type === 'file') return node.isMarkdown ? node : null;
  const children = (node.children ?? []).map(pruneToDocs).filter((c): c is TreeNode => c !== null);
  if (children.length === 0) return null;
  return { ...node, children };
}

function TreeView({
  node,
  depth,
  currentPath,
  onOpen,
  defaultOpenDepth,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string | null;
  onOpen: (path: string) => void;
  defaultOpenDepth: number;
}) {
  const [open, setOpen] = useState(depth < defaultOpenDepth);
  if (node.type === 'file') {
    return (
      <button
        className={`tree-item file${node.isMarkdown ? ' md' : ''}${
          currentPath === node.path ? ' active' : ''
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onOpen(node.path)}
        title={node.path}
      >
        {node.isMarkdown ? '📄' : '·'} {node.name}
      </button>
    );
  }
  return (
    <div>
      {depth > 0 && (
        <button
          className="tree-item dir"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▾' : '▸'} {node.name}
        </button>
      )}
      {(open || depth === 0) &&
        node.children?.map((child) => (
          <TreeView
            key={child.path}
            node={child}
            depth={depth + 1}
            currentPath={currentPath}
            onOpen={onOpen}
            defaultOpenDepth={defaultOpenDepth}
          />
        ))}
    </div>
  );
}

function SearchPanel({ onOpen }: { onOpen: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      void api.invoke('search:query', { query }).then(setResults);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="search-panel">
      <input
        type="search"
        placeholder="Search documents and source…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {results && results.length === 0 && <div className="muted">No matches.</div>}
      {results?.map((r, i) => (
        <button key={`${r.path}-${i}`} className="search-result" onClick={() => onOpen(r.path)}>
          <span className="search-path">
            {r.isMarkdown ? '📄' : '·'} {r.path}
          </span>
          <span className="search-snippet">{r.snippet}</span>
        </button>
      ))}
    </div>
  );
}

function CommitEntry({ commit, onOpen }: { commit: CommitRecord; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="commit">
      <button className="commit-header" onClick={() => setOpen((v) => !v)}>
        <code>{commit.hash.slice(0, 8)}</code> {commit.message}
        <span className="muted">
          {' '}
          — {commit.author}, {new Date(commit.date).toLocaleDateString()}
        </span>
      </button>
      {open && (
        <ul className="commit-files">
          {commit.files.map((f, i) => (
            <li key={i}>
              <button className="link" onClick={() => onOpen(f.path)}>
                <code>{f.status}</code> {f.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryPanel({
  git,
  onOpen,
}: {
  git: GitOverview | null;
  onOpen: (path: string) => void;
}) {
  if (!git) return <div className="muted">Loading…</div>;
  if (!git.isRepo) {
    return <div className="muted">This workspace is not a Git repository.</div>;
  }
  return (
    <div className="history-panel">
      <div className="branch-line">
        On branch <strong>{git.branch}</strong>
      </div>
      {git.commits.map((c) => (
        <CommitEntry key={c.hash} commit={c} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function Sidebar({
  tree,
  git,
  currentPath,
  onOpen,
}: {
  tree: TreeNode | null;
  git: GitOverview | null;
  currentPath: string | null;
  onOpen: (path: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('docs');
  const docsTree = useMemo(() => (tree ? pruneToDocs(tree) : null), [tree]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'docs', label: 'Docs' },
    { id: 'files', label: 'Files' },
    { id: 'search', label: 'Search' },
    { id: 'history', label: 'History' },
  ];

  return (
    <aside className="sidebar">
      <nav className="sidebar-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === 'docs' &&
          (docsTree ? (
            <TreeView
              node={docsTree}
              depth={0}
              currentPath={currentPath}
              onOpen={onOpen}
              defaultOpenDepth={3}
            />
          ) : (
            <div className="muted">No Markdown documents found in this workspace.</div>
          ))}
        {tab === 'files' && tree && (
          <TreeView
            node={tree}
            depth={0}
            currentPath={currentPath}
            onOpen={onOpen}
            defaultOpenDepth={1}
          />
        )}
        {tab === 'search' && <SearchPanel onOpen={onOpen} />}
        {tab === 'history' && <HistoryPanel git={git} onOpen={onOpen} />}
      </div>
    </aside>
  );
}
