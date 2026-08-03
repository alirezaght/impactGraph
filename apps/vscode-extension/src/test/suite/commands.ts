import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { indexDatabasePath, openSqliteIndexStore } from '@impactgraph/persistence';
import { listAnalyses } from '@impactgraph/workspace-engine';
import * as vscode from 'vscode';

import { contributedCommandIds } from './manifest.js';
import { activateExtension } from './support.js';
import { ensureAnalyzed, ensureIndexed, ensureInitialized } from './workspace-setup.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §19 / §42.4 "commands". The drift check is the permanent one: a command registered in code
// but missing from `contributes.commands` is invisible in the palette, and a manifest entry with
// no registration is a palette item that does nothing. Both have shipped in real extensions.

const PREFIX = 'impactgraph.';

const registeredIds = async (): Promise<readonly string[]> => {
  const { registeredOnActivation } = await activateExtension();
  const fromActivation = registeredOnActivation.filter((id) => id.startsWith(PREFIX));
  if (fromActivation.length > 0) {
    return fromActivation.toSorted((a, b) => a.localeCompare(b));
  }
  // Fallback: the extension was already active, so the activation diff is empty. The registry
  // snapshot is weaker (it can also contain manifest-only entries) but still catches a missing
  // registration, so the check degrades instead of disappearing.
  process.stdout.write(
    '      note: activation diff was empty — falling back to the full command registry\n',
  );
  const all = await vscode.commands.getCommands(true);
  return all.filter((id) => id.startsWith(PREFIX)).toSorted((a, b) => a.localeCompare(b));
};

const currentSnapshotId = async (root: string): Promise<string | undefined> => {
  const store = openSqliteIndexStore(indexDatabasePath(root));
  if (!store.ok) {
    throw new Error(`could not open the index store: ${store.error.message}`);
  }
  try {
    const current = await store.value.getCurrentSnapshotId();
    return current.ok ? current.value : undefined;
  } finally {
    await store.value.close();
  }
};

export const commandsSuite: IntegrationSuite = {
  name: 'commands (PRD §19, §42.4)',
  tests: [
    {
      name: 'every contributed command is actually registered',
      run: async () => {
        const manifest = contributedCommandIds();
        assert.ok(manifest.length > 0, 'the manifest contributes no commands');
        const registered = new Set(await registeredIds());
        const missing = manifest.filter((id) => !registered.has(id));
        assert.deepEqual(
          missing,
          [],
          'contributed in package.json but never registered in code (dead palette entries)',
        );
      },
    },
    {
      name: 'every registered command is contributed in the manifest',
      run: async () => {
        const manifest = new Set(contributedCommandIds());
        const undeclared = (await registeredIds()).filter((id) => !manifest.has(id));
        assert.deepEqual(
          undeclared,
          [],
          'registered in code but missing from contributes.commands (unreachable from the palette)',
        );
      },
    },
    {
      name: 'initializeWorkspace scaffolds .impactgraph/config.yml',
      run: async () => {
        const root = await ensureInitialized();
        assert.ok(existsSync(join(root, '.impactgraph', 'config.yml')));
      },
    },
    {
      name: 'reindexWorkspace produces an index with a current snapshot',
      run: async () => {
        const root = await ensureIndexed();
        assert.ok(existsSync(indexDatabasePath(root)), 'no SQLite index after Reindex Workspace');
        const snapshot = await currentSnapshotId(root);
        assert.ok(
          snapshot !== undefined && snapshot.length > 0,
          'the index has no current snapshot after a successful reindex',
        );
      },
    },
    {
      name: 'analyzeSpecification records an analysis artifact',
      run: async () => {
        const root = await ensureAnalyzed();
        const analyses = await listAnalyses(root);
        if (!analyses.ok) {
          throw new Error(
            `listAnalyses failed after Analyze Specification: ${analyses.error.message}`,
          );
        }
        assert.ok(
          analyses.value.length > 0,
          'Analyze Specification completed but recorded no analysis',
        );
      },
    },
  ],
};
