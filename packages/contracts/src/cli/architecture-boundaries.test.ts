import { describe, expect, it } from 'vitest';

import { cliImpactSummarySchema } from './impact-summary.js';
import { cliArchitectureOutputSchema } from './outputs.js';

// Dogfooding item 6 — the boundary blocks on the architecture document and the repository
// dimension on analyze counts. All additive v1: a v1 reader ignoring the new optional fields
// still validates, and a producer with nothing declared/registered omits them entirely.

const minimalArchitecture = {
  schemaVersion: 1,
  command: 'architecture',
  snapshotId: 'snap-1',
  workspaces: [],
  packages: [{ name: 'api', fileCount: 3 }],
  nodeCountsByType: { file: 3 },
  edgeCountsByType: { IMPORTS: 2 },
  totalNodes: 3,
  totalEdges: 2,
};

describe('cliArchitectureOutputSchema boundary blocks (item 6)', () => {
  it('still accepts the prior shape without any boundary block', () => {
    expect(cliArchitectureOutputSchema.parse(minimalArchitecture)).toEqual(minimalArchitecture);
  });

  it('accepts declared contexts, repositories, cross-repository edges, integration points and contracts', () => {
    const document = {
      ...minimalArchitecture,
      contexts: [
        { name: 'deals', memberCount: 12, samplePaths: ['src/deals/service.ts'] },
        { name: 'billing', memberCount: 0 },
      ],
      repositories: [
        { name: '(workspace root)', nodeCount: 40, fileCount: 20 },
        { name: 'billing', nodeCount: 12, fileCount: 6 },
      ],
      crossRepositoryEdges: {
        count: 3,
        samples: [
          {
            from: 'sym:deal-service',
            to: 'sym:billing-api',
            type: 'CALLS',
            repositories: ['(workspace root)', 'billing'],
          },
        ],
      },
      integrationPoints: { topic: 2, webhook: 1, 'unresolved-external-boundary': 1 },
      contracts: [{ name: 'billing-api', type: 'openapi-document', path: 'docs/billing.yml' }],
    };
    expect(cliArchitectureOutputSchema.parse(document)).toEqual(document);
  });

  it('requires exactly two owning repositories on a cross-repository sample', () => {
    const document = {
      ...minimalArchitecture,
      crossRepositoryEdges: {
        count: 1,
        samples: [{ from: 'a', to: 'b', type: 'CALLS', repositories: ['(workspace root)'] }],
      },
    };
    expect(cliArchitectureOutputSchema.safeParse(document).success).toBe(false);
  });
});

const minimalSummary = {
  schemaVersion: 1,
  command: 'analyze',
  analysis: {
    id: 'a-1',
    snapshotId: 's-1',
    status: 'draft',
    provisional: false,
    provisionalReasons: [],
  },
  specification: { id: 'sp-1', version: 1, title: 't', extractionMode: 'unchanged' },
  freshness: { state: 'current', stale: false, reasons: [] },
  coverage: {
    requirementCount: 0,
    requirementsWithStructuralImpact: 0,
    indexWarnings: {
      totalCount: 0,
      coverageLosingCount: 0,
      affectsPredictedArea: false,
      groups: [],
    },
  },
  counts: { totalImpacts: 0, componentCount: 0, byLikelihood: {}, byEvidenceType: {} },
  topImpacts: [],
  unmatchedRequirements: [],
  unresolvedConcepts: [],
  blockingQuestions: [],
  nonGoalContradictions: [],
  predictedArtifacts: [],
  warnings: [],
  omittedWarningCount: 0,
  pagination: { returned: 0, totalMatching: 0, appliedFilters: {} },
  impactQuery: {
    status: 'completed-empty',
    scope: 'the indexed graph',
    limitations: [],
    resultCount: 0,
  },
  followUp: [],
};

describe('analyze counts.byRepository (item 6)', () => {
  it('still accepts counts without the repository dimension', () => {
    expect(cliImpactSummarySchema.safeParse(minimalSummary).success).toBe(true);
  });

  it('accepts distinct impacted components per repository', () => {
    const summary = {
      ...minimalSummary,
      counts: {
        ...minimalSummary.counts,
        byRepository: { '(workspace root)': 3, billing: 2 },
      },
    };
    expect(cliImpactSummarySchema.safeParse(summary).success).toBe(true);
  });
});
