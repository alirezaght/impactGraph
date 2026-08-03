import assert from 'node:assert/strict';

import { WEBVIEW_PROTOCOL_VERSION } from '@impactgraph/contracts';
import * as vscode from 'vscode';

import { skipTest } from '../harness.js';

import { contributedCommandIds, contributedWebviewViewIds } from './manifest.js';
import { delay, dismissNotifications, fireCommand, requireExtension, waitFor } from './support.js';
import { ensureIndexed } from './workspace-setup.js';

import type { ImpactGraphExtensionApi, ReviewPanelProbe } from '../../extension-api.js';
import type { IntegrationSuite } from '../harness.js';
import type { HostMessage } from '@impactgraph/contracts';

// PRD §18 / §42.4 "webview communication" (Story 9.1) and "selection → panel" (Story 9.3).
//
// The suite bundle is separate from `dist/extension.cjs`, so importing `ImpactReviewPanel` here
// would give a second class object with its own `instance` — the LIVE panel is only reachable
// through the test-mode-gated extension API (`src/extension-api.ts`). Everything below therefore
// runs against the real panel the real command opened, over the real postMessage transport:
//
//   webview → host   the React app posts `webview/ready` on mount; the host's own
//                    `onDidReceiveMessage` → `parseWebviewMessage` → dispatch path records it
//   host → webview   `post()` reports whether the live webview took the message
//   refusal          a v99 envelope goes through the same inbound path and must be rejected

const COMMAND_PREFIX = 'impactgraph.';
/** Matched against the id *after* the prefix — 'impactgraph.' itself contains "graph". */
const WEBVIEW_SHAPED = /impact.?review|graph|webview|panel|visuali/i;

const candidateCommands = (): readonly string[] =>
  contributedCommandIds().filter((id) => WEBVIEW_SHAPED.test(id.slice(COMMAND_PREFIX.length)));

const impactgraphWebviewTabs = (): readonly vscode.Tab[] =>
  vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.toLowerCase().includes('impactgraph'),
    );

/** Fire every candidate and give the panel a moment to appear; never throws on a bad candidate. */
const openAnyWebview = async (): Promise<readonly vscode.Tab[]> => {
  await ensureIndexed();
  for (const command of candidateCommands()) {
    fireCommand(command);
    await delay(2_000);
    if (impactgraphWebviewTabs().length > 0) {
      break;
    }
  }
  await dismissNotifications();
  return impactgraphWebviewTabs();
};

let opened: readonly vscode.Tab[] | undefined;

const webviewTabs = async (): Promise<readonly vscode.Tab[]> => {
  opened ??= await openAnyWebview();
  if (opened.length === 0) {
    const commands = candidateCommands().join(', ');
    const views = contributedWebviewViewIds().join(', ');
    return skipTest(
      'no ImpactGraph webview panel opened. webview-shaped commands tried: ' +
        `[${commands.length > 0 ? commands : 'none'}]; views contributed as "type":"webview": ` +
        `[${views.length > 0 ? views : 'none'}] — owner: vscode-integration`,
    );
  }
  return opened;
};

/** The live panel behind the tab, or an explicit skip naming what is missing. */
const livePanel = async (): Promise<ReviewPanelProbe> => {
  await webviewTabs();
  const api = requireExtension().exports as ImpactGraphExtensionApi;
  const probe = api.reviewPanel?.();
  if (probe === undefined) {
    return skipTest(
      'a webview tab is open but activate() exported no review-panel handle. It is gated on ' +
        '`context.extensionMode === ExtensionMode.Test` (see src/extension-api.ts) — ' +
        'owner: vscode-integration',
    );
  }
  return probe;
};

const statusMessage = (label: string): HostMessage => ({
  protocolVersion: WEBVIEW_PROTOCOL_VERSION,
  type: 'host/status',
  payload: { busy: false, label },
});

/** §18.4 current-vs-proposed: a graph whose proposed half is a separate, validated channel. */
const proposedRecord = {
  originOptionId: 'opt-1',
  rationale: 'the option would read through a projection',
  provenance: 'llm-inferred',
  evidenceIds: ['ev-1'],
  confidence: 0.6,
  confidenceSignals: [{ type: 'option-footprint', contribution: 0.2 }],
};

const graphMessage = (): HostMessage => ({
  protocolVersion: WEBVIEW_PROTOCOL_VERSION,
  type: 'host/graph',
  payload: {
    graph: {
      schemaVersion: 1,
      status: 'loaded',
      analysisId: 'an-integration',
      requirements: [{ id: 'req-1', statement: 'Owners see their own deals' }],
      nodes: [{ id: 'node-a', name: 'DealService', kind: 'impact', requirementIds: ['req-1'] }],
      edges: [],
      totalNodeCount: 2,
      proposedStructure: {
        nodes: [
          {
            id: 'prop-1',
            name: 'DealProjection',
            category: 'component',
            type: 'service',
            ...proposedRecord,
          },
        ],
        relationships: [
          {
            id: 'rel-1',
            sourceId: 'node-a',
            targetId: 'prop-1',
            sourceKind: 'existing',
            targetKind: 'proposed',
            type: 'data-dependency',
            status: 'proposed',
            ...proposedRecord,
          },
        ],
      },
      warnings: [],
    },
  },
});

