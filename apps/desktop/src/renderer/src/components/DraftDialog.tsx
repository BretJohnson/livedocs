import { useState } from 'react';
import { api, useEvent } from '../api';
import { DiffView } from './DiffView';
import { ProvenanceLine } from './AIPanel';
import type { Provenance } from '../../../shared/ipc';

export interface DraftRequest {
  docPath: string;
  sectionText: string;
}

type Phase =
  | { step: 'input' }
  | { step: 'streaming'; requestId: string; text: string }
  | { step: 'review'; draft: string; provenance: Provenance }
  | { step: 'applying'; draft: string; provenance: Provenance }
  | { step: 'error'; message: string }
  | { step: 'not-configured' };

/**
 * Draft-update workflow: the user gives an instruction, the AI proposes a
 * revision of the authored section, and the change is shown as a diff. The
 * file is written only when the user explicitly accepts.
 */
export function DraftDialog({
  request,
  onClose,
  onOpenSettings,
}: {
  request: DraftRequest;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [phase, setPhase] = useState<Phase>({ step: 'input' });

  useEvent('ai:stream', (event) => {
    if (phase.step !== 'streaming' || event.requestId !== phase.requestId) return;
    switch (event.type) {
      case 'chunk':
        setPhase({ ...phase, text: phase.text + event.text });
        break;
      case 'done':
        setPhase({ step: 'review', draft: event.text.trim() + '\n', provenance: event.provenance });
        break;
      case 'error':
        setPhase({ step: 'error', message: event.message });
        break;
      case 'cancelled':
        setPhase({ step: 'input' });
        break;
    }
  });

  const start = async (): Promise<void> => {
    const result = await api.invoke('ai:start', {
      kind: 'draft',
      docPath: request.docPath,
      sectionText: request.sectionText,
      instruction,
    });
    if ('error' in result) {
      setPhase({ step: 'not-configured' });
    } else {
      setPhase({ step: 'streaming', requestId: result.requestId, text: '' });
    }
  };

  const accept = async (): Promise<void> => {
    if (phase.step !== 'review') return;
    setPhase({ step: 'applying', draft: phase.draft, provenance: phase.provenance });
    const result = await api.invoke('file:applyEdit', {
      path: request.docPath,
      oldText: request.sectionText,
      newText: phase.draft,
    });
    if (result.ok) {
      onClose();
    } else {
      setPhase({ step: 'error', message: result.error ?? 'Failed to apply the edit.' });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal draft-dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>Draft update — {request.docPath}</strong>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </header>

        {phase.step === 'input' && (
          <div className="draft-input">
            <p className="muted">Revising this authored section:</p>
            <pre className="section-preview">{request.sectionText}</pre>
            <textarea
              autoFocus
              placeholder="What should change? e.g. “Update this section to mention the new watcher behavior.”"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
            />
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={!instruction.trim()}
                onClick={() => void start()}
              >
                Draft revision
              </button>
            </div>
          </div>
        )}

        {phase.step === 'streaming' && (
          <div className="draft-streaming">
            <pre className="stream-text">{phase.text || 'Drafting…'}</pre>
            <div className="modal-actions">
              <button onClick={() => void api.invoke('ai:cancel', { requestId: phase.requestId })}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {(phase.step === 'review' || phase.step === 'applying') && (
          <div className="draft-review">
            <p className="muted">
              Review the proposed change. Your file is modified only if you accept.
            </p>
            <DiffView oldText={request.sectionText} newText={phase.draft} />
            <ProvenanceLine provenance={phase.provenance} />
            <div className="modal-actions">
              <button onClick={onClose} disabled={phase.step === 'applying'}>
                Discard
              </button>
              <button
                className="primary"
                onClick={() => void accept()}
                disabled={phase.step === 'applying'}
              >
                {phase.step === 'applying' ? 'Applying…' : 'Accept & apply'}
              </button>
            </div>
          </div>
        )}

        {phase.step === 'error' && (
          <div>
            <div className="generated-error">{phase.message}</div>
            <div className="modal-actions">
              <button onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {phase.step === 'not-configured' && (
          <div className="ai-setup">
            <p>No AI provider is configured. Configure one in Settings to draft updates.</p>
            <div className="modal-actions">
              <button onClick={onClose}>Close</button>
              <button className="primary" onClick={onOpenSettings}>
                Open Settings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
