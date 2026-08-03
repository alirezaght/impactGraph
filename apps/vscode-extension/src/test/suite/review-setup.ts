import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { dismissNotifications, fireCommand, waitFor } from './support.js';
import { ensureApproved } from './workspace-setup.js';

// `Review Working Tree` needs (a) an approved baseline and (b) an actual diff. The fixture is
// committed clean by the runner, so the suite introduces the change itself.

const EDITED_FILE = join('src', 'services', 'deal-service.ts');

let reviewed = false;

/**
 * The review command ends by AWAITING a notification with an "Open Review Report" action, so it
 * is fired rather than awaited. `Open Review Report` reads the review tree's current report —
 * which the command sets *before* that notification — so a report document appearing is proof
 * the wired-up provider received the review, not just that the engine ran.
 */
export const openReviewReport = async (): Promise<vscode.TextDocument> => {
  const root = await ensureApproved();
  if (!reviewed) {
    appendFileSync(
      join(root, EDITED_FILE),
      '\n// integration-test edit: gives Review Working Tree a diff to classify\n',
    );
    fireCommand('impactgraph.reviewWorkingTree');
    reviewed = true;
  }
  let document: vscode.TextDocument | undefined;
  await waitFor('Open Review Report to produce a review document', async () => {
    await vscode.commands.executeCommand('impactgraph.openReviewReport');
    const active = vscode.window.activeTextEditor?.document;
    // The generated report is an untitled markdown buffer; the spec file is a markdown *file*.
    if (active?.languageId === 'markdown' && active.isUntitled) {
      document = active;
      return true;
    }
    return false;
  });
  await dismissNotifications();
  if (document === undefined) {
    throw new Error('no review report document was produced');
  }
  return document;
};
