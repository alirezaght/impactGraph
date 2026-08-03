import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWorkerMessage } from './protocol.js';

import type { IndexSummary } from '../index-repository.js';
import type { WorkerIndexRequest } from './protocol.js';
import type { IndexProgress } from '@impactgraph/application';

// Parent-side client for the index worker (Story 2.6). fork() gives an IPC channel; the
// worker is a plain Node child process, so the extension host never runs indexing (PRD §33).

export type IndexRunOutcome =
  | { readonly kind: 'done'; readonly summary: IndexSummary }
  | { readonly kind: 'cancelled'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export interface IndexRunnerHandle {
  cancel(): void;
  readonly outcome: Promise<IndexRunOutcome>;
}

export interface StartIndexWorkerOptions {
  readonly onProgress?: (progress: IndexProgress) => void;
  /** Extra node exec args, e.g. ['--import', 'tsx'] when running from TypeScript sources. */
  readonly execArgv?: readonly string[];
  /** Override the worker entry file (e.g. a bundled dist/index-worker.cjs in the extension). */
  readonly entryPath?: string;
}

export const indexWorkerEntryPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), 'worker-entry.ts');

export const startIndexWorker = (
  request: WorkerIndexRequest,
  options: StartIndexWorkerOptions = {},
): IndexRunnerHandle => {
  const child = fork(options.entryPath ?? indexWorkerEntryPath(), [], {
    execArgv: [...(options.execArgv ?? [])],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });

  const outcome = new Promise<IndexRunOutcome>((resolve) => {
    let settled = false;
    const settle = (value: IndexRunOutcome): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    child.on('message', (raw: unknown) => {
      if (!isWorkerMessage(raw)) {
        return;
      }
      if (raw.type === 'progress') {
        options.onProgress?.(raw.progress);
      } else if (raw.type === 'done') {
        settle({ kind: 'done', summary: raw.summary });
      } else if (raw.type === 'cancelled') {
        settle({ kind: 'cancelled', message: raw.message });
      } else {
        settle({ kind: 'error', message: raw.message });
      }
    });
    child.on('error', (error) => {
      settle({ kind: 'error', message: error.message });
    });
    child.on('exit', (code) => {
      settle({ kind: 'error', message: `index worker exited unexpectedly (code ${String(code)})` });
    });
  });

  child.send({ protocol: 1, type: 'start', request });
  return {
    cancel: () => {
      if (child.connected) {
        child.send({ protocol: 1, type: 'cancel' });
      }
    },
    outcome,
  };
};