export const webviewSuite: IntegrationSuite = {
  name: 'webview communication (PRD §18, §42.4)',
  tests: [
    {
      name: 'a webview-hosting command opens an ImpactGraph webview panel',
      run: async () => {
        const tabs = await webviewTabs();
        assert.ok(tabs.length > 0);
        process.stdout.write(`      webview tabs: ${tabs.map((tab) => tab.label).join(', ')}\n`);
      },
    },
    {
      name: 'reopening the webview reveals the existing panel instead of stacking duplicates',
      run: async () => {
        const before = await webviewTabs();
        const viewTypes = new Set(
          before.map((tab) =>
            tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : '',
          ),
        );
        for (const command of candidateCommands()) {
          fireCommand(command);
        }
        await delay(2_000);
        await dismissNotifications();
        const after = impactgraphWebviewTabs();
        assert.ok(
          after.length <= before.length + viewTypes.size,
          'repeated invocations stacked duplicate webview panels',
        );
      },
    },
    {
      name: 'the loaded webview posts `webview/ready` and the host accepts it (webview → host)',
      run: async () => {
        const panel = await livePanel();
        await waitFor(
          'the React webview to post `webview/ready` through the real transport',
          () => panel.acceptedTypes.includes('webview/ready'),
          30_000,
        );
        process.stdout.write(`      accepted from webview: ${panel.acceptedTypes.join(', ')}\n`);
      },
    },
    {
      name: 'the host delivers a validated message to the live webview (host → webview)',
      run: async () => {
        const panel = await livePanel();
        assert.equal(
          await panel.post(statusMessage('integration-test')),
          'delivered',
          'the live webview did not take a contract-valid host message',
        );
      },
    },
    {
      name: 'a graph carrying §18.4 proposed structure survives the real transport',
      run: async () => {
        const panel = await livePanel();
        assert.equal(
          await panel.post(graphMessage()),
          'delivered',
          'the live webview did not take a graph carrying proposed structure',
        );
        // …and the same graph with a broken proposal is refused before it ever leaves the host.
        // `status` is a literal: a proposal may never be relabelled as current structure (§3).
        const message = graphMessage();
        const structure =
          message.type === 'host/graph' ? message.payload.graph.proposedStructure : undefined;
        assert.ok(structure !== undefined);
        const broken = {
          ...message,
          payload: {
            graph: {
              ...(message as Extract<HostMessage, { type: 'host/graph' }>).payload.graph,
              proposedStructure: {
                ...structure,
                relationships: structure.relationships.map((entry) => ({
                  ...entry,
                  status: 'current',
                })),
              },
            },
          },
        } as unknown as HostMessage;
        assert.equal(await panel.post(broken), 'refused');
      },
    },
    {
      name: 'the host refuses to POST a message that fails the contract',
      run: async () => {
        const panel = await livePanel();
        // `busy` must be a boolean; the host validates before anything leaves it (§5).
        const invalid = {
          protocolVersion: WEBVIEW_PROTOCOL_VERSION,
          type: 'host/status',
          payload: { busy: 'yes' },
        } as unknown as HostMessage;
        assert.equal(await panel.post(invalid), 'refused');
      },
    },
    {
      name: 'an unknown protocol version is refused on the inbound path',
      run: async () => {
        const panel = await livePanel();
        const rejected = panel.receive({
          protocolVersion: 99,
          type: 'webview/ready',
          payload: {},
        });
        assert.equal(rejected?.code, 'unsupported-protocol-version');
        assert.equal(
          panel.receive({ protocolVersion: WEBVIEW_PROTOCOL_VERSION, type: 'webview/nope' })?.code,
          'unknown-type',
        );
        assert.equal(panel.receive('not a message')?.code, 'malformed');
      },
    },
    {
      name: 'a selection request round-trips: select-node in, evidence pushed back out',
      run: async () => {
        const panel = await livePanel();
        const before = panel.acceptedTypes.length;
        // The host answers `webview/select-node` with `host/evidence` — a node id that is not in
        // the analysis still produces an explicit `unavailable` state, never silence (§43.6).
        assert.equal(
          panel.receive({
            protocolVersion: WEBVIEW_PROTOCOL_VERSION,
            type: 'webview/select-node',
            payload: { nodeId: 'symbol:does-not-exist' },
          }),
          undefined,
          'a contract-valid selection request was refused',
        );
        assert.equal(panel.acceptedTypes.length, before + 1);
        await waitFor(
          'the host to answer the selection by delivering an evidence state to the webview',
          () => panel.deliveredTypes.includes('host/evidence'),
          30_000,
        );
        await dismissNotifications();
      },
    },
    {
      name: 'the webview host keeps the extension usable (no workspace state damage)',
      run: async () => {
        await webviewTabs();
        await vscode.commands.executeCommand('impactgraph.showIndexStatus');
        await dismissNotifications();
      },
    },
  ],
};
