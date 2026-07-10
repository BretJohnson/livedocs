import type {
  AIStartRequest,
  AIStreamEvent,
  CommitRecord,
  FileContent,
  GenKey,
  GenResult,
  GitOverview,
  IndexStatus,
  SearchResult,
  TreeNode,
  WatcherEvent,
  WorkspaceInfo,
} from './types.js';
import type { WorkspaceReference } from './workspace-ref.js';

export const AGENT_PROTOCOL_VERSION = 1;

export interface ProtocolVersionRange {
  protocolVersion: number;
  minProtocolVersion?: number;
}

export function isProtocolVersionCompatible(
  local: ProtocolVersionRange,
  remote: ProtocolVersionRange,
): boolean {
  const localMin = local.minProtocolVersion ?? local.protocolVersion;
  const remoteMin = remote.minProtocolVersion ?? remote.protocolVersion;
  return local.protocolVersion >= remoteMin && remote.protocolVersion >= localMin;
}

export type AgentErrorCode =
  | 'bad-request'
  | 'incompatible-protocol'
  | 'workspace-error'
  | 'not-found'
  | 'path-escape'
  | 'not-configured'
  | 'internal-error';

export interface AgentProtocolError {
  code: AgentErrorCode;
  message: string;
}

export interface AgentRequestEnvelope<Method extends string, Params> {
  id: string;
  version: typeof AGENT_PROTOCOL_VERSION;
  method: Method;
  params: Params;
}

export type AgentRequest =
  | AgentRequestEnvelope<
      'protocol.handshake',
      { clientProtocolVersion: number; minProtocolVersion?: number }
    >
  | AgentRequestEnvelope<'workspace.open', { reference: WorkspaceReference }>
  | AgentRequestEnvelope<'workspace.current', Record<string, never>>
  | AgentRequestEnvelope<'workspace.tree', Record<string, never>>
  | AgentRequestEnvelope<'file.read', { path: string }>
  | AgentRequestEnvelope<'file.applyEdit', { path: string; oldText: string; newText: string }>
  | AgentRequestEnvelope<'search.query', { query: string }>
  | AgentRequestEnvelope<'git.overview', Record<string, never>>
  | AgentRequestEnvelope<'git.fileHistory', { path: string }>
  | AgentRequestEnvelope<'index.status', Record<string, never>>
  | AgentRequestEnvelope<'gen.get', GenKey>
  | AgentRequestEnvelope<'gen.refresh', GenKey>
  | AgentRequestEnvelope<'ai.start', AIStartRequest>
  | AgentRequestEnvelope<'ai.cancel', { requestId: string }>
  | AgentRequestEnvelope<'agent.shutdown', Record<string, never>>;

export type AgentResultByMethod = {
  'protocol.handshake': {
    protocolVersion: typeof AGENT_PROTOCOL_VERSION;
    minProtocolVersion: typeof AGENT_PROTOCOL_VERSION;
    agentVersion: string;
  };
  'workspace.open': WorkspaceInfo;
  'workspace.current': WorkspaceInfo | null;
  'workspace.tree': TreeNode | null;
  'file.read': FileContent;
  'file.applyEdit': { ok: boolean; error?: string };
  'search.query': SearchResult[];
  'git.overview': GitOverview;
  'git.fileHistory': CommitRecord[];
  'index.status': IndexStatus;
  'gen.get': GenResult;
  'gen.refresh': GenResult;
  'ai.start': { requestId: string } | { error: 'not-configured' };
  'ai.cancel': void;
  'agent.shutdown': void;
};

export type AgentResponse<Result = unknown> =
  { id: string; ok: true; result: Result } | { id: string; ok: false; error: AgentProtocolError };

export type AgentEvent =
  | { type: 'workspace.changed'; data: WorkspaceInfo | null }
  | { type: 'watcher.batch'; data: { events: WatcherEvent[] } }
  | { type: 'index.updated'; data: { changed: string[]; removed: string[] } }
  | { type: 'index.status'; data: IndexStatus }
  | { type: 'gen.staleChanged'; data: { items: GenKey[] } }
  | { type: 'ai.stream'; data: AIStreamEvent }
  | { type: 'agent.disconnected'; data: { message?: string } };

export type AgentWireMessage =
  | { kind: 'request'; request: AgentRequest }
  | { kind: 'response'; response: AgentResponse }
  | { kind: 'event'; event: AgentEvent };

export function protocolError(code: AgentErrorCode, message: string): AgentProtocolError {
  return { code, message };
}
