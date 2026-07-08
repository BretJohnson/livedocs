/**
 * Indexer worker-thread entry. The desktop app bundles this file as a
 * worker module; it opens its own SQLite connection (WAL mode allows the
 * main process to read concurrently) so indexing never blocks the UI.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { WorkspaceStore } from '@livedocs/store';
import { Indexer } from './indexer.js';

export interface IndexerWorkerData {
  dataDir: string;
  workspaceRoot: string;
}

export type IndexerWorkerRequest =
  { type: 'full-scan' } | { type: 'apply-changes'; changed: string[]; removed: string[] };

export type IndexerWorkerResponse =
  | { type: 'progress'; indexed: number }
  | { type: 'scan-complete'; total: number }
  | { type: 'batch-complete'; changed: string[]; removed: string[] }
  | { type: 'error'; message: string };

export function startIndexerWorker(): void {
  const port = parentPort;
  if (!port) throw new Error('indexer worker must run in a worker thread');
  const { dataDir, workspaceRoot } = workerData as IndexerWorkerData;
  const store = WorkspaceStore.open(dataDir, workspaceRoot);
  const indexer = new Indexer(store, workspaceRoot);

  let queue: Promise<void> = Promise.resolve();
  const post = (message: IndexerWorkerResponse): void => port.postMessage(message);

  port.on('message', (request: IndexerWorkerRequest) => {
    queue = queue.then(async () => {
      try {
        if (request.type === 'full-scan') {
          const total = await indexer.fullScan((p) =>
            post({ type: 'progress', indexed: p.indexed }),
          );
          post({ type: 'scan-complete', total });
        } else {
          const result = await indexer.applyChanges(request.changed, request.removed);
          post({ type: 'batch-complete', ...result });
        }
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  });
}
