import {
  AGENT_PROTOCOL_VERSION,
  deserializeWorkspaceReference,
  isProtocolVersionCompatible,
  protocolError,
  type AgentProtocolError,
  type AgentRequest,
  type AgentResponse,
  type AgentWireMessage,
  type ProtocolVersionRange,
  type WslWorkspaceReference,
} from '@livedocs/store';
import { defaultAgentDataDir, NodeWorkspaceService } from './node-workspace-service';

function parseWorkspaceArg(argv: readonly string[]): WslWorkspaceReference | null {
  const index = argv.indexOf('--workspace');
  if (index === -1 || !argv[index + 1]) return null;
  const reference = deserializeWorkspaceReference(argv[index + 1]);
  if (reference.kind !== 'wsl') throw new Error('WSL agent requires a WSL workspace reference');
  return reference;
}

function write(message: AgentWireMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(response: AgentResponse): void {
  write({ kind: 'response', response });
}

function errorResponse(id: string, err: unknown): AgentResponse {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return { id, ok: false, error: err as AgentProtocolError };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    id,
    ok: false,
    error: protocolError(
      message.includes('escapes the workspace') ? 'path-escape' : 'internal-error',
      message,
    ),
  };
}

export async function runWslAgent(argv = process.argv.slice(2)): Promise<void> {
  const initialWorkspace = parseWorkspaceArg(argv);
  const service = new NodeWorkspaceService(defaultAgentDataDir(), {
    onWatcherBatch: (events) =>
      write({ kind: 'event', event: { type: 'watcher.batch', data: { events } } }),
    onIndexUpdated: (changed, removed) =>
      write({ kind: 'event', event: { type: 'index.updated', data: { changed, removed } } }),
    onIndexStatus: (status) =>
      write({ kind: 'event', event: { type: 'index.status', data: status } }),
    onGeneratedStaleChanged: (items) =>
      write({ kind: 'event', event: { type: 'gen.staleChanged', data: { items } } }),
    onWorkspaceChanged: (info) =>
      write({ kind: 'event', event: { type: 'workspace.changed', data: info } }),
  });

  let buffer = '';
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void service.close().finally(() => process.exit(0));
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      void handleLine(service, initialWorkspace, line);
    }
  });
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function handleLine(
  service: NodeWorkspaceService,
  initialWorkspace: WslWorkspaceReference | null,
  line: string,
): Promise<void> {
  let request: AgentRequest;
  try {
    const message = JSON.parse(line) as AgentWireMessage;
    if (message.kind !== 'request') return;
    request = message.request;
  } catch {
    return;
  }

  try {
    const result = await handleRequest(service, initialWorkspace, request);
    respond({ id: request.id, ok: true, result });
    if (request.method === 'agent.shutdown') {
      await service.close();
      process.exit(0);
    }
  } catch (err) {
    respond(errorResponse(request.id, err));
  }
}

async function handleRequest(
  service: NodeWorkspaceService,
  initialWorkspace: WslWorkspaceReference | null,
  request: AgentRequest,
): Promise<unknown> {
  switch (request.method) {
    case 'protocol.handshake': {
      const local: ProtocolVersionRange = {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        minProtocolVersion: AGENT_PROTOCOL_VERSION,
      };
      const remote: ProtocolVersionRange = {
        protocolVersion: request.params.clientProtocolVersion,
        minProtocolVersion: request.params.minProtocolVersion,
      };
      if (!isProtocolVersionCompatible(local, remote)) {
        throw protocolError(
          'incompatible-protocol',
          `Agent protocol ${AGENT_PROTOCOL_VERSION} is not compatible with client protocol ${remote.protocolVersion}.`,
        );
      }
      return {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        minProtocolVersion: AGENT_PROTOCOL_VERSION,
        agentVersion: '0.1.0',
      };
    }
    case 'workspace.open': {
      const reference =
        request.params.reference.kind === 'wsl' ? request.params.reference : initialWorkspace;
      if (!reference) throw protocolError('bad-request', 'Expected a WSL workspace reference');
      return service.open(reference);
    }
    case 'workspace.current':
      return service.current();
    case 'workspace.tree':
      return service.tree();
    case 'file.read':
      return service.readFile(request.params.path);
    case 'file.applyEdit':
      return service.applyEdit(request.params.path, request.params.oldText, request.params.newText);
    case 'search.query':
      return service.search(request.params.query);
    case 'git.overview':
      return service.gitOverview();
    case 'git.fileHistory':
      return service.gitFileHistory(request.params.path);
    case 'index.status':
      return service.indexStatus();
    case 'gen.get':
      return service.getArtifact(request.params);
    case 'gen.refresh':
      return service.refreshArtifact(request.params);
    case 'ai.start':
      return { error: 'not-configured' as const };
    case 'ai.cancel':
      return undefined;
    case 'agent.shutdown':
      return undefined;
  }
}
