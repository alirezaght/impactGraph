import { expect } from 'vitest';

import type { McpToolName } from '@impactgraph/contracts';

// Shared expectation flows for the §21 tool-workflow suite (registry.test.ts). They live beside
// the suite rather than inside it so each file stays under the effective-LOC budget; every helper
// asserts one PRD behaviour end to end through the tools alone.

export const asRecord = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

export type CallTool = (name: McpToolName, args?: unknown) => Promise<Record<string, unknown>>;
export type CallToolError = (name: McpToolName, args?: unknown) => Promise<string>;

/** Story 11.2 (§24.1): accept a discrepancy of the persisted review, then prove that the
 *  finding is marked but never recategorized and a re-run review does not inherit it. */
export const expectDeviationFlow = async (
  tool: CallTool,
  toolError: CallToolError,
): Promise<void> => {
  const review = await tool('review_implementation', { target: 'working-tree' });
  const reviewId = review['reviewId'] as string;
  expect(reviewId.length).toBeGreaterThan(0);
  const findings = review['findings'] as { category: string; nodeId: string }[];
  const target = findings.find((finding) => finding.category === 'unexpected');
  expect(target).toBeDefined();
  const nodeId = target?.nodeId ?? '';
  const reason = 'intentional scaffolding';

  // the contract itself requires the human-confirmation assertion (§35)
  expect(await toolError('accept_review_deviation', { reviewId, nodeId, reason })).toContain(
    'invalid input',
  );
  const accepted = await tool('accept_review_deviation', {
    reviewId,
    nodeId,
    reason,
    confirmedByUser: true,
  });
  expect(accepted['category']).toBe('unexpected');
  expect(accepted['acceptedDeviationCount']).toBe(1);

  // rendering the STORED review marks the finding; it is never recategorized
  const stored = await tool('get_review_report', { reviewId });
  const marked = (stored['findings'] as Record<string, unknown>[]).find(
    (finding) => finding['nodeId'] === nodeId,
  );
  expect(marked?.['category']).toBe('unexpected');
  expect((marked?.['acceptedDeviation'] as { reason: string }).reason).toBe(reason);

  // a re-run review is a NEW artifact and does not inherit the acceptance
  const rerun = await tool('review_implementation', { target: 'working-tree' });
  expect(rerun['reviewId']).not.toBe(reviewId);
  const rerunFindings = rerun['findings'] as Record<string, unknown>[];
  expect(rerunFindings.every((finding) => finding['acceptedDeviation'] === undefined)).toBe(true);
};

/** §Z7 read-only surface: structure projection + committed documents + the §Z13 gate. */
export const expectStructureAndConfigReads = async (tool: CallTool): Promise<void> => {
  const structure = await tool('detect_repository_structure');
  const packages = structure['packages'] as Record<string, unknown>[];
  expect(packages).toHaveLength(1);
  expect(packages[0]?.['name']).toBe('ts-basic');
  expect(packages[0]?.['sourceRoots']).toContain('src');
  expect(packages[0]?.['buildConfigFiles']).toContain('tsconfig.json');
  expect(structure['snapshotId']).toEqual(expect.any(String));

  const configuration = await tool('get_configuration');
  expect(asRecord(configuration['config'])['schemaVersion']).toBe(1);
  expect(asRecord(configuration['aliases'])['schemaVersion']).toBe(1);

  const validation = await tool('validate_configuration');
  expect(validation['valid']).toBe(true);
  expect((validation['files'] as unknown[]).length).toBe(4);
  expect(validation['crossFileMessages']).toEqual([]);
};

/** §Z8 (Story 14.3): a candidate rule is dry-run through the indexing adapter and discarded. */
export const expectRuleDryRun = async (tool: CallTool, toolError: CallToolError): Promise<void> => {
  const rule = {
    id: 'mcp-pubsub',
    language: 'typescript',
    match: { imports: ['@company/messaging'], decorators: ['Subscribe'] },
    produces: {
      nodeCategory: 'integration',
      nodeType: 'subscription',
      nameArgument: 0,
      edgeType: 'SUBSCRIBES_TO',
    },
  };
  const snippet =
    "import { Subscribe } from '@company/messaging';\n" +
    'export class C {\n' +
    "  @Subscribe('deal-events')\n" +
    '  handle(): void {}\n' +
    '}\n';
  const tested = await tool('test_detection_rule', { rule, snippet });
  expect(tested['matched']).toBe(true);
  expect(tested['persisted']).toBe(false);
  const emitted = tested['wouldEmitNodes'] as Record<string, unknown>[];
  expect(emitted[0]?.['name']).toBe('deal-events');
  expect(emitted[0]?.['provenance']).toBe('configuration');

  // the rule was never written: rules.yml still holds no detections
  const configuration = await tool('get_configuration');
  expect(asRecord(configuration['rules'])['detections']).toBeUndefined();

  // the contract requires exactly one source — neither is rejected before the handler runs
  expect(await toolError('test_detection_rule', { rule })).toContain('invalid input');
};

