import { describe, expect, it } from 'vitest';

import { MCP_SERVER_INSTRUCTIONS } from '../tools/guidance.js';
import { MCP_TOOL_CONTRACTS } from '../tools/tools.js';

import {
  cliImpactSummarySchema,
  requiredActionSchema,
  workspaceCoverageSchema,
} from './impact-summary.js';
import { cliIndexOutputSchema, cliStatusOutputSchema } from './outputs.js';

const coverage = {
  status: 'insufficient-coverage',
  reasons: ['9 of 10 requirements match no indexed component — missing repositories are likely.'],
  repositories: {
    indexed: [{ name: '(workspace root)', fileCount: 120 }],
    registeredButMissing: [{ name: 'billing', reason: 'the declared path does not exist on disk' }],
    candidates: [
      { name: 'web', path: 'web', hint: 'contains a git repository but is not registered' },
    ],
  },
  affectedRequirementIds: ['req-1'],
  affectedConcepts: ['BillingService'],
};

const action = {
  action: 'register-missing-repositories',
  reason: "the registered repository 'billing' is not on disk",
  instruction: 'Ask the user for the repository location, then register it and re-run analyze.',
  repositories: ['billing'],
};

const minimalSummary = {
  schemaVersion: 1,
  command: 'analyze',
  analysis: { id: 'a-1', snapshotId: 's-1', status: 'draft', provisional: false, provisionalReasons: [] },
  specification: { id: 'sp-1', version: 1, title: 't', extractionMode: 'unchanged' },
  freshness: { state: 'current', stale: false, reasons: [] },
  coverage: {
    requirementCount: 0,
    requirementsWithStructuralImpact: 0,
    indexWarnings: { totalCount: 0, coverageLosingCount: 0, affectsPredictedArea: false, groups: [] },
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
  impactQuery: { status: 'completed-empty', scope: 'the graph', limitations: [], resultCount: 0 },
  followUp: [],
};

describe('workspace coverage contracts', () => {
  it('accepts a full coverage block and rejects unknown keys', () => {
    expect(workspaceCoverageSchema.safeParse(coverage).success).toBe(true);
    expect(workspaceCoverageSchema.safeParse({ ...coverage, extra: 1 }).success).toBe(false);
    expect(workspaceCoverageSchema.safeParse({ ...coverage, status: 'fine' }).success).toBe(false);
  });

  it('required actions carry a closed action vocabulary', () => {
    expect(requiredActionSchema.safeParse(action).success).toBe(true);
    for (const name of [
      'refresh-stale-index',
      'index-registered-repositories',
      'register-missing-repositories',
      'confirm-candidate-repositories',
      'report-limited-scope',
    ]) {
      expect(requiredActionSchema.safeParse({ ...action, action: name }).success).toBe(true);
    }
    expect(requiredActionSchema.safeParse({ ...action, action: 'do-something' }).success).toBe(
      false,
    );
  });

  it('the bounded summary accepts the additive coverage fields (v1, optional)', () => {
    expect(cliImpactSummarySchema.safeParse(minimalSummary).success).toBe(true);
    expect(
      cliImpactSummarySchema.safeParse({
        ...minimalSummary,
        workspaceCoverage: coverage,
        requiredActions: [action],
      }).success,
    ).toBe(true);
  });

  it('index and status outputs report per-repository state (additive v1)', () => {
    const repositories = [
      { name: '(workspace root)', indexed: true, fileCount: 100 },
      { name: 'billing', path: 'billing', indexed: false, fileCount: 0, reason: 'absent' },
    ];
    expect(
      cliIndexOutputSchema.safeParse({
        schemaVersion: 1,
        command: 'index',
        snapshot: { id: 's', commitSha: 'c', dirtyWorkingTree: false, createdAt: 'now' },
        fileCount: 1,
        changedFileCount: 1,
        reusedFileCount: 0,
        ignoredCount: 0,
        nodeCount: 1,
        edgeCount: 0,
        warnings: [],
        repositories,
      }).success,
    ).toBe(true);
    expect(
      cliStatusOutputSchema.safeParse({
        schemaVersion: 1,
        command: 'status',
        initialized: true,
        indexed: true,
        repositories,
        candidateRepositories: coverage.repositories.candidates,
      }).success,
    ).toBe(true);
  });

  it('the server instructions state the coverage-first workflow unambiguously', () => {
    for (const term of [
      'get_workspace_status',
      'index_workspace',
      'find_components',
      'analyze_impact',
      'insufficient-coverage',
      'requiredActions',
      'limitations',
    ]) {
      expect(MCP_SERVER_INSTRUCTIONS).toContain(term);
    }
  });

  it('tool descriptions surface coverage validation and multi-repository indexing', () => {
    expect(MCP_TOOL_CONTRACTS.analyze_impact.description).toContain('insufficient-coverage');
    expect(MCP_TOOL_CONTRACTS.analyze_impact.description).toContain('requiredActions');
    expect(MCP_TOOL_CONTRACTS.index_workspace.description).toContain('registered');
    expect(MCP_TOOL_CONTRACTS.get_workspace_status.description).toContain('repositor');
  });
});
