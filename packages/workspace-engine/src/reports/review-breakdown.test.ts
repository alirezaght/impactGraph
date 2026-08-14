import {
  createGraphNode,
  createImpactAnalysis,
  createImplementationReview,
  createSpecification,
  specNoteId,
  stableRequirementId,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { buildReviewBreakdown } from './review-breakdown.js';

import type {
  GraphNode,
  ImpactAnalysis,
  ImpactLikelihood,
  ImplementationReview,
  KnowledgeGraph,
  Specification,
} from '@impactgraph/domain';

// Item 13: the review must separate the kinds of finding a reader acts on differently.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-04T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
} as const;

const node = (id: string, name: string, path: string): GraphNode => {
  const created = createGraphNode({
    id,
    type: 'file',
    name,
    category: 'repository',
    path,
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`node ${id}`);
  }
  return created.value;
};

const graph = (nodes: readonly GraphNode[]): KnowledgeGraph => {
  const map = new Map(nodes.map((entry) => [entry.id, entry]));
  return {
    nodes: map,
    edges: new Map(),
    outgoing: new Map(),
    incoming: new Map(),
  };
};

const REQUIREMENT = '`Renderer` must name the seller.';

const specification = (
  nonGoals: readonly string[] = ['Reworking the mailer.'],
): Specification => {
  const created = createSpecification({
    id: 'spec-1',
    title: 'Notification wording',
    sourceType: 'markdown',
    rawText: REQUIREMENT,
    version: 1,
    createdAt: '2026-08-04T10:00:00.000Z',
    updatedAt: '2026-08-04T10:00:00.000Z',
    requirements: [
      {
        id: stableRequirementId(REQUIREMENT),
        statement: REQUIREMENT,
        type: 'functional',
        concepts: ['Renderer'],
        actors: [],
        status: 'draft',
        origin: 'explicit-label',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
    notes: nonGoals.map((statement) => ({
      id: specNoteId('non-goal', statement),
      kind: 'non-goal' as const,
      statement,
    })),
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const impact = (
  nodeId: string,
  likelihood: ImpactLikelihood,
  evidenceTypes: readonly string[] = ['direct-structural'],
  explanation = `predicted ${nodeId}`,
) => ({
  requirementId: stableRequirementId(REQUIREMENT),
  nodeId,
  likelihood,
  impactType: 'domain-model' as const,
  directness: 'direct' as const,
  confidence: 0.8,
  confidenceSignals: [{ type: 'direct-observation' as const, contribution: 1 }],
  explanation,
  expectedChanges: ['review it'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis' as const,
  evidenceTypes: evidenceTypes as never,
});

const analysis = (
  impacts: readonly ReturnType<typeof impact>[],
  status: 'approved' | 'draft' = 'approved',
): ImpactAnalysis => {
  const created = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-04T10:00:00.000Z',
    status,
    requirementImpacts: impacts,
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const review = (
  changedFiles: readonly string[],
  overrides: Partial<Pick<ImplementationReview, 'findings' | 'edgeChanges'>> = {},
): ImplementationReview => {
  const created = createImplementationReview({
    id: 'review-1',
    analysisId: 'analysis-1',
    reviewSnapshotId: 'snap-2',
    target: 'working-tree',
    createdAt: '2026-08-05T10:00:00.000Z',
    changedFiles: [...changedFiles],
    findings: overrides.findings ?? [],
    coverage: [],
    edgeChanges: overrides.edgeChanges ?? { added: [], removed: [] },
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const findingOf = (
  category: 'matched' | 'unverifiable',
  nodeId: string,
): ImplementationReview['findings'][number] => ({
  category,
  nodeId,
  nodeName: nodeId,
  explanation: `finding about ${nodeId}`,
  filePaths: [],
});

const NODES = [
  node('file:src/renderer.ts', 'renderer.ts', 'src/renderer.ts'),
  node('file:src/mailer.ts', 'mailer.ts', 'src/mailer.ts'),
  node('file:src/unrelated.ts', 'unrelated.ts', 'src/unrelated.ts'),
];

describe('buildReviewBreakdown', () => {
  it('separates a correctly predicted change from a false strong prediction', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/renderer.ts']),
      analysis: analysis([
        impact('file:src/renderer.ts', 'required'),
        impact('file:src/unrelated.ts', 'likely', ['transitive-structural']),
      ]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
    });
    expect(breakdown.correctlyPredictedStructural).toEqual(['src/renderer.ts']);
    expect(breakdown.falseStrongPredictions).toEqual([
      {
        path: 'src/unrelated.ts',
        name: 'unrelated.ts',
        likelihood: 'likely',
        basis: 'transitive-structural',
      },
    ]);
  });

  it('separates a missed EXISTING file from a missed NEW file', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/renderer.ts', 'src/mailer.ts', 'src/locales/de.json']),
      analysis: analysis([impact('file:src/renderer.ts', 'required')]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: ['src/locales/de.json'],
    });
    expect(breakdown.missedChangedFiles).toEqual(['src/mailer.ts']);
    expect(breakdown.missedNewFiles).toEqual(['src/locales/de.json']);
  });

  it('reports a lexical-only prediction that DID change', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/mailer.ts']),
      analysis: analysis([impact('file:src/mailer.ts', 'lexical-only', ['lexical-only'])]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
    });
    expect(breakdown.lexicalOnlyThatChanged).toEqual([
      { path: 'src/mailer.ts', name: 'mailer.ts' },
    ]);
    // It was not predicted structurally, so it also counts as a miss — both readings are true.
    expect(breakdown.missedChangedFiles).toEqual(['src/mailer.ts']);
  });

  it('groups configuration, contract and migration changes apart', () => {
    const breakdown = buildReviewBreakdown({
      review: review([
        'src/locales/en.json',
        'infra/main.tf',
        'contracts/deals-openapi.json',
        'db/migrations/003_add_expiry.sql',
      ]),
      analysis: analysis([impact('file:src/renderer.ts', 'required')]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
    });
    expect(breakdown.configurationAndAssetChanges).toContain('src/locales/en.json');
    expect(breakdown.configurationAndAssetChanges).toContain('infra/main.tf');
    expect(breakdown.contractChanges).toEqual(['contracts/deals-openapi.json']);
    expect(breakdown.migrationChanges).toEqual(['db/migrations/003_add_expiry.sql']);
  });

  it('reports a non-goal contradiction when an excluded component changed', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/mailer.ts']),
      analysis: analysis([impact('file:src/mailer.ts', 'excluded')]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
    });
    expect(breakdown.nonGoalContradictions).toEqual([
      { statement: 'Reworking the mailer.', changedPaths: ['src/mailer.ts'] },
    ]);
  });

  it('always states the analyzed scope, so an empty list is readable', () => {
    const breakdown = buildReviewBreakdown({
      review: review([]),
      analysis: analysis([impact('file:src/renderer.ts', 'required')]),
      specification: specification(),
      currentGraph: graph(NODES),
    });
    expect(breakdown.scope.approvedSnapshotId).toBe('snap-1');
    expect(breakdown.scope.reviewSnapshotId).toBe('snap-2');
    expect(breakdown.scope.target).toBe('working-tree');
    expect(breakdown.scope.indexedComponentCount).toBe(3);
    // Without `addedPaths` the caller did not distinguish additions, and the scope says so rather
    // than letting `missedNewFiles: []` read as "no new files were needed".
    expect(breakdown.scope.limitations.join(' ')).toContain('Added files were not distinguished');
  });

  it('attributes a non-goal contradiction to the specific non-goal that excluded the component', () => {
    const excludedByMailer = impact(
      'file:src/mailer.ts',
      'excluded',
      ['direct-structural'],
      'predicted mailer. Excluded by a specification non-goal: "Reworking the mailer.".',
    );
    const excludedByTheme = impact(
      'file:src/unrelated.ts',
      'excluded',
      ['direct-structural'],
      'predicted unrelated. Excluded by a specification non-goal: "Changing the renderer theme.".',
    );
    const breakdown = buildReviewBreakdown({
      review: review(['src/mailer.ts']),
      analysis: analysis([excludedByMailer, excludedByTheme]),
      specification: specification(['Reworking the mailer.', 'Changing the renderer theme.']),
      currentGraph: graph(NODES),
      addedPaths: [],
    });
    // One changed excluded file must contradict ONE non-goal — never both with identical paths.
    expect(breakdown.nonGoalContradictions).toEqual([
      { statement: 'Reworking the mailer.', changedPaths: ['src/mailer.ts'] },
    ]);
  });

  it('names unindexed registered repositories and unregistered candidates as measured limitations', () => {
    const breakdown = buildReviewBreakdown({
      review: review([]),
      analysis: analysis([]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
      repositoryScope: {
        unindexedRegistered: [{ name: 'api-docs', reason: 'registered but not in the current index' }],
        unregisteredCandidates: ['services/legacy'],
      },
    });
    const limitations = breakdown.scope.limitations.join(' ');
    expect(limitations).toContain("Registered repository 'api-docs' was not indexed");
    expect(limitations).toContain('services/legacy');
    expect(breakdown.confidence?.level).toBe('low');
    expect(breakdown.confidence?.reasons.join(' ')).toContain('api-docs');
  });

  it('states edge-change truncation as a limitation and lowers confidence to limited', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/renderer.ts'], {
        edgeChanges: { added: [], removed: [], omittedAdded: 5 },
      }),
      analysis: analysis([]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
      repositoryScope: { unindexedRegistered: [], unregisteredCandidates: [] },
    });
    expect(breakdown.scope.limitations.join(' ')).toContain('truncated');
    expect(breakdown.confidence?.level).toBe('limited');
  });

  it('reports high confidence, with a stated reason, when nothing degrades the review', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/renderer.ts'], {
        findings: [findingOf('matched', 'file:src/renderer.ts')],
      }),
      analysis: analysis([impact('file:src/renderer.ts', 'required')]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
      repositoryScope: { unindexedRegistered: [], unregisteredCandidates: [] },
    });
    expect(breakdown.confidence?.level).toBe('high');
    expect(breakdown.confidence?.reasons.length).toBeGreaterThan(0);
  });

  it('lowers confidence to low when unverifiable findings reach half of all findings', () => {
    const breakdown = buildReviewBreakdown({
      review: review(['src/renderer.ts'], {
        findings: [
          findingOf('matched', 'file:src/renderer.ts'),
          findingOf('unverifiable', 'topic:deal-updated'),
        ],
      }),
      analysis: analysis([]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
      repositoryScope: { unindexedRegistered: [], unregisteredCandidates: [] },
    });
    expect(breakdown.confidence?.level).toBe('low');
    expect(breakdown.confidence?.reasons.join(' ')).toContain('unverifiable');
  });

  it('treats unknown repository-registration state as a stated limitation, not silence', () => {
    const breakdown = buildReviewBreakdown({
      review: review([]),
      analysis: analysis([]),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [],
    });
    expect(breakdown.scope.limitations.join(' ')).toContain('registered-repository index state');
    expect(breakdown.confidence?.level).toBe('limited');
  });
});