/** §Z5: a confirmed value is reported by drift but never removed; an unconfirmed one goes. */
export const expectConfirmationProtectsFromRemoval = async (
  tool: CallTool,
  toolError: CallToolError,
): Promise<void> => {
  const introducedBy: Record<string, string> = {};
  for (const alias of ['invoices', 'ghosts']) {
    const added = await tool('apply_configuration_change', {
      operation: {
        kind: 'add-alias',
        alias,
        canonical: `${alias}Service`,
        reason: 'seeded for the §Z10 stale-removal test',
      },
      approvedByUser: true,
    });
    introducedBy[alias] = added['rollbackId'] as string;
  }
  // the contract itself requires the human-confirmation assertion (§35)
  expect(
    await toolError('confirm_configuration_value', {
      subjectKind: 'alias',
      subject: 'invoices',
      reason: 'kept on purpose',
    }),
  ).toContain('invalid input');
  const confirmed = await tool('confirm_configuration_value', {
    subjectKind: 'alias',
    subject: 'invoices',
    reason: 'InvoiceService lands next sprint — keep the mapping',
    confirmedByUser: true,
  });
  expect(confirmed['file']).toBe('architecture.yml');

  const explained = await tool('explain_configuration', { subject: 'invoices' });
  expect(explained['confirmed']).toBe(true);
  // origin is what INTRODUCED the value; the confirmation is a later entry on the trail
  expect(asRecord(explained['origin'])['rollbackId']).toBe(introducedBy['invoices']);
  const trail = explained['auditTrail'] as { rollbackId: string; operationKind: string }[];
  expect(trail.map((entry) => entry.rollbackId)).toContain(confirmed['rollbackId']);
  expect(trail.map((entry) => entry.operationKind)).toContain('confirm-value');

  expect(await toolError('remove_stale_configuration', {})).toContain('invalid input');
  const removed = await tool('remove_stale_configuration', { confirmedByUser: true });
  const gone = (removed['removed'] as { subject: string }[]).map((entry) => entry.subject);
  expect(gone).toContain('ghosts');
  expect(gone).not.toContain('invoices');
  const skipped = (removed['skipped'] as { subject: string; reason: string }[]).find(
    (entry) => entry.subject === 'invoices',
  );
  expect(skipped?.reason).toContain('human-confirmed');
};

/** §18.5/§3: query + explain always carry provenance and the derived knowledge category. */
export const expectQueryAndExplain = async (tool: CallTool): Promise<void> => {
  const architecture = await tool('query_architecture');
  expect(architecture['totalNodes']).toBeGreaterThan(10);

  const found = await tool('find_components', { query: 'DealService' });
  const components = found['components'] as { nodeId: string; provenance: string }[];
  expect(components.length).toBeGreaterThan(0);
  const nodeId = components[0]?.nodeId ?? '';

  const node = await tool('explain_node', { nodeId });
  const knowledge = asRecord(node['knowledge']);
  // §3: provenance AND the derived category — facts distinguishable from inferences
  expect(knowledge['provenance']).toBe('static-analysis');
  expect(knowledge['knowledgeCategory']).toBe('deterministic');
  expect((knowledge['evidence'] as unknown[]).length).toBeGreaterThan(0);

  const edges = [
    ...(node['outgoingEdges'] as { edgeId: string }[]),
    ...(node['incomingEdges'] as { edgeId: string }[]),
  ];
  expect(edges.length).toBeGreaterThan(0);
  const edge = await tool('explain_edge', { edgeId: edges[0]?.edgeId ?? '' });
  expect(asRecord(edge['knowledge'])['knowledgeCategory']).toBe('deterministic');
};

/**
 * Item 9: the bounded summary IS the answer — status, caveats, counts, and the strongest structural
 * findings — and it must fit in an agent's context without a temp file.
 */
export const expectBoundedSummary = (analyzed: Record<string, unknown>): void => {
  // The strongest structural findings are IN the answer; an agent should not have to page for them.
  const top = analyzed['topImpacts'] as { name: string; evidenceType: string }[];
  expect(top.map((impact) => impact.name)).toContain('DealService');
  // Every finding states WHY it was selected (item 3).
  expect(top.every((impact) => impact.evidenceType.length > 0)).toBe(true);
  // The caveats a reader needs in order to trust the result at all (items 1, 10, 11).
  expect(asRecord(analyzed['freshness'])['state']).toEqual(expect.any(String));
  expect(asRecord(asRecord(analyzed['coverage'])['indexWarnings'])['groups']).toEqual(
    expect.any(Array),
  );
  expect(asRecord(analyzed['impactQuery'])['scope']).toEqual(expect.any(String));
  expect(analyzed['followUp']).toEqual(expect.arrayContaining([expect.any(String)]));
  expect(JSON.stringify(analyzed).length).toBeLessThan(24_000);
};

