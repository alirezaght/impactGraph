import { createGraphNode, createKnowledgeGraph, createSpecification } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { runPreflightForAnalysis } from './preflight.js';
import { buildImpactSummary } from './reports/impact-summary.js';
import {
  buildWorkspaceCoverage,
  unindexedRegisteredRepositories,
} from './reports/workspace-coverage-block.js';

import type { PreflightContext } from './preflight.js';
import type { WorkspaceRepositoryContext } from './repository-coverage.js';
import type {
  ExtractionQuality,
  ImpactAnalysis,
  KnowledgeGraph,
  RequirementImpact,
  Specification,
} from '@impactgraph/domain';

/**
 * The cross-block consistency invariant (self-run finding): a live analysis on a FULLY indexed
 * workspace classified every unmatched requirement as COVERAGE_GAP, claiming "a repository that is
 * registered but not indexed" — while the same response reported `registeredButMissing: []`. The
 * signal is a roster fact now, and these tests pin that no rationale may claim a missing
 * repository unless the repository facts show one.
 */

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-14T10:00:00.000Z',
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

const specification = (extractionQuality?: ExtractionQuality): Specification => {
  const statements = [
    'DealService validation must reject stale snapshots.',
    'Create a billing export job for finished deals.',
    'Add an audit trail entry for every export.',
    'The nightly reconciliation must run twice.',
  ];
  const created = createSpecification({
    id: 'spec-1',
    title: 'preflight fixture',
    sourceType: 'markdown',
    rawText: 'fixture',
    version: 1,
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    requirements: statements.map((statement, index) => ({
      id: `req-${String(index + 1)}`,
      statement,
      type: 'functional' as const,
      concepts: [],
      actors: [],
      status: 'draft' as const,
    })),
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
    ...(extractionQuality === undefined ? {} : { extractionQuality }),
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
  evidenceTypes: ['direct-structural'],
});

const analysis = (): ImpactAnalysis => ({
  id: 'analysis-1',
  specificationId: 'spec-1',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-14T10:00:00.000Z',
  status: 'draft',
  requirementImpacts: [impactFor('req-1')],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

const fullyIndexed: WorkspaceRepositoryContext = {
  repositories: [
    { name: '(workspace root)', indexed: true, fileCount: 40 },
    { name: 'billing', path: 'billing', indexed: true, fileCount: 12 },
  ],
  candidates: [],
  limitations: [],
};

const withMissingBilling: WorkspaceRepositoryContext = {
  repositories: [
    { name: '(workspace root)', indexed: true, fileCount: 40 },
    {
      name: 'billing',
      path: 'billing',
      indexed: false,
      fileCount: 0,
      reason: 'registered but not in the current index — run index_workspace',
      reasonCode: 'not-indexed',
    },
  ],
  candidates: [],
  limitations: [],
};

const preflightFor = (
  context: WorkspaceRepositoryContext,
  overrides: Partial<PreflightContext> = {},
) => {
  const spec = specification();
  const coverage = buildWorkspaceCoverage({
    specification: spec,
    analysis: analysis(),
    context,
    graph: graph(),
  });
  return runPreflightForAnalysis({
    rootDir: '/nonexistent-fixture-root',
    specification: spec,
    specificationText: spec.rawText,
    analysis: analysis(),
    graph: graph(),
    snapshotId: 'snap-1',
    coverageInsufficient: coverage.status === 'insufficient-coverage',
    missingRepositoryNames: unindexedRegisteredRepositories(context).map((state) => state.name),
    ...overrides,
  });
};

describe('runPreflightForAnalysis — repository facts, not reinterpreted coverage lists', () => {
  it('never claims an unindexed repository on a fully indexed workspace', () => {
    const spec = specification();
    const preflight = preflightFor(fullyIndexed);
    const summary = buildImpactSummary({
      specification: spec,
      analysis: preflight.analysis,
      graph: graph(),
      freshness: { state: 'current', stale: false, reasons: [] },
      extractionMode: 'unchanged',
      indexWarnings: [],
      workspace: fullyIndexed,
      preflight,
    });
    expect(summary.workspaceCoverage?.repositories.registeredButMissing).toEqual([]);
    // The invariant itself: nothing anywhere in the built summary may contradict that fact.
    expect(JSON.stringify(summary)).not.toContain('registered but not indexed');
    const classifications = new Map(
      preflight.classifications.map((entry) => [entry.requirementId, entry.classification]),
    );
    expect(classifications.get('req-2')).toBe('NEW_SURFACE');
    expect(classifications.get('req-3')).toBe('NEW_SURFACE');
    expect(classifications.get('req-4')).toBe('NO_EVIDENCE');
    expect([...classifications.values()]).not.toContain('COVERAGE_GAP');
  });

  it('does not call a construction-heavy specification insufficient coverage when nothing is missing', () => {
    const coverage = buildWorkspaceCoverage({
      specification: specification(),
      analysis: analysis(),
      context: fullyIndexed,
      graph: graph(),
    });
    expect(coverage.status).toBe('adequate');
  });

  it('produces the COVERAGE_GAP rationale when a registered repository IS missing from the index', () => {
    const preflight = preflightFor(withMissingBilling);
    const gap = preflight.classifications.find((entry) => entry.classification === 'COVERAGE_GAP');
    expect(gap).toBeDefined();
    expect(gap?.rationale).toContain('registered but not indexed');
  });

  it('carries the deterministic readiness score into the assessment when nothing withholds it', () => {
    const preflight = preflightFor(fullyIndexed);
    expect(preflight.assessment.score).toBeTypeOf('number');
    expect(preflight.assessment.scoreWithheldReason).toBeUndefined();
  });

  it('states the coverage reason, not "no score was supplied", when coverage withholds the score', () => {
    const preflight = preflightFor(withMissingBilling);
    expect(preflight.assessment.score).toBeUndefined();
    expect(preflight.assessment.scoreWithheldReason).toContain('coverage is insufficient');
    expect(preflight.assessment.scoreWithheldReason).not.toContain(
      'No deterministic score was supplied',
    );
  });

  it('states the provisional-extraction reason when the requirement list is the extractor’s guess', () => {
    const spec = specification({
      strategy: 'prose-fallback',
      structuredRequirementCount: 0,
      proseRequirementCount: 4,
      recognizedSections: [],
      provisional: true,
      warnings: ['prose fallback'],
    });
    const preflight = preflightFor(fullyIndexed, { specification: spec });
    expect(preflight.assessment.score).toBeUndefined();
    expect(preflight.assessment.scoreWithheldReason).toContain('extractor');
  });
});

/**
 * The invalid-assumption signal (ADR-0017 §5): a specification that says "modify services/x.py"
 * when no such file is indexed is asserting something false, and the classifier must say so —
 * while "add file foo/bar.ts" is creation, where the file is SUPPOSED to be missing.
 */
const specWithStatements = (statements: readonly string[]): Specification => {
  const created = createSpecification({
    id: 'spec-2',
    title: 'assumption fixture',
    sourceType: 'markdown',
    rawText: statements.join('\n'),
    version: 1,
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    requirements: statements.map((statement, index) => ({
      id: `req-${String(index + 1)}`,
      statement,
      type: 'functional' as const,
      concepts: [],
      actors: [],
      status: 'draft' as const,
    })),
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

describe('runPreflightForAnalysis — unresolved path-shaped identifiers (ADR-0017 §5)', () => {
  const classify = (statements: readonly string[]) => {
    const spec = specWithStatements(statements);
    const preflight = preflightFor(fullyIndexed, {
      specification: spec,
      specificationText: spec.rawText,
      // no impacts at all: every requirement is unmatched and reaches the classifier
      analysis: { ...analysis(), requirementImpacts: [] },
    });
    return new Map(
      preflight.classifications.map((entry) => [entry.requirementId, entry.classification]),
    );
  };

  it('a modification of a file that does not exist is an INVALID_ASSUMPTION', () => {
    const classifications = classify(['Modify services/x.py so it relays deal events.']);
    expect(classifications.get('req-1')).toBe('INVALID_ASSUMPTION');
  });

  it('creation language is never flagged — the file is supposed to be missing', () => {
    const classifications = classify(['Add the file foo/bar.ts with the relay handler.']);
    expect(classifications.get('req-1')).toBe('NEW_SURFACE');
  });

  it('a requirement that does not state the missing path is not blamed for it', () => {
    const classifications = classify([
      'Modify services/x.py so it relays deal events.',
      'The nightly reconciliation must run twice.',
    ]);
    expect(classifications.get('req-1')).toBe('INVALID_ASSUMPTION');
    expect(classifications.get('req-2')).toBe('NO_EVIDENCE');
  });
});
