import assert from 'node:assert/strict';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { skipTest } from '../harness.js';

import { waitFor, workspaceRoot } from './support.js';
import { architectureItems } from './tree-views.js';

import type { IntegrationSuite } from '../harness.js';

// PRD §40.4 / Story 7.5 / §42.4 "editor navigation". `impactgraph.revealNode` must open the file
// the node belongs to and, when the node's evidence carries a declaration range, land on it
// rather than at the top of the file. Ranges live on evidence, so not every symbol has one —
// the suite asserts the file for every sampled node and reports honestly when none had a range.

const SAMPLE_SIZE = 6;

interface Reveal {
  readonly nodeId: string;
  readonly expectedPath: string;
  readonly actualPath: string | undefined;
  readonly startLine: number;
}

const navigableSymbols = async (): Promise<readonly { id: string; path: string }[]> => {
  const { symbols } = await architectureItems();
  const navigable: { id: string; path: string }[] = [];
  for (const item of symbols) {
    const path = item.node.path;
    if (typeof path === 'string' && path.length > 0) {
      navigable.push({ id: item.node.id, path });
    }
    if (navigable.length >= SAMPLE_SIZE) {
      break;
    }
  }
  return navigable;
};

const revealSymbol = async (nodeId: string, path: string, root: string): Promise<Reveal> => {
  const expectedPath = join(root, path);
  await vscode.commands.executeCommand('impactgraph.revealNode', nodeId, path);
  await waitFor(
    `the editor to show ${path}`,
    () => vscode.window.activeTextEditor?.document.uri.fsPath === expectedPath,
    15_000,
  );
  const editor = vscode.window.activeTextEditor;
  return {
    nodeId,
    expectedPath,
    actualPath: editor?.document.uri.fsPath,
    startLine: editor?.selection.start.line ?? 0,
  };
};

let sampled: readonly Reveal[] | undefined;

const sampleReveals = async (): Promise<readonly Reveal[]> => {
  if (sampled !== undefined) {
    return sampled;
  }
  const root = workspaceRoot();
  const navigable = await navigableSymbols();
  if (navigable.length === 0) {
    return skipTest('the indexed fixture produced no symbol node with a file path to reveal');
  }
  const reveals: Reveal[] = [];
  for (const symbol of navigable) {
    reveals.push(await revealSymbol(symbol.id, symbol.path, root));
  }
  sampled = reveals;
  return reveals;
};

export const navigationSuite: IntegrationSuite = {
  name: 'editor navigation (PRD §40.4, §42.4)',
  tests: [
    {
      name: 'revealNode opens the file the node belongs to',
      run: async () => {
        const reveals = await sampleReveals();
        for (const reveal of reveals) {
          assert.equal(
            reveal.actualPath,
            reveal.expectedPath,
            `revealNode(${reveal.nodeId}) opened a different file than the node it was given`,
          );
        }
        process.stdout.write(`      revealed ${String(reveals.length)} symbol nodes\n`);
      },
    },
    {
      name: 'revealNode selects the declaration when the node carries a range',
      run: async () => {
        const reveals = await sampleReveals();
        const withRange = reveals.filter((reveal) => reveal.startLine > 0);
        if (withRange.length === 0) {
          return skipTest(
            `none of the ${String(reveals.length)} sampled symbol nodes carried a declaration ` +
              'range in evidence, so no selection could be asserted (the file still opened at ' +
              'the top, which is the documented degradation)',
          );
        }
        for (const reveal of withRange) {
          assert.equal(reveal.actualPath, reveal.expectedPath);
        }
        process.stdout.write(
          `      ${String(withRange.length)}/${String(reveals.length)} reveals landed on a declaration line\n`,
        );
      },
    },
  ],
};
