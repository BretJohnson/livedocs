import {
  workspaceOpenRequestToReference,
  type WorkspaceBackend,
  type WorkspaceBackendEventMap,
  type WorkspaceOpenRequest,
  type WorkspaceReference,
} from '@livedocs/store';
import { AgentWorkspaceBackend } from './agent-backend';
import { broadcast } from './ipc';
import { LocalWorkspaceBackend } from './local-backend';

const localBackend = new LocalWorkspaceBackend();
const agentBackend = new AgentWorkspaceBackend((channel, data) => broadcast(channel, data));
let activeBackend: WorkspaceBackend = localBackend;

export function emitWorkspaceEvent<C extends keyof WorkspaceBackendEventMap>(
  channel: C,
  data: WorkspaceBackendEventMap[C],
): void {
  broadcast(channel, data);
}

export function currentBackend(): WorkspaceBackend {
  return activeBackend;
}

export async function openWorkspaceRequest(
  request: WorkspaceOpenRequest | string,
): Promise<ReturnType<WorkspaceBackend['open']> extends Promise<infer T> ? T : never> {
  const reference =
    typeof request === 'string'
      ? workspaceOpenRequestToReference({ path: request })
      : workspaceOpenRequestToReference(request);
  return openWorkspaceReference(reference);
}

export async function openWorkspaceReference(reference: WorkspaceReference) {
  const nextBackend = reference.kind === 'wsl' ? agentBackend : localBackend;
  const previousBackend = activeBackend;
  try {
    const info = await nextBackend.open(reference);
    if (previousBackend !== nextBackend) {
      await previousBackend.close();
    }
    activeBackend = nextBackend;
    return info;
  } catch (err) {
    broadcast('workspace:connection', {
      state: 'error',
      message: err instanceof Error ? err.message : String(err),
      reference,
    });
    throw err;
  }
}
