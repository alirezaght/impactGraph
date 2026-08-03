import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readWorkspaceConfig } from '@impactgraph/persistence';
import * as vscode from 'vscode';

import { delay, dismissNotifications, fireCommand, waitFor } from './support.js';
import { ensureInitialized } from './workspace-setup.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §9 / §17 / §42.4 "configuration editing". The privacy mode is the one setting that is never
// changed silently, so the round-trip that matters is: command → QuickPick → .impactgraph/
// config.yml on disk → readWorkspaceConfig. The assertion is "the mode changed to another valid
// mode and survives a re-read", not "the mode is exactly X" — the QuickPick selection is driven
// through the workbench, and pinning the picked item would test VS Code's list widget, not us.

const PRIVACY_MODES = ['local-only', 'selected-snippets', 'full-context', 'external-agent'];

const currentMode = (root: string): string | undefined => {
  const config = readWorkspaceConfig(root);
  if (!config.ok) {
    throw new Error(`.impactgraph/config.yml is unreadable: ${config.error.message}`);
  }
  return config.value?.privacyMode;
};

const configText = (root: string): string =>
  readFileSync(join(root, '.impactgraph', 'config.yml'), 'utf8');

/**
 * There is no API to observe a QuickPick, so acceptance is retried until the config changes:
 * once the picker is up the accept lands, and before that it is a harmless no-op.
 */
const pickPrivacyMode = async (root: string, before: string | undefined): Promise<string> => {
  fireCommand('impactgraph.configurePrivacy');
  await waitFor(
    'the privacy-mode QuickPick selection to reach .impactgraph/config.yml',
    async () => {
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      await delay(250);
      return currentMode(root) !== before;
    },
    30_000,
  );
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await dismissNotifications();
  const after = currentMode(root);
  if (after === undefined) {
    throw new Error('privacy mode disappeared from the configuration');
  }
  return after;
};

export const configurationSuite: IntegrationSuite = {
  name: 'configuration editing (PRD §9, §17, §42.4)',
  tests: [
    {
      name: 'a privacy-mode change round-trips into .impactgraph/config.yml',
      run: async () => {
        const root = await ensureInitialized();
        const before = currentMode(root);
        const after = await pickPrivacyMode(root, before);
        assert.notEqual(after, before, 'the privacy mode did not change');
        assert.ok(
          PRIVACY_MODES.includes(after),
          `'${after}' is not one of the four PRD §9 privacy modes`,
        );
        assert.ok(
          configText(root).includes(after),
          'the new privacy mode is not present in the config.yml text — it was not persisted',
        );
        assert.equal(currentMode(root), after, 'the persisted mode does not survive a re-read');
      },
    },
    {
      name: 'the configuration file stays schema-valid after the edit',
      run: async () => {
        const root = await ensureInitialized();
        const config = readWorkspaceConfig(root);
        assert.ok(config.ok, 'config.yml failed schema validation after a privacy-mode change');
      },
    },
  ],
};
