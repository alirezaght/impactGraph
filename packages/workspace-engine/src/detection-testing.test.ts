import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRulesConfig } from '@impactgraph/persistence';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { testDetectionRule } from './detection-testing.js';
import { initializeWorkspace } from './workspace.js';

import type { CustomDetectionRuleDto } from '@impactgraph/contracts';

// Story 14.3 — the §Z8 rule test-runner. A candidate rule is executed by the SAME adapter that
// runs during indexing, over one snippet, and nothing is written: the rule never reaches
// rules.yml and the produced facts never reach the graph.

const SUBSCRIBE_RULE: CustomDetectionRuleDto = {
  id: 'internal-pubsub-consumer',
  language: 'typescript',
  match: { imports: ['@company/messaging'], decorators: ['Subscribe'] },
  produces: {
    nodeCategory: 'integration',
    nodeType: 'subscription',
    nameArgument: 0,
    edgeType: 'SUBSCRIBES_TO',
  },
};

const CONSUMER_SNIPPET = [
  "import { Subscribe } from '@company/messaging';",
  '',
  'export class DealEventsConsumer {',
  "  @Subscribe('deal-events')",
  '  onDealEvent(payload: string): void {',
  '    void payload;',
  '  }',
  '}',
  '',
].join('\n');

describe('detection rule test-runner (Story 14.3, §Z8)', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-ruletest-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('reports the nodes and edges a matching rule would emit, with configuration provenance', async () => {
    const tested = await testDetectionRule(rootDir, {
      rule: SUBSCRIBE_RULE,
      snippet: CONSUMER_SNIPPET,
    });
    if (!tested.ok) {
      throw new Error(tested.error.message);
    }
    expect(tested.value.matched).toBe(true);
    expect(tested.value.filePath).toBe('snippet.ts');
    expect(tested.value.detectionReason).toContain('internal-pubsub-consumer');
    const node = tested.value.wouldEmitNodes[0];
    expect(node?.name).toBe('deal-events');
    expect(node?.type).toBe('subscription');
    // §Z8: rule-produced facts are `configuration`, never framework-convention (§3)
    expect(node?.provenance).toBe('configuration');
    const edge = tested.value.wouldEmitEdges[0];
    expect(edge?.type).toBe('SUBSCRIBES_TO');
    expect(edge?.targetId).toBe('custom:internal-pubsub-consumer:deal-events');
  });

  it('never persists the rule or its facts — rules.yml is untouched', async () => {
    const tested = await testDetectionRule(rootDir, {
      rule: SUBSCRIBE_RULE,
      snippet: CONSUMER_SNIPPET,
    });
    expect(tested.ok && tested.value.persisted).toBe(false);
    const rules = readRulesConfig(rootDir);
    expect(rules.ok && (rules.value?.detections ?? [])).toEqual([]);
  });

  it('import gating: the same decorator from another module does not match', async () => {
    const tested = await testDetectionRule(rootDir, {
      rule: SUBSCRIBE_RULE,
      snippet: CONSUMER_SNIPPET.replace('@company/messaging', './local-decorators'),
    });
    if (!tested.ok) {
      throw new Error(tested.error.message);
    }
    expect(tested.value.matched).toBe(false);
    expect(tested.value.wouldEmitNodes).toEqual([]);
    expect(tested.value.detectionReason).toBe('no custom detection rule matched');
  });

  it('runs against a repository-relative file and refuses paths outside the workspace', async () => {
    mkdirSync(join(rootDir, 'src'), { recursive: true });
    writeFileSync(join(rootDir, 'src/consumer.ts'), CONSUMER_SNIPPET, 'utf8');
    const tested = await testDetectionRule(rootDir, {
      rule: SUBSCRIBE_RULE,
      path: 'src/consumer.ts',
    });
    expect(tested.ok && tested.value.filePath).toBe('src/consumer.ts');
    expect(tested.ok && tested.value.matched).toBe(true);

    const escaped = await testDetectionRule(rootDir, {
      rule: SUBSCRIBE_RULE,
      path: '../../etc/passwd',
    });
    expect(escaped.ok).toBe(false);
    expect(escaped.ok ? '' : escaped.error.message).toContain('escapes the workspace');
  });

  it('a rule whose name argument is missing warns instead of emitting a nameless node', async () => {
    const tested = await testDetectionRule(rootDir, {
      rule: { ...SUBSCRIBE_RULE, produces: { ...SUBSCRIBE_RULE.produces, nameArgument: 3 } },
      snippet: CONSUMER_SNIPPET,
    });
    if (!tested.ok) {
      throw new Error(tested.error.message);
    }
    expect(tested.value.wouldEmitNodes).toEqual([]);
    expect(tested.value.warnings[0]).toContain('no string argument at position 3');
  });
});
