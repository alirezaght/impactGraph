import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { activateExtension, dismissNotifications, workspaceRoot } from './support.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §34 / §42.4 "error states". Runs BEFORE the commands suite, while the workspace is still
// uninitialized — the state a user is in the very first time they hit a command. The contract is
// that every one of these degrades to an actionable message: the command must resolve, must not
// reject, and must not leave half-built state behind. We assert on that observable behavior, not
// on the message text (locale-fragile).

/**
 * Commands that must survive an uninitialized workspace without a prompt. Deliberately excludes
 * commands whose first step is a QuickPick/InputBox with data present — those cannot resolve
 * headlessly and are covered where their preconditions are met.
 */
const SAFE_ON_UNINITIALIZED: readonly string[] = [
  'impactgraph.showIndexStatus',
  'impactgraph.openReviewReport',
  'impactgraph.approveImpactAnalysis',
  'impactgraph.openAiAuditLog',
  'impactgraph.openConfigurationHistory',
  'impactgraph.restoreConfigurationVersion',
  'impactgraph.refreshIssues',
  'impactgraph.clearImpactFilters',
  'impactgraph.filterImpacts',
  'impactgraph.acceptImpact',
  'impactgraph.rejectImpact',
];

const uninitializedTest = (commandId: string) => ({
  name: `${commandId} degrades gracefully on an uninitialized workspace`,
  run: async (): Promise<void> => {
    await activateExtension();
    await vscode.commands.executeCommand(commandId);
    await dismissNotifications();
  },
});

export const errorStatesSuite: IntegrationSuite = {
  name: 'error states — uninitialized workspace (PRD §34, §42.4)',
  tests: [
    ...SAFE_ON_UNINITIALIZED.map(uninitializedTest),
    {
      name: 'revealNode on an unknown node id does not throw',
      run: async () => {
        await activateExtension();
        await vscode.commands.executeCommand(
          'impactgraph.revealNode',
          'node-that-does-not-exist',
          'src/index.ts',
        );
      },
    },
    {
      name: 'no command scaffolded the workspace as a side effect of failing',
      run: () => {
        // Scoped to the scaffold marker on purpose: `.impactgraph/` itself is covered by the
        // activation suite, which owns the "activation writes nothing" assertion.
        const root = workspaceRoot();
        assert.equal(
          existsSync(join(root, '.impactgraph', 'config.yml')),
          false,
          'a command failing on an uninitialized workspace scaffolded the workspace anyway — ' +
            'failure paths must not write (PRD §34); only Initialize Workspace may scaffold',
        );
      },
    },
  ],
};
