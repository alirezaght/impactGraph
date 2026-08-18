import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildImpactPage } from './impact-page.js';
import { buildImpactSummary } from './impact-summary.js';

import type {
  ImpactAnalysis,
  ImpactEvidenceType,
  ImpactLikelihood,
  IndexFreshness,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

// Dogfooding item 4 — the aggregate honesty signal, wired through the bounded summary: the
// evidenceQuality block, the provisional marking, the count-bearing limitation strings, and the
// report-limited-evidence action. The verdict thresholds themselves are pinned at the domain
// layer (evidence-quality.test.ts); this file pins the plumbing.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-02T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const graph = (): KnowledgeGraph => {
  const nodes = ['sym:a', 'sym:b', 'sym:c'].map((id) => {
    const node = createGraphNode({
      id,
      name: id.replace('sym:', 'Component'),
      category: 'application',
      type: 'service',
      knowledge,
    });
    if (!node.ok) {
      throw new Error('bad fixture node');
    }
    return node.value;
  });
  const created = createKnowledgeGraph(nodes, []);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const specification: Specification = {
  id: 'spec-1',
  title: 'evidence-quality fixture',
  sourceType: 'markdown',
  sourceReference: 'specs/fixture.md',
  rawText: 'fixture',
  version: 1,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  requirements: [
    {
      id: 'req-1',
      statement: 'Something must change.',
      type: 'functional',
      concepts: [],
      actors: [],
      status: 'draft',
    },
  ],
  actors: [],
  constraints: [],
  openQuestions: [],
  decisions: [],
};

const impact = (
  nodeId: string,
  likelihood: ImpactLikelihood,
  evidenceTypes: readonly ImpactEvidenceType[],
  extras: Partial<RequirementImpact> = {},
): RequirementImpact => ({
  requirementId: 'req-1',
  nodeId,
  likelihood,
  impactType: 'domain-model',
  directness: 'direct',
  confidence: 0.6,
  confidenceSignals: [{ type: 'semantic-concept-match', contribution: 0.6 }],
  explanation: 'fixture impact',
  expectedChanges: ['review'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis',
  evidenceTypes: [...evidenceTypes],
  ...extras,
});

const analysisWith = (impacts: readonly RequirementImpact[]): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-02T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [...impacts],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

const freshness: IndexFreshness = { state: 'current', stale: false, reasons: [] };

const summaryFor = (impacts: readonly RequirementImpact[], filters = {}) =>
  buildImpactSummary({
    specification,
    analysis: analysisWith(impacts),
    graph: graph(),
    freshness,
    extractionMode: 'unchanged',
    indexWarnings: [],
    filters,
  });

const weakImpacts = (): RequirementImpact[] => [
  impact('sym:a', 'likely', ['name-similarity'], { tierCappedBy: 'name-similarity' }),
  impact('sym:b', 'likely', ['name-similarity'], { tierCappedBy: 'name-similarity' }),
];

describe('the bounded summary carries the evidence-quality verdict', () => {
  /**
   * ADR-0025 keeps a resemblance-RESOLVED subject in the primary view (hiding it would leave an
   * empty plan and nothing to correct), so the shown set still contains the fuzzy matches and the
   * evidence-quality verdict still calls it weak. What changed is that the reader is now told, on
   * every line, that the component was matched by name rather than named.
   */
  it('reports weak, marks the analysis provisional, and emits report-limited-evidence', () => {
    const summary = summaryFor(weakImpacts());
    expect(summary.evidenceQuality?.status).toBe('weak');
    expect(summary.evidenceQuality?.counts.fuzzyAnchorCount).toBe(2);
    expect(summary.evidenceQuality?.counts.tierCappedCount).toBe(2);
    expect(summary.analysis.provisional).toBe(true);
    expect(
      summary.analysis.provisionalReasons.some((reason) => reason.includes('structural evidence')),
    ).toBe(true);
    expect(
      summary.requiredActions?.some((action) => action.action === 'report-limited-evidence'),
    ).toBe(true);
    expect(summary.topImpacts.every((impact) => impact.planningRole === 'planning-impact')).toBe(
      true,
    );
    expect(
      summary.topImpacts.every((impact) => impact.planningRoleRule === 'resolved-by-resemblance'),
    ).toBe(true);
  });

  /** The same resemblance REACHED by traversal is a lead: it leaves the plan entirely. */
  it('files a resemblance reached by traversal as a lead and empties the plan', () => {
    const summary = summaryFor([
      impact('sym:a', 'likely', ['name-similarity'], {
        tierCappedBy: 'name-similarity',
        directness: 'indirect',
        dependencyPath: ['sym:root', 'sym:a'],
      }),
    ]);
    expect(summary.topImpacts).toHaveLength(0);
    expect(summary.planningSignal?.investigationLeadCount).toBe(1);
    expect(summary.dependencyContext?.investigationLeadCount).toBe(1);
    expect(
      summary.analysis.provisionalReasons.some((reason) => reason.includes('planning decisions')),
    ).toBe(true);
    expect(
      summary.requiredActions?.some((action) => action.action === 'report-limited-evidence'),
    ).toBe(true);
  });

  it('reports evidence-backed with no action when the strong tiers are structural', () => {
    const summary = summaryFor([
      impact('sym:a', 'required', ['direct-structural']),
      impact('sym:b', 'likely', ['async-event']),
    ]);
    expect(summary.evidenceQuality?.status).toBe('evidence-backed');
    expect(summary.analysis.provisional).toBe(false);
    expect(
      summary.requiredActions?.some((action) => action.action === 'report-limited-evidence'),
    ).toBe(false);
  });

  it('judges the SHOWN impacts: hidden lexical-only rows do not drag the verdict down', () => {
    const summary = summaryFor([
      impact('sym:a', 'required', ['direct-structural']),
      impact('sym:b', 'lexical-only', ['lexical-only']),
      impact('sym:c', 'lexical-only', ['lexical-only']),
    ]);
    expect(summary.evidenceQuality?.status).toBe('evidence-backed');
    expect(summary.evidenceQuality?.counts.shownImpactCount).toBe(1);
  });
});

describe('limitation strings are conditional and count-bearing', () => {
  it('names the count when lexical-only or excluded impacts were hidden', () => {
    const summary = summaryFor([
      impact('sym:a', 'required', ['direct-structural']),
      impact('sym:b', 'lexical-only', ['lexical-only']),
      impact('sym:c', 'excluded', ['direct-structural']),
    ]);
    expect(
      summary.impactQuery.limitations.some((line) => line.startsWith('1 lexical-only')),
    ).toBe(true);
    expect(
      summary.impactQuery.limitations.some((line) =>
        line.includes('1 impact(s) excluded by specification non-goals'),
      ),
    ).toBe(true);
  });

  it('stays silent when nothing was hidden', () => {
    const summary = summaryFor([impact('sym:a', 'required', ['direct-structural'])]);
    expect(summary.impactQuery.limitations).toEqual([]);
  });

  it('stays silent when the caller opted in to the hidden tiers', () => {
    const summary = summaryFor(
      [
        impact('sym:a', 'required', ['direct-structural']),
        impact('sym:b', 'lexical-only', ['lexical-only']),
      ],
      { includeLexicalOnly: true },
    );
    expect(summary.impactQuery.limitations).toEqual([]);
  });
});

describe('list_impacts carries the aggregate distribution', () => {
  it('reports whole-analysis counts alongside the page', () => {
    const page = buildImpactPage({
      specification,
      analysis: analysisWith([
        impact('sym:a', 'required', ['direct-structural']),
        impact('sym:b', 'lexical-only', ['lexical-only']),
      ]),
      graph: graph(),
    });
    expect(page.counts?.totalImpacts).toBe(2);
    expect(page.counts?.byLikelihood).toEqual({ required: 1, 'lexical-only': 1 });
    expect(page.counts?.byEvidenceType).toEqual({
      'direct-structural': 1,
      'lexical-only': 1,
    });
    // The page's own limitation line is count-bearing too.
    expect(page.impactQuery.limitations.some((line) => line.startsWith('1 lexical-only'))).toBe(
      true,
    );
  });
});
