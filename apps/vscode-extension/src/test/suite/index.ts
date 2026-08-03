import { assertGreen, runSuites } from '../harness.js';

import { activationSuite } from './activation.js';
import { cancellationSuite } from './cancellation.js';
import { commandsSuite } from './commands.js';
import { configurationSuite } from './configuration.js';
import { errorStatesSuite } from './error-states.js';
import { navigationSuite } from './navigation.js';
import { secretsSuite } from './secrets.js';
import { treeViewsSuite } from './tree-views.js';
import { webviewSuite } from './webview.js';

// `--extensionTestsPath` entry for the trusted lane. Order is part of the contract: the suites
// share one window and one workspace, so each one runs against the state the previous ones left.
//
//   activation    — the only moment the extension is not yet active
//   error states  — the only moment the workspace is not yet initialized
//   commands      — initializes, indexes and analyzes (every later suite depends on this)
//   tree views    — projections over the indexed/analyzed/reviewed workspace
//   navigation    — reveals declarations from the architecture tree's own nodes
//   cancellation  — forks workers against the indexed workspace
//   configuration — mutates the privacy mode, so it runs after everything that reads it
//   secrets       — asserts the negative invariant across the final workspace state
//   webview       — last: opens panels and changes the active tab
const SUITES = [
  activationSuite,
  errorStatesSuite,
  commandsSuite,
  treeViewsSuite,
  navigationSuite,
  cancellationSuite,
  configurationSuite,
  secretsSuite,
  webviewSuite,
];

export const run = async (): Promise<void> => {
  assertGreen(await runSuites(SUITES));
};