/**
 * Item 9: the bounded summary withholds detail on purpose, and `list_impacts` is where it lives.
 * The assertion that matters is that the detail is genuinely there — dependency paths and the
 * evidence bases — because a summary that points at an empty page is worse than no summary.
 */
export const expectImpactPaging = async (tool: CallTool, analysisId: string): Promise<void> => {
  const page = await tool('list_impacts', { analysisId, topN: 2 });
  const impacts = page['impacts'] as { dependencyPath: string[]; evidenceTypes: string[] }[];
  expect(impacts.length).toBeLessThanOrEqual(2);
  expect(impacts[0]?.dependencyPath.length).toBeGreaterThan(0);
  expect(impacts[0]?.evidenceTypes.length).toBeGreaterThan(0);
  expect(asRecord(page['pagination'])['totalMatching']).toEqual(expect.any(Number));

  // Lexical-only findings are hidden by default and available on request (item 3).
  const withLexical = await tool('list_impacts', { analysisId, includeLexicalOnly: true });
  expect(
    asRecord(asRecord(withLexical['pagination'])['appliedFilters'])['includeLexicalOnly'],
  ).toBe(true);
  // An empty or short page still states what it covered and what it left out (item 11).
  expect(asRecord(page['impactQuery'])['scope']).toEqual(expect.any(String));
};

/**
 * Item 12: record what an implementation actually touched, and measure the prediction against it.
 * The assertions that matter are the honest ones — precision is stated WITH the tiers it judged, a
 * figure that cannot be computed is absent rather than zero, and the response says outright that
 * nothing was learned from the result.
 */
export const expectActualImpactRecording = async (
  tool: CallTool,
  toolError: CallToolError,
  analysisId: string,
): Promise<void> => {
  const recorded = await tool('record_actual_impact', {
    analysisId,
    changedFiles: ['src/services/deal-service.ts'],
    addedFiles: ['src/locales/de.json'],
    relationshipChanges: [{ type: 'PUBLISHES', sourceId: 'a', targetId: 'topic:x', kind: 'added' }],
    manualFindings: [{ note: 'a null expiry crashed the renderer', kind: 'risk' }],
    note: 'recorded by the §21 workflow suite',
  });
  const metrics = asRecord(recorded['metrics']);
  // Precision is meaningless without the tiers it judged, so both are always present.
  expect(metrics['judgedTiers']).toEqual(['required', 'likely']);
  expect(metrics['truePositives']).toContain('src/services/deal-service.ts');
  // The locale file was ADDED, and the analysis did not predict that category.
  expect(metrics['missedArtifactCategories']).toContain('new-locale-entry');
  // A relationship type the prediction never crossed.
  expect(metrics['missedRelationshipTypes']).toContain('PUBLISHES');
  expect(recorded['historyCount']).toBe(1);
  expect(String(recorded['note'])).toContain('no ranking rule was learned');
  // Item 8: every recording answers "how is prediction quality trending" — the aggregate spans ALL
  // stored outcomes (here: just this one) and states the ADR-0015 trigger verdict as a fact.
  const aggregate = asRecord(recorded['aggregate']);
  expect(aggregate['outcomeCount']).toBe(1);
  expect(asRecord(aggregate['precision'])['sampleSize']).toBe(1);
  expect(aggregate['adrTriggerMet']).toBe(false);

  // Append-only: the same outcome id cannot be recorded twice.
  const outcomeId = recorded['outcomeId'] as string;
  expect(
    await toolError('record_actual_impact', {
      analysisId,
      outcomeId,
      changedFiles: ['src/services/deal-service.ts'],
    }),
  ).toContain('append-only');

  // An outcome that names nothing measures nothing, and is refused.
  expect(await toolError('record_actual_impact', { analysisId })).toContain(
    'must name at least one',
  );
};

interface CorrectionTarget {
  readonly nodeId: string;
  readonly graphName: string;
  readonly edgeId: string;
  readonly edgesBefore: number;
}

