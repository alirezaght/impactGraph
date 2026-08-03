import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { indexDatabasePath } from '@impactgraph/persistence';
import * as vscode from 'vscode';

import { assertGreen, runSuites, skipTest } from '../harness.js';

import {
  activateExtension,
  dismissNotifications,
  requireExtension,
  workspaceRoot,
} from './support.js';

import type { IntegrationSuite } from '../harness.js';

// `--extensionTestsPath` entry for the untrusted lane (PRD §35). This launch deliberately omits
// --disable-workspace-trust, so VS Code opens the fixture in restricted mode. The manifest
// declares `untrustedWorkspaces.supported: "limited"`, so the extension still activates — but
// every mutating command must refuse, without writing anything.
//
// Self-protecting: if VS Code decides to trust the workspace anyway, the suite skips loudly
// rather than passing vacuously.

const requireUntrusted = (): void => {
  if (vscode.workspace.isTrusted) {
    skipTest(
      'VS Code trusted the test workspace on startup, so restricted-mode behavior was not ' +
        'exercised in this lane (the assertions below only mean anything while untrusted)',
    );
  }
};

/** Drive both mutating commands once; every assertion below observes the same aftermath. */
const runMutatingCommands = async (): Promise<string> => {
  await activateExtension();
  const root = workspaceRoot();
  await vscode.commands.executeCommand('impactgraph.initializeWorkspace');
  await vscode.commands.executeCommand('impactgraph.reindexWorkspace');
  await dismissNotifications();
  return root;
};

const untrustedSuite: IntegrationSuite = {
  name: 'untrusted workspace (PRD §35, §42.4 error states)',
  tests: [
    {
      name: 'the workspace really is untrusted in this lane',
      run: () => {
        requireUntrusted();
        assert.equal(vscode.workspace.isTrusted, false);
      },
    },
    {
      name: 'the extension still activates in restricted mode',
      run: async () => {
        requireUntrusted();
        await activateExtension();
        assert.equal(requireExtension().isActive, true);
      },
    },
    {
      name: 'initializeWorkspace and reindexWorkspace refuse to scaffold or index',
      run: async () => {
        requireUntrusted();
        const root = await runMutatingCommands();
        assert.equal(
          existsSync(join(root, '.impactgraph', 'config.yml')),
          false,
          'Initialize Workspace scaffolded an untrusted workspace (§35)',
        );
        assert.equal(
          existsSync(indexDatabasePath(root)),
          false,
          'Reindex Workspace indexed an untrusted workspace (§35)',
        );
      },
    },
    {
      // Separate from the command assertions on purpose: this one fails when *activation*
      // writes, which is a different defect from a command failing to honour trust.
      name: 'nothing at all is written into an untrusted workspace',
      run: async () => {
        requireUntrusted();
        const root = await runMutatingCommands();
        assert.equal(
          existsSync(join(root, '.impactgraph')),
          false,
          'an untrusted workspace received a .impactgraph/ directory — ImpactGraph never ' +
            'modifies a repository it has not been trusted with (§35)',
        );
      },
    },
  ],
};

export const run = async (): Promise<void> => {
  assertGreen(await runSuites([untrustedSuite]));
};
