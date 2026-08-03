import { fork } from 'node:child_process';

import type { EngineJobRequest, EngineJobResponse, EngineJobSpec } from './protocol.js';
import type { EngineFailure } from '@impactgraph/workspace-engine';

// One child process per job (Story 7.2): the host stays responsive, cancellation is a kill
// (all engine writes are transactional/atomic), and a crashed job never takes the host down.

export type EngineJobOutcome =
  | { readonly kind: 'done'; readonly value: unknown }
  | { readonly kind: 'failed'; readonly error: EngineFailure }
  | { readonly kind: 'cancelled' };

export interface EngineJobHandle {
  readonly outcome: Promise<EngineJobOutcome>;
  cancel(): void;
}

let nextJobId = 1;

export const startEngineJob = (entryPath: string, request: EngineJobSpec): EngineJobHandle => {
  const id = nextJobId;
  nextJobId += 1;
  const child = fork(entryPath, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let cancelled = false;
  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2000);
  });

  const outcome = new Promise<EngineJobOutcome>((resolve) => {
    child.on('message', (message: unknown) => {
      const response = message as EngineJobResponse;
      if (response.id !== id) {
        return;
      }
      child.kill();
      resolve(
        response.ok
          ? { kind: 'done', value: response.value }
          : { kind: 'failed', error: response.error },
      );
    });
    child.on('error', (error) => {
      resolve({ kind: 'failed', error: { category: 'internalError', message: error.message } });
    });
    child.on('exit', (code) => {
      if (cancelled) {
        resolve({ kind: 'cancelled' });
        return;
      }
      if (code !== 0 && code !== null) {
        resolve({
          kind: 'failed',
          error: {
            category: 'internalError',
            message: `engine worker exited with code ${String(code)}${stderrTail.length > 0 ? ` — ${stderrTail.trim().slice(-300)}` : ''}`,
          },
        });
      }
    });
  });

  child.send({ ...request, id } satisfies EngineJobRequest);

  return {
    outcome,
    cancel: (): void => {
      cancelled = true;
      child.kill();
    },
  };
};
