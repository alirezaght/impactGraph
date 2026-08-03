import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { indexDatabasePath } from '@impactgraph/persistence';
import * as vscode from 'vscode';

import { startJob } from './engine-jobs.js';
import { startIndexRun } from './index-worker.js';
import { ensureIndexed, SPEC_FILE_NAME, SPEC_TEXT } from './workspace-setup.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §33/§34 / §42.4 "cancellation". Every long-running §19 command wires
// `token.onCancellationRequested(() => handle.cancel())` inside `withProgress`; there is no API
// to press the notification's cancel button from a test, so the suite drives a real
// `CancellationTokenSource` through exactly that wiring and measures the worker's response.

const CANCEL_BUDGET_MS = 500;

/** Cancel through a real token and report how long the worker took to acknowledge. */
const cancelThrough = async (handle: {
  readonly outcome: Promise<{ readonly kind: string }>;
  cancel: () => void;
}): Promise<{ readonly kind: string; readonly elapsedMs: number }> => {
  const source = new vscode.CancellationTokenSource();
  source.token.onCancellationRequested(() => {
    handle.cancel();
  });
  const started = performance.now();
  source.cancel();
  const outcome = await handle.outcome;
  return { kind: outcome.kind, elapsedMs: performance.now() - started };
};

export const cancellationSuite: IntegrationSuite = {
  name: 'cancellation (PRD §33, §34, §42.4)',
  tests: [
    {
      name: 'cancelling an engine job takes effect within 500 ms',
      run: async () => {
        const root = await ensureIndexed();
        const handle = startJob({
          op: 'analyze',
          rootDir: root,
          specName: SPEC_FILE_NAME,
          rawText: SPEC_TEXT,
        });
        const { kind, elapsedMs } = await cancelThrough(handle);
        process.stdout.write(`      engine job cancelled in ${elapsedMs.toFixed(1)} ms\n`);
        assert.equal(kind, 'cancelled', `the engine job ended as '${kind}', not cancelled`);
        assert.ok(
          elapsedMs < CANCEL_BUDGET_MS,
          `cancellation took ${elapsedMs.toFixed(1)} ms, budget is ${String(CANCEL_BUDGET_MS)} ms`,
        );
      },
    },
    {
      name: 'cancelling an index run is cooperative, bounded and non-destructive',
      run: async () => {
        const root = await ensureIndexed();
        const dbPath = indexDatabasePath(root);
        const handle = await startIndexRun(root, `snap-cancel-${Date.now().toString(36)}`);
        const { kind, elapsedMs } = await cancelThrough(handle);
        process.stdout.write(
          `      index run ended as '${kind}' after ${elapsedMs.toFixed(1)} ms\n`,
        );
        // Index cancellation is cooperative (a protocol message the worker checks between
        // files), so a fixture this small may legitimately finish first — but it must never
        // error, and when it does cancel it must do so inside the budget.
        assert.ok(
          kind === 'cancelled' || kind === 'done',
          `the index run ended as '${kind}' — cancellation must never surface as an error`,
        );
        if (kind === 'cancelled') {
          assert.ok(
            elapsedMs < CANCEL_BUDGET_MS,
            `cancellation took ${elapsedMs.toFixed(1)} ms, budget is ${String(CANCEL_BUDGET_MS)} ms`,
          );
        }
        // PRD §34: a cancelled index never destroys the previous valid one.
        assert.ok(existsSync(dbPath), 'the previous index was destroyed by a cancelled run');
      },
    },
  ],
};
