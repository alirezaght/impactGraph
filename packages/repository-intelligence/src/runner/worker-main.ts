import { parseRepositorySnapshot } from '@impactgraph/domain';
import {
  createCustomDetectionAdapter,
  createExpressAdapter,
  createGenericDetectorsAdapter,
  createNestJsAdapter,
} from '@impactgraph/framework-adapters';
import {
  createAdapterRegistry,
  createPrismaAdapter,
  createTypeScriptAdapter,
} from '@impactgraph/language-adapters';
import { openSqliteIndexStore, readRulesConfig } from '@impactgraph/persistence';

import { indexRepository } from '../index-repository.js';

import { isParentMessage } from './protocol.js';

import type { WorkerIndexRequest, WorkerToParentMessage } from './protocol.js';

// Index worker entry (Story 2.6): runs the full pipeline outside the host process. The worker
// composes its own store and adapters; the parent only sends the request and (optionally) a
// cancel signal, and receives progress/done/cancelled/error messages.

// §Z8: repo-specific detection from committed configuration, alongside the built-ins.
const buildFrameworkAdapters = (rootDir: string) => {
  const rules = readRulesConfig(rootDir);
  return [
    createNestJsAdapter(),
    createExpressAdapter(),
    createGenericDetectorsAdapter(),
    createCustomDetectionAdapter(rules.ok ? (rules.value?.detections ?? []) : []),
  ];
};

let cancelRequested = false;

const send = (message: WorkerToParentMessage): void => {
  process.send?.(message);
};

const runIndex = async (request: WorkerIndexRequest): Promise<void> => {
  const snapshot = parseRepositorySnapshot(request.snapshot);
  if (!snapshot.ok) {
    send({ protocol: 1, type: 'error', message: 'invalid snapshot payload' });
    return;
  }
  const store = openSqliteIndexStore(request.dbPath);
  if (!store.ok) {
    send({ protocol: 1, type: 'error', message: store.error.message });
    return;
  }
  const registry = createAdapterRegistry([createTypeScriptAdapter(), createPrismaAdapter()]);
  if (!registry.ok) {
    send({ protocol: 1, type: 'error', message: 'adapter registry misconfigured' });
    return;
  }
  try {
    const result = await indexRepository(
      {
        rootDir: request.rootDir,
        snapshot: snapshot.value,
        analysisRunId: request.analysisRunId,
        createdAt: request.createdAt,
        ignoreGlobs: request.ignoreGlobs,
        disabledFrameworks: request.disabledFrameworks,
        incremental: request.incremental,
        cancellation: {
          get isCancellationRequested() {
            return cancelRequested;
          },
        },
        onProgress: (progress) => {
          send({ protocol: 1, type: 'progress', progress });
        },
      },
      {
        store: store.value,
        registry: registry.value,
        frameworkAdapters: buildFrameworkAdapters(request.rootDir),
      },
    );
    if (result.ok) {
      send({ protocol: 1, type: 'done', summary: result.value });
    } else if (result.error.name === 'OperationCancelled') {
      send({ protocol: 1, type: 'cancelled', message: result.error.message });
    } else {
      send({ protocol: 1, type: 'error', message: result.error.message });
    }
  } finally {
    await store.value.close();
  }
};

/** Attach the worker message loop — call once from a dedicated worker entry file. */
export const runIndexWorker = (): void => {
  process.on('message', (raw: unknown) => {
    if (!isParentMessage(raw)) {
      return;
    }
    if (raw.type === 'cancel') {
      cancelRequested = true;
      return;
    }
    runIndex(raw.request)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        send({ protocol: 1, type: 'error', message });
      })
      .finally(() => {
        process.disconnect();
      });
  });
};
