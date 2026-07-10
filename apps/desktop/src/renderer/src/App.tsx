import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AIStartRequest,
  GitOverview,
  IndexStatus,
  TreeNode,
  WorkspaceInfo,
} from '../../shared/ipc';
import { api, useEvent } from './api';
import { useTheme } from './theme';
import { AIPanel, type AIPanelState } from './components/AIPanel';
import { DraftDialog, type DraftRequest } from './components/DraftDialog';
import { ReadingView, type AIActions } from './components/ReadingView';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { WelcomeScreen } from './components/WelcomeScreen';

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [git, setGit] = useState<GitOverview | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [current, setCurrent] = useState<{ path: string; anchor?: string } | null>(null);
  const [aiPanel, setAIPanel] = useState<AIPanelState | null>(null);
  const [draft, setDraft] = useState<DraftRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const treeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshWorkspaceState = useCallback(() => {
    void api.invoke('workspace:tree', undefined).then(setTree);
    void api.invoke('git:overview', undefined).then(setGit, () => setGit(null));
    void api.invoke('index:status', undefined).then(setIndexStatus);
  }, []);

  useEffect(() => {
    void api.invoke('workspace:current', undefined).then((info) => {
      setWorkspace(info);
      if (info) refreshWorkspaceState();
    });
  }, [refreshWorkspaceState]);

  useEvent('workspace:changed', (info) => {
    setWorkspace(info);
    if (info) setConnectionMessage(null);
    setCurrent(null);
    setTree(null);
    setGit(null);
    if (info) refreshWorkspaceState();
  });

  useEvent('workspace:connection', (event) => {
    if (event.state === 'error' || event.state === 'disconnected') {
      setConnectionMessage(event.message ?? 'The workspace agent disconnected.');
    } else if (event.state === 'connected') {
      setConnectionMessage(null);
    }
  });

  useEvent('watcher:batch', () => {
    // Structural changes arrive in bursts; refresh the tree once per burst.
    if (treeRefreshTimer.current) clearTimeout(treeRefreshTimer.current);
    treeRefreshTimer.current = setTimeout(() => {
      void api.invoke('workspace:tree', undefined).then(setTree);
    }, 300);
  });

  useEvent('index:status', setIndexStatus);
  useEvent('index:updated', () => {
    void api.invoke('git:overview', undefined).then(setGit, () => setGit(null));
  });

  useEvent('ai:stream', (event) => {
    setAIPanel((state) => {
      if (!state || state.status !== 'streaming' || state.requestId !== event.requestId) {
        return state;
      }
      switch (event.type) {
        case 'chunk':
          return { ...state, text: state.text + event.text };
        case 'done':
          return {
            status: 'done',
            title: state.title,
            text: event.text,
            provenance: event.provenance,
          };
        case 'error':
          return { status: 'error', title: state.title, message: event.message };
        case 'cancelled':
          return { status: 'cancelled', title: state.title };
      }
    });
  });

  const openFile = useCallback((path: string, anchor?: string) => {
    setCurrent({ path, anchor });
  }, []);

  const startWorkflow = useCallback(async (title: string, request: AIStartRequest) => {
    const result = await api.invoke('ai:start', request);
    if ('error' in result) {
      setAIPanel({ status: 'not-configured', title });
    } else {
      setAIPanel({ status: 'streaming', title, requestId: result.requestId, text: '' });
    }
  }, []);

  const aiActions: AIActions = {
    explain: (selection) => {
      if (current)
        void startWorkflow('Explain selection', {
          kind: 'explain',
          docPath: current.path,
          selection,
        });
    },
    summarizeDoc: () => {
      if (current)
        void startWorkflow(`Summary — ${current.path}`, {
          kind: 'summarize-doc',
          docPath: current.path,
        });
    },
    summarizeChanges: () => {
      void startWorkflow('Recent repository changes', { kind: 'summarize-changes' });
    },
    draft: (sectionText) => {
      if (current) setDraft({ docPath: current.path, sectionText });
    },
  };

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">LiveDocs</span>
        {workspace && (
          <span className="workspace-name" title={workspace.label}>
            {workspace.kind === 'wsl' ? workspace.label : workspace.name}
          </span>
        )}
        <span className="spacer" />
        {indexStatus && workspace && (
          <span className="index-status" title="Repository index">
            {indexStatus.state === 'scanning'
              ? 'Indexing…'
              : `${indexStatus.filesIndexed} files indexed`}
          </span>
        )}
        {workspace && (
          <button onClick={() => void api.invoke('workspace:openDialog', undefined)}>Open…</button>
        )}
        <button onClick={toggleTheme} title="Toggle light/dark theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button onClick={() => setSettingsOpen(true)} title="Settings">
          ⚙
        </button>
      </header>
      {connectionMessage && <div className="connection-banner">{connectionMessage}</div>}

      <div className="app-body">
        {workspace ? (
          <>
            <Sidebar tree={tree} git={git} currentPath={current?.path ?? null} onOpen={openFile} />
            <main className="main-pane">
              {current ? (
                <ReadingView
                  filePath={current.path}
                  anchor={current.anchor}
                  theme={theme}
                  gitAvailable={git?.isRepo ?? false}
                  openFile={openFile}
                  ai={aiActions}
                />
              ) : (
                <div className="empty-state muted">Select a document from the sidebar.</div>
              )}
            </main>
          </>
        ) : (
          <WelcomeScreen onOpenDialog={() => void api.invoke('workspace:openDialog', undefined)} />
        )}
      </div>

      {aiPanel && (
        <AIPanel
          state={aiPanel}
          onClose={() => setAIPanel(null)}
          onOpenSettings={() => {
            setAIPanel(null);
            setSettingsOpen(true);
          }}
        />
      )}
      {draft && (
        <DraftDialog
          request={draft}
          onClose={() => setDraft(null)}
          onOpenSettings={() => {
            setDraft(null);
            setSettingsOpen(true);
          }}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