describe('buildReviewBreakdown over an unapproved baseline (PRD §24/§40.3)', () => {
  it('caps confidence at limited and states the limitation for a never-approved baseline', () => {
    // this input is otherwise pristine — the SAME input with an approved baseline scores 'high'
    const pristine = {
      review: review(['src/renderer.ts'], {
        findings: [findingOf('matched', 'file:src/renderer.ts')],
      }),
      specification: specification(),
      currentGraph: graph(NODES),
      addedPaths: [] as readonly string[],
      repositoryScope: { unindexedRegistered: [], unregisteredCandidates: [] },
    };
    const approved = buildReviewBreakdown({
      ...pristine,
      analysis: analysis([impact('file:src/renderer.ts', 'required')]),
    });
    expect(approved.confidence?.level).toBe('high');

    const provisional = buildReviewBreakdown({
      ...pristine,
      analysis: analysis([impact('file:src/renderer.ts', 'required')], 'draft'),
    });
    expect(provisional.confidence?.level).toBe('limited');
    expect(provisional.confidence?.reasons.join(' ')).toContain('was never approved');
    expect(provisional.scope.limitations.join(' ')).toContain(
      "Baseline analysis 'analysis-1' was never approved — findings compare the implementation against a draft prediction, not a committed plan.",
    );
    // the approved run carries neither the limitation nor the reason — byte-identical to before
    expect(approved.scope.limitations.join(' ')).not.toContain('was never approved');
  });
});
