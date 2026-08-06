import { createGraphNode, createKnowledgeGraph, createSpecification } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactSummary } from './impact-summary.js';

import type { WorkspaceRepositoryContext } from '../repository-coverage.js';
import type {
  AnalysisWarning,
  ImpactAnalysis,
  IndexFreshness,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

// The coverage gate: when the graph demonstrably does not contain what the specification names,
// the summary says 'insufficient-coverage', WITHHOLDS readiness, and tells the agent what to do.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-02T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const graph = (): KnowledgeGraph => {
  const node = createGraphNode({
    id: 'sym:deal',
    name: 'DealService',
    category: 'application',
    type: 'service',
    knowledge,
  });
  if (!node.ok) {
    throw new Error('bad fixture node');
  }
  const created = createKnowledgeGraph([node.value], []);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const requirement = (id: string, concept: string) => ({
  id,
  statement: `${concept} must change.`,
  type: 'functional' as const,
  concepts: [concept],
  actors: [],
  status: 'draft' as const,
});

const specification = (concepts: readonly string[]): Specification => {
  const created = createSpecification({
    id: 'spec-1',
    title: 'coverage fixture',
    sourceType: 'markdown',
    rawText: 'fixture',
    version: 1,
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    requirements: concepts.map((concept, index) => requirement(`req-${String(index + 1)}`, concept)),
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!created.ok) {
    throw new Error('bad fixture spec');
  }
  return created.value;
};

const impactFor = (requirementId: string): RequirementImpact => ({
  requirementId,
  nodeId: 'sym:deal',
  likelihood: 'required',
  impactType: 'domain-model',
  directness: 'direct',
  confidence: 0.9,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: 'matched',
  expectedChanges: ['review'],
  evidenceIds: ['ev-1'],
  dependencyPath: ['sym:deal'],
  provenance: 'static-analysis',
  // Absent evidenceTypes reads as lexical-only (the weakest reading) and would trip the
  // evidence-quality verdict — this fixture models an exact structural match, so it says so.
  evidenceTypes: ['direct-structural'],
});

const unknownConceptWarnings = (requirementId: string, concept: string): AnalysisWarning[] => [
  { code: 'unknown-concept', message: `no repository node matches concept '${concept}'`, requirementId },
  {
    code: 'unresolved-concept',
    message: `'${concept}' is named in the specification but matches no indexed repository artifact — it may be new, external, or outside the indexed scope. No node was created for it.`,
    requirementId,
  },
];

const analysisFor = (
  impacts: readonly RequirementImpact[],
  warnings: readonly AnalysisWarning[],
): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-02T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [...impacts],
  architecturalOptions: [],
  warnings: [...warnings],
  userDecisions: [],
});

const freshness = (stale = false): IndexFreshness => ({
  state: stale ? 'aged' : 'current',
  stale,
  reasons: stale ? ['The index is 45 hours old.'] : [],
});

const context: WorkspaceRepositoryContext = {
  repositories: [
    { name: '(workspace root)', indexed: true, fileCount: 10 },
    { name: 'billing', path: 'billing', indexed: false, fileCount: 0, reason: 'the declared path does not exist on disk' },
    { name: 'search', path: 'search', indexed: false, fileCount: 0, reason: 'registered but not in the current index — run index_workspace' },
  ],
  candidates: [{ name: 'web', path: 'web', hint: 'contains its own git repository but is not registered' }],
  limitations: ['2 related repository/repositories are registered; 0 were analyzed.'],
};

const summarize = (
  spec: Specification,
  analysis: ImpactAnalysis,
  workspace?: WorkspaceRepositoryContext,
  stale = false,
) =>
  buildImpactSummary({
    specification: spec,
    analysis,
    graph: graph(),
    freshness: freshness(stale),
    extractionMode: 'unchanged',
    indexWarnings: [],
    ...(workspace === undefined ? {} : { workspace }),
  });

