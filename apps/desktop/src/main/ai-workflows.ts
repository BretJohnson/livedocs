import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sha256, type AIService } from '@livedocs/ai';
import type { AIStartRequest } from '../shared/ipc';
import { broadcast } from './ipc';
import { buildAIService } from './ai-config';
import { getAppStore, requireSession, type Session } from './session';

const controllers = new Map<string, AbortController>();

interface PromptSpec {
  system: string;
  prompt: string;
  inputDigest: string;
}

async function readWorkspaceFile(session: Session, relPath: string): Promise<string> {
  const absolute = path.join(session.info.path, relPath);
  if (path.relative(session.info.path, absolute).startsWith('..')) {
    throw new Error('Path escapes the workspace');
  }
  return fs.readFile(absolute, 'utf8');
}

async function buildPrompt(session: Session, request: AIStartRequest): Promise<PromptSpec> {
  switch (request.kind) {
    case 'explain': {
      let context = '';
      try {
        context = (await readWorkspaceFile(session, request.docPath)).slice(0, 12_000);
      } catch {
        // Selection alone still works.
      }
      return {
        system:
          'You explain documentation and source code to developers. Be concrete and concise; ' +
          'explain what the selected content does or means in its surrounding context. Use Markdown.',
        prompt:
          `File: ${request.docPath}\n\n` +
          `Selected content:\n\n${request.selection}\n\n` +
          (context ? `Surrounding file content for context:\n\n${context}` : ''),
        inputDigest: sha256(request.selection),
      };
    }
    case 'summarize-doc': {
      const content = await readWorkspaceFile(session, request.docPath);
      return {
        system:
          'Summarize the given document for a developer deciding whether to read it. ' +
          '3-6 sentences, then a short bullet list of key points. Use Markdown.',
        prompt: `Document ${request.docPath}:\n\n${content.slice(0, 40_000)}`,
        inputDigest: sha256(content),
      };
    }
    case 'summarize-changes': {
      const commits = await session.git.recentCommits(15);
      const diff = await session.git.recentDiff(5);
      const commitList = commits
        .map((c) => `${c.hash.slice(0, 8)} ${c.date} ${c.author}: ${c.message}`)
        .join('\n');
      return {
        system:
          'Summarize recent repository changes for a developer returning to the project. ' +
          'Group related changes; call out anything risky or structural. Use Markdown.',
        prompt: `Recent commits:\n${commitList}\n\nDiff of the last commits:\n\n${diff}`,
        inputDigest: sha256(commitList + diff),
      };
    }
    case 'draft': {
      return {
        system:
          'You revise Markdown documentation sections. Return ONLY the revised Markdown for the ' +
          'section — no preamble, no code fences around the whole answer, no commentary. Preserve ' +
          'the heading level and any generated-section directives verbatim.',
        prompt:
          `Revise this Markdown section from ${request.docPath}.\n\n` +
          `Instruction: ${request.instruction}\n\n` +
          `Current section:\n\n${request.sectionText}`,
        inputDigest: sha256(request.sectionText + request.instruction),
      };
    }
  }
}

/**
 * Start a streamed AI workflow. Chunks/done/error are pushed on 'ai:stream';
 * returns the request id used for cancellation.
 */
export function startAIRequest(
  request: AIStartRequest,
): { requestId: string } | { error: 'not-configured' } {
  const session = requireSession();
  const service: AIService | null = buildAIService(getAppStore(), session.store);
  if (!service) return { error: 'not-configured' };

  const requestId = randomUUID();
  const controller = new AbortController();
  controllers.set(requestId, controller);

  void (async () => {
    try {
      const spec = await buildPrompt(session, request);
      const result = await service.stream({
        system: spec.system,
        prompt: spec.prompt,
        inputDigest: spec.inputDigest,
        signal: controller.signal,
        onChunk: (text) => broadcast('ai:stream', { requestId, type: 'chunk', text }),
      });
      broadcast('ai:stream', {
        requestId,
        type: 'done',
        text: result.text,
        provenance: {
          generator: `workflow:${request.kind}`,
          kind: 'ai',
          model: result.provenance.model,
          timestamp: result.provenance.timestamp,
          inputDigest: result.provenance.inputDigest,
          cacheHit: result.provenance.cacheHit,
        },
      });
    } catch (err) {
      if (controller.signal.aborted) {
        broadcast('ai:stream', { requestId, type: 'cancelled' });
      } else {
        broadcast('ai:stream', {
          requestId,
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      controllers.delete(requestId);
    }
  })();

  return { requestId };
}

export function cancelAIRequest(requestId: string): void {
  controllers.get(requestId)?.abort();
}
