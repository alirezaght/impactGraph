import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { indexDatabasePath } from '@impactgraph/persistence';

import { skipTest } from '../harness.js';

import { activateExtension, requireExtension, workspaceRoot } from './support.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §33 / Story 7.1. This suite MUST run first: it is the only point at which the extension
// has not been activated and the workspace has not been initialized, so it is the only point at
// which "activation is fast" and "activation does not index" can be observed at all.

const ACTIVATION_BUDGET_MS = 500;

export const activationSuite: IntegrationSuite = {
  name: 'activation (PRD §33, §42.4)',
  tests: [
    {
      name: 'activates within the 500 ms budget',
      run: async () => {
        const { elapsedMs } = await activateExtension();
        if (elapsedMs === undefined) {
          return skipTest(
            'the extension was already active when the suite started — activation time is not ' +
              'measurable in this window; the budget is only meaningful on a cold activate()',
          );
        }
        process.stdout.write(`      measured activation: ${elapsedMs.toFixed(1)} ms\n`);
        assert.ok(
          elapsedMs < ACTIVATION_BUDGET_MS,
          `activation took ${elapsedMs.toFixed(1)} ms, budget is ${String(ACTIVATION_BUDGET_MS)} ms (PRD §33)`,
        );
      },
    },
    {
      name: 'reports itself active afterwards',
      run: async () => {
        await activateExtension();
        assert.equal(requireExtension().isActive, true);
      },
    },
    {
      name: 'does not index, scaffold or open a database during activation',
      run: async () => {
        await activateExtension();
        const root = workspaceRoot();
        assert.equal(
          existsSync(join(root, '.impactgraph')),
          false,
          'activate() created .impactgraph — activation must stay lazy (PRD §33)',
        );
        assert.equal(
          existsSync(indexDatabasePath(root)),
          false,
          'activate() opened/created the SQLite index — indexing never runs in the extension host',
        );
      },
    },
  ],
};
