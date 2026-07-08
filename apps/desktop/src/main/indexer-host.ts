import { Worker } from 'node:worker_threads';
import type {
  IndexerWorkerData,
  IndexerWorkerRequest,
  IndexerWorkerResponse,
} from '@livedocs/analysis';
import indexerWorkerPath from './workers/indexer?modulePath';

export interface IndexerHostCallbacks {
  onProgress?(indexed: number): void;
  onScanComplete?(total: number): void;
  onBatchComplete?(changed: string[], removed: string[]): void;
  onError?(message: string): void;
}

/**
 * Hosts the source indexer in a worker thread so scanning and extraction
 * never block the main process (document reading stays responsive).
 */
export class IndexerHost {
  private readonly worker: Worker;

  constructor(data: IndexerWorkerData, callbacks: IndexerHostCallbacks) {
    this.worker = new Worker(indexerWorkerPath, { workerData: data });
    this.worker.on('message', (message: IndexerWorkerResponse) => {
      switch (message.type) {
        case 'progress':
          callbacks.onProgress?.(message.indexed);
          break;
        case 'scan-complete':
          callbacks.onScanComplete?.(message.total);
          break;
        case 'batch-complete':
          callbacks.onBatchComplete?.(message.changed, message.removed);
          break;
        case 'error':
          callbacks.onError?.(message.message);
          break;
      }
    });
    this.worker.on('error', (err) => callbacks.onError?.(err.message));
  }

  private send(request: IndexerWorkerRequest): void {
    this.worker.postMessage(request);
  }

  fullScan(): void {
    this.send({ type: 'full-scan' });
  }

  applyChanges(changed: string[], removed: string[]): void {
    this.send({ type: 'apply-changes', changed, removed });
  }

  async dispose(): Promise<void> {
    await this.worker.terminate();
  }
}