describe('workspace coverage in the bounded summary', () => {
  it('reports adequate coverage and a readiness score when the graph covers the specification', () => {
    const spec = specification(['DealService']);
    const summary = summarize(spec, analysisFor([impactFor('req-1')], []));
    expect(summary.workspaceCoverage?.status).toBe('adequate');
    expect(summary.specification.readiness).toBeDefined();
    expect(summary.requiredActions).toEqual([]);
  });

  it('withholds readiness and says insufficient-coverage when most requirements are unmatched', () => {
    const spec = specification(['DealService', 'BillingApi', 'SearchIndex', 'MailQueue']);
    const warnings = [
      ...unknownConceptWarnings('req-2', 'BillingApi'),
      ...unknownConceptWarnings('req-3', 'SearchIndex'),
      ...unknownConceptWarnings('req-4', 'MailQueue'),
    ];
    const summary = summarize(spec, analysisFor([impactFor('req-1')], warnings));
    expect(summary.workspaceCoverage?.status).toBe('insufficient-coverage');
    expect(summary.specification.readiness).toBeUndefined();
    expect(summary.specification.readinessWithheldReason).toContain('coverage');
    expect(summary.analysis.provisional).toBe(true);
    expect(summary.analysis.provisionalReasons.join(' ')).toContain('match no indexed component');
    expect(summary.workspaceCoverage?.affectedRequirementIds).toEqual(['req-2', 'req-3', 'req-4']);
    expect(summary.workspaceCoverage?.affectedConcepts).toEqual([
      'BillingApi',
      'MailQueue',
      'SearchIndex',
    ]);
  });

  it('demands report-limited-scope when coverage is insufficient and no repository can be added', () => {
    const spec = specification(['BillingApi', 'SearchIndex']);
    const warnings = [
      ...unknownConceptWarnings('req-1', 'BillingApi'),
      ...unknownConceptWarnings('req-2', 'SearchIndex'),
    ];
    const summary = summarize(spec, analysisFor([], warnings));
    expect(summary.requiredActions?.map((action) => action.action)).toEqual([
      'report-limited-scope',
    ]);
  });

  it('lists indexed, missing and candidate repositories and derives the repository actions', () => {
    const spec = specification(['DealService', 'BillingApi', 'SearchIndex', 'MailQueue']);
    const warnings = [
      ...unknownConceptWarnings('req-2', 'BillingApi'),
      ...unknownConceptWarnings('req-3', 'SearchIndex'),
      ...unknownConceptWarnings('req-4', 'MailQueue'),
    ];
    const summary = summarize(spec, analysisFor([impactFor('req-1')], warnings), context);
    expect(summary.workspaceCoverage?.repositories.indexed.map((repo) => repo.name)).toEqual([
      '(workspace root)',
    ]);
    expect(
      summary.workspaceCoverage?.repositories.registeredButMissing.map((repo) => repo.name),
    ).toEqual(['billing', 'search']);
    expect(summary.workspaceCoverage?.repositories.candidates.map((repo) => repo.name)).toEqual([
      'web',
    ]);
    const actions = summary.requiredActions ?? [];
    const kinds = actions.map((action) => action.action);
    expect(kinds).toContain('index-registered-repositories');
    expect(kinds).toContain('register-missing-repositories');
    expect(kinds).toContain('confirm-candidate-repositories');
    expect(kinds).not.toContain('report-limited-scope');
    expect(actions.find((a) => a.action === 'register-missing-repositories')?.repositories).toEqual(
      ['billing'],
    );
    expect(actions.find((a) => a.action === 'index-registered-repositories')?.repositories).toEqual(
      ['search'],
    );
    expect(
      actions.find((a) => a.action === 'confirm-candidate-repositories')?.instruction,
    ).toContain('Ask the user');
    expect(summary.impactQuery.limitations.join(' ')).toContain('registered');
  });

  it('asks for a refresh first when the index is stale', () => {
    const spec = specification(['DealService']);
    const summary = summarize(spec, analysisFor([impactFor('req-1')], []), undefined, true);
    expect(summary.requiredActions?.[0]?.action).toBe('refresh-stale-index');
  });
});
