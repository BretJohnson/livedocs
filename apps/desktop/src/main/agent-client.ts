import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  AGENT_PROTOCOL_VERSION,
  isProtocolVersionCompatible,
  protocolError,
  serializeWorkspaceReference,
  type AgentEvent,
  type AgentRequest,
  type AgentResponse,
  type AgentResultByMethod,
  type AgentWireMessage,
  type ProtocolVersionRange,
  type WslWorkspaceReference,
} from '@livedocs/store';

export interface WslAgentClientOptions {
  reference: WslWorkspaceReference;
  command?: string;
  onEvent?: (event: AgentEvent) => void;
  onExit?: (message: string) => void;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const STDERR_TAIL_LIMIT = 4_000;
const WSL_AGENT_SHELL_SCRIPT = [
  'AGENT="${XDG_DATA_HOME:-$HOME/.local/share}/livedocs/bin/livedocs-wsl-agent";',
  'if [ -x "$AGENT" ]; then',
  'exec "$AGENT" "$@";',
  'fi;',
  'echo "livedocs-wsl-agent was not found at $AGENT. Run pnpm build && pnpm --filter @livedocs/desktop install:wsl-launcher inside the WSL checkout, or set LIVEDOCS_WSL_AGENT_COMMAND." >&2;',
  'exit 127',
].join(' ');

export function defaultWslAgentArgs(distro: string, serializedWorkspace: string): string[] {
  return [
    '-d',
    distro,
    // Bypass the distro's default shell so profile output cannot corrupt the NDJSON stream.
    '--exec',
    'sh',
    '-c',
    WSL_AGENT_SHELL_SCRIPT,
    'livedocs-wsl-agent',
    '--workspace',
    serializedWorkspace,
  ];
}

export function formatWslAgentExitMessage(
  detail: string,
  exitCode: number | null,
  stderr: string,
): string {
  const output = stderr.trim().replace(/\s+/g, ' ');
  const missingAgent = output.match(
    /^livedocs-wsl-agent was not found at (\/\S+?)(?:\. Run |$)/,
  );
  if (exitCode === 127 && missingAgent) {
    return [
      'The LiveDocs WSL agent is not installed.',
      'In WSL, open the LiveDocs checkout and run:',
      'pnpm build',
      'pnpm --filter @livedocs/desktop install:wsl-launcher',
      `Agent path checked: ${missingAgent[1]}`,
      'Linux Node.js must be installed in WSL.',
    ].join('\n');
  }

  let message = `WSL agent stopped (${detail})`;
  if (output) message += `: ${output}`;
  if (exitCode === 127) {
    message += '\nMake sure Linux Node.js and the LiveDocs WSL agent are installed.';
  }
  return message;
}

export class WslAgentClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stoppingChild: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private stderrTail = '';
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly options: WslAgentClientOptions) {}

  async connect(): Promise<void> {
    if (this.child) return;
    const child = this.spawnAgent();
    this.child = child;
    this.stderrTail = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-STDERR_TAIL_LIMIT);
      if (process.env.LIVEDOCS_DEBUG) console.error(`[wsl-agent] ${chunk.trimEnd()}`);
    });
    child.on('error', (err) => this.failAll(err));
    child.on('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      const message = formatWslAgentExitMessage(detail, code, this.stderrTail);
      if (this.child === child) this.child = null;
      this.failAll(new Error(message));
      if (this.stoppingChild === child) {
        this.stoppingChild = null;
        return;
      }
      this.options.onExit?.(message);
    });

    try {
      const hello = await this.request('protocol.handshake', {
        clientProtocolVersion: AGENT_PROTOCOL_VERSION,
        minProtocolVersion: AGENT_PROTOCOL_VERSION,
      });
      const local: ProtocolVersionRange = {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        minProtocolVersion: AGENT_PROTOCOL_VERSION,
      };
      if (!isProtocolVersionCompatible(local, hello)) {
        const error = protocolError(
          'incompatible-protocol',
          `LiveDocs protocol ${AGENT_PROTOCOL_VERSION} is not compatible with agent protocol ${hello.protocolVersion}.`,
        );
        throw Object.assign(new Error(error.message), { code: error.code });
      }
    } catch (err) {
      this.stopChild(err);
      throw err;
    }
  }

  async request<M extends AgentRequest['method']>(
    method: M,
    params: Extract<AgentRequest, { method: M }>['params'],
  ): Promise<AgentResultByMethod[M]> {
    await this.ensureChild();
    const id = randomUUID();
    const request = {
      id,
      version: AGENT_PROTOCOL_VERSION,
      method,
      params,
    } as Extract<AgentRequest, { method: M }>;
    const result = new Promise<AgentResultByMethod[M]>((resolve, reject) => {
      const timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(
                Object.assign(
                  new Error(`WSL agent request timed out after ${timeoutMs}ms: ${method}`),
                  { code: 'workspace-error' },
                ),
              );
            }, timeoutMs)
          : null;
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    });
    try {
      this.write({ kind: 'request', request });
    } catch (err) {
      const pending = this.pending.get(id);
      if (pending?.timer) clearTimeout(pending.timer);
      this.pending.delete(id);
      throw err;
    }
    return result;
  }

  async dispose(): Promise<void> {
    if (!this.child) return;
    try {
      await Promise.race([this.request('agent.shutdown', {}), delay(1_000)]);
    } catch {
      // Process may already be gone.
    }
    this.stopChild(new Error('WSL agent disposed'));
  }

  private async ensureChild(): Promise<void> {
    if (!this.child) await this.connect();
  }

  private spawnAgent(): ChildProcessWithoutNullStreams {
    const serialized = serializeWorkspaceReference(this.options.reference);
    const override = this.options.command ?? process.env.LIVEDOCS_WSL_AGENT_COMMAND;
    if (override) {
      const overrideArgs = process.env.LIVEDOCS_WSL_AGENT_ARGS
        ? (JSON.parse(process.env.LIVEDOCS_WSL_AGENT_ARGS) as string[])
        : [];
      return spawn(override, [...overrideArgs, '--workspace', serialized], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    if (process.platform !== 'win32') {
      throw new Error(
        'Opening a WSL workspace requires Windows or LIVEDOCS_WSL_AGENT_COMMAND for development.',
      );
    }
    return spawn('wsl.exe', defaultWslAgentArgs(this.options.reference.distro, serialized), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  private write(message: AgentWireMessage): void {
    if (!this.child) throw new Error('WSL agent is not running');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let message: AgentWireMessage;
    try {
      message = JSON.parse(line) as AgentWireMessage;
    } catch {
      return;
    }
    if (message.kind === 'response') {
      this.onResponse(message.response);
    } else if (message.kind === 'event') {
      this.options.onEvent?.(message.event);
    }
  }

  private onResponse(response: AgentResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(
        Object.assign(new Error(response.error.message), { code: response.error.code }),
      );
    }
  }

  private failAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private stopChild(reason: unknown): void {
    const child = this.child;
    if (!child) {
      this.failAll(reason);
      return;
    }
    this.stoppingChild = child;
    this.child = null;
    this.failAll(reason);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    if (!child.killed) child.kill();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
