import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withIndexStore } from './graphs.js';
import { loadCurrentGraph } from './graphs.js';
import { performIndexRun } from './indexing.js';
import { initializeWorkspace } from './workspace.js';

import type { GraphEdge, GraphNode } from '@impactgraph/domain';

// Story 14.6 / §Z19.11 — a custom framework pattern added via a rules.yml detection shows up
// in the graph with `configuration` provenance, clearly distinct from built-in adapters.

describe('custom detection rules (Story 14.6, §Z8)', () => {
  let repoDir: string;
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-custom-'));
    cpSync(fixtureRepoPath('internal-pubsub'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'custom@test.dev');
    git('config', 'user.name', 'Custom');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    writeFileSync(
      join(repoDir, '.impactgraph/rules.yml'),
      [
        'schemaVersion: 1',
        'detections:',
        '  - id: internal-pubsub-consumer',
        '    language: typescript',
        '    match:',
        '      imports:',
        "        - '@company/messaging'",
        '      decorators:',
        '        - Subscribe',
        '    produces:',
        '      nodeCategory: integration',
        '      nodeType: subscription',
        '      nameArgument: 0',
        '      edgeType: SUBSCRIBES_TO',
        '  - id: internal-pubsub-publisher',
        '    language: typescript',
        '    match:',
        '      imports:',
        "        - '@company/messaging'",
        '      calls:',
        '        - publishTo',
        '    produces:',
        '      nodeCategory: integration',
        '      nodeType: topic',
        '      nameArgument: 0',
        '      edgeType: PUBLISHES',
        '',
      ].join('\n'),
    );
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    const graph = await withIndexStore(repoDir, async (store) => loadCurrentGraph(store));
    if (!graph.ok) {
      throw new Error('graph unavailable');
    }
    nodes = [...graph.value.graph.nodes.values()];
    edges = [...graph.value.graph.edges.values()];
  }, 60_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('a decorator rule produces the subscription node with configuration provenance (§Z8)', () => {
    const subscription = nodes.find(
      (node) => node.type === 'subscription' && node.name === 'deal-events',
    );
    expect(subscription).toBeDefined();
    expect(subscription?.knowledge.provenance).toBe('configuration');
    expect(subscription?.id).toContain('internal-pubsub-consumer');
  });

  it('the SUBSCRIBES_TO edge links the decorated symbol to the produced node', () => {
    const edge = edges.find(
      (candidate) =>
        candidate.type === 'SUBSCRIBES_TO' &&
        candidate.targetId === 'custom:internal-pubsub-consumer:deal-events',
    );
    expect(edge).toBeDefined();
    expect(edge?.sourceId).toContain('deal-consumer');
    expect(edge?.knowledge.provenance).toBe('configuration');
  });

  it('a call rule produces the topic + PUBLISHES edge from the calling file', () => {
    const topic = nodes.find((node) => node.type === 'topic' && node.name === 'deal-notifications');
    expect(topic?.knowledge.provenance).toBe('configuration');
    const edge = edges.find(
      (candidate) =>
        candidate.type === 'PUBLISHES' && candidate.sourceId === 'file:src/notifier.ts',
    );
    expect(edge?.targetId).toBe('custom:internal-pubsub-publisher:deal-notifications');
  });

  it('the same decorator name from a DIFFERENT module does not match — import gating works', () => {
    expect(nodes.some((node) => node.name === 'not-a-topic')).toBe(false);
  });
});
