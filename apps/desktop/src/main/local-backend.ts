import { shell } from 'electron';
import type {
  AIStartRequest,
  CommitRecord,
  FileContent,
  GenKey,
  GenResult,
  GitOverview,
  IndexStatus,
  SearchResult,
  TreeNode,
  WorkspaceBackend,
  WorkspaceInfo,
  WorkspaceReference,
} from '@livedocs/store';
import { cancelAIRequest, startAIRequest } from './ai-workflows';
import { closeWorkspace, getSession, openWorkspace, requireSession } from './session';

export class LocalWorkspaceBackend implements WorkspaceBackend {
  readonly kind = 'local' as const;

  async open(reference: WorkspaceReference): Promise<WorkspaceInfo> {
    if (reference.kind !== 'local') {
      throw new Error('Local backend can only open local workspace references');
    }
    return openWorkspace(reference);
  }

  current(): WorkspaceInfo | null {
    return getSession()?.info ?? null;
  }

  close(): Promise<void> {
    return closeWorkspace();
  }

  async tree(): Promise<TreeNode | null> {
    return getSession()?.tree() ?? null;
  }

  async readFile(relPath: string): Promise<FileContent> {
    return requireSession().readFile(relPath);
  }

  async openExternal(url: string): Promise<void> {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      await shell.openExternal(url);
    }
  }

  async applyEdit(
    relPath: string,
    oldText: string,
    newText: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return requireSession().applyEdit(relPath, oldText, newText);
  }

  search(query: string): SearchResult[] {
    return requireSession().search(query);
  }

  async gitOverview(): Promise<GitOverview> {
    return requireSession().gitOverview();
  }

  gitFileHistory(relPath: string): Promise<CommitRecord[]> {
    return requireSession().gitFileHistory(relPath);
  }

  indexStatus(): IndexStatus {
    const session = getSession();
    return session ? session.indexStatus() : { state: 'idle', filesIndexed: 0 };
  }

  getArtifact(key: GenKey): Promise<GenResult> {
    return requireSession().getArtifact(key);
  }

  refreshArtifact(key: GenKey): Promise<GenResult> {
    return requireSession().refreshArtifact(key);
  }

  async startAI(
    request: AIStartRequest,
  ): Promise<{ requestId: string } | { error: 'not-configured' }> {
    return startAIRequest(request);
  }

  cancelAI(requestId: string): void {
    cancelAIRequest(requestId);
  }
}