/** §16: a rejected relationship is reported and counted apart — the graph edge stays. */
const expectRejectionIsVisible = async (
  tool: CallTool,
  target: CorrectionTarget,
): Promise<void> => {
  // the overlay shows through explain_node — the graph name is kept alongside the effective one
  const after = await tool('explain_node', { nodeId: target.nodeId });
  expect(after['name']).toBe(target.graphName);
  expect(asRecord(asRecord(after['effective'])['name'])).toMatchObject({
    value: 'DealAppService',
    level: 'human-confirmed',
    rank: 1,
  });

  const edge = await tool('explain_edge', { edgeId: target.edgeId });
  expect(asRecord(edge['effective'])).toMatchObject({ status: 'rejected', excluded: true });
  const architecture = await tool('query_architecture');
  expect(architecture['totalEdges']).toBe(target.edgesBefore);
  expect(architecture['effectiveTotalEdges']).toBe(target.edgesBefore - 1);
  expect((architecture['rejectedEdges'] as { edgeId: string }[])[0]?.edgeId).toBe(target.edgeId);
  expect(asRecord(architecture['corrections'])['rejectedRelationships']).toBe(1);
};

/** §16: corrections are overlaid at read time — the graph and its edge count never change. */
export const expectCorrectionOverlay = async (
  tool: CallTool,
  toolError: CallToolError,
): Promise<void> => {
  const found = await tool('find_components', { query: 'DealService' });
  const nodeId = (found['components'] as { nodeId: string }[])[0]?.nodeId ?? '';
  const before = await tool('explain_node', { nodeId });
  const graphName = before['name'] as string;
  const edgeId =
    (before['outgoingEdges'] as { edgeId: string }[])[0]?.edgeId ??
    (before['incomingEdges'] as { edgeId: string }[])[0]?.edgeId ??
    '';
  const edgesBefore = (await tool('query_architecture'))['totalEdges'] as number;

  // the contract requires the §35 confirmation before the handler runs
  expect(
    await toolError('apply_component_correction', {
      correction: {
        kind: 'rename-component',
        from: graphName,
        to: 'DealAppService',
        reason: 'r',
      },
    }),
  ).toContain('invalid input');

  const renamed = await tool('apply_component_correction', {
    correction: {
      kind: 'rename-component',
      from: graphName,
      to: 'DealAppService',
      reason: 'the team calls it DealAppService',
    },
    confirmedByUser: true,
  });
  expect(renamed).toMatchObject({ file: 'architecture.yml', source: 'human-confirmed' });

  const rejected = await tool('apply_component_correction', {
    correction: {
      kind: 'set-relationship-confirmation',
      edgeId,
      confirmed: false,
      reason: 'test-only shim, not a real dependency',
    },
    confirmedByUser: true,
  });
  expect(rejected['kind']).toBe('set-relationship-confirmation');

  await expectRejectionIsVisible(tool, { nodeId, graphName, edgeId, edgesBefore });

  // every correction is undoable through the §Z14 path
  const undone = await tool('rollback_configuration_change', {
    rollbackId: rejected['rollbackId'],
    confirmedByUser: true,
  });
  expect(undone['restoredFile']).toBe('architecture.yml');
  expect(asRecord((await tool('explain_edge', { edgeId }))['effective'])['status']).toBe(
    'undecided',
  );
};

/**
 * §16 ownership: the correction travels the governed path, then shows up wherever the other
 * effective values do — as a resolved value with its §Z5 level, never as a graph fact and never
 * as a permission. A glob naming nothing is refused rather than persisted as a silent no-op.
 */
export const expectOwnershipOverlay = async (
  tool: CallTool,
  toolError: CallToolError,
): Promise<void> => {
  const owner = 'Deal Platform Team';
  expect(
    await toolError('apply_component_correction', {
      correction: {
        kind: 'set-component-owner',
        component: 'src/nonexistent/**',
        owner,
        reason: 'nobody works there',
      },
      confirmedByUser: true,
    }),
  ).toContain('matches no file');

  const applied = await tool('apply_component_correction', {
    correction: {
      kind: 'set-component-owner',
      component: 'src/services/**',
      owner,
      reason: 'they run the deal services',
    },
    confirmedByUser: true,
  });
  expect(applied).toMatchObject({ file: 'architecture.yml', source: 'human-confirmed' });

  const found = await tool('find_components', { query: 'deal-service' });
  const hit = (found['components'] as { nodeId: string; path?: string }[]).find(
    (component) => component.path === 'src/services/deal-service.ts',
  );
  const node = await tool('explain_node', { nodeId: hit?.nodeId ?? '' });
  expect(asRecord(asRecord(node['effective'])['owner'])).toMatchObject({
    value: owner,
    level: 'human-confirmed',
    rank: 1,
    provenance: 'human-confirmed',
  });

  // the same value, unchanged, on the architecture summary
  const architecture = await tool('query_architecture');
  expect(asRecord(architecture['corrections'])['ownersSet']).toBeGreaterThan(0);
};
