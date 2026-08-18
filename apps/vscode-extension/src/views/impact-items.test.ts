import { describe, expect, it } from 'vitest';

import { buildImpactItems, impactHeadline } from './impact-items.js';
import { buildReviewItems } from './review-items.js';

import type { CliAnalyzeOutput, CliReviewOutput } from '@impactgraph/contracts';

const analyzeDoc: CliAnalyzeOutput = {
  schemaVersion: 1,
  command: 'analyze',
  specification: {
    id: 'spec-feature',
    version: 1,
    title: 'Deal filtering',
    extractionMode: 'deterministic-fallback',
  },
  analysis: { id: 'analysis-1', snapshotId: 'snap-1', status: 'draft', impactCount: 2 },
  requirements: [
    {
      id: 'req-1',
      statement: 'DealService must filter expired deals.',
      impacts: [
        {
          nodeId: 'sym:service',
          name: 'DealService',
          likelihood: 'required',
          impactType: 'business-rule',
          directness: 'direct',
          confidence: 0.9,
          dependencyPath: ['sym:service'],
          evidenceFiles: ['src/services/deal-service.ts'],
          provenance: 'static-analysis',
          planningRole: 'planning-impact',
          planningRoleRule: 'structural-obligation',
        },
        {
          nodeId: 'sym:base',
          name: 'BaseService',
          likelihood: 'likely',
          impactType: 'business-rule',
          directness: 'indirect',
          confidence: 0.6,
          dependencyPath: ['sym:service', 'sym:base'],
          evidenceFiles: ['src/services/base-service.ts'],
          provenance: 'static-analysis',
          planningRole: 'dependency-context',
          planningRoleRule: 'reachable-only',
        },
      ],
      openQuestions: [],
    },
  ],
  warnings: [],
};

describe('impact tree mapping (Story 9.2, §18.3/§37)', () => {
  /**
   * ADR-0025: role buckets sit ABOVE the likelihood buckets. Nothing is hidden — the reachable
   * neighbour still has its row — but a reader expands decisions before neighbourhoods.
   */
  it('builds requirement → role bucket → likelihood bucket → impact with text-only indicators', () => {
    const roots = buildImpactItems(analyzeDoc);
    expect(roots).toHaveLength(1);
    const roles = roots[0]?.children ?? [];
    expect(roles.map((bucket) => bucket.label)).toEqual([
      'Planning impacts',
      'Dependency context (reachable, no evidence of impact)',
    ]);
    const buckets = roles[0]?.children ?? [];
    expect(buckets.map((bucket) => bucket.label)).toEqual(['required']);
    const impact = buckets[0]?.children[0];
    expect(impact?.label).toBe('DealService');
    // §37: likelihood, type, confidence, provenance and the deciding rule are text, not color
    expect(impact?.description).toBe(
      'required · business-rule · 0.90 · static-analysis · structural-obligation',
    );
    expect(impact?.impactRef).toEqual({
      analysisId: 'analysis-1',
      requirementId: 'req-1',
      nodeId: 'sym:service',
      name: 'DealService',
    });
  });

  it('exposes dependency path and clickable evidence as detail children (§18.5)', () => {
    const impact = buildImpactItems(analyzeDoc)[0]?.children[1]?.children[0]?.children[0];
    const labels = impact?.children.map((child) => child.label) ?? [];
    expect(labels.some((label) => label.startsWith('via: sym:service → sym:base'))).toBe(true);
    const file = impact?.children.find((child) => child.kind === 'file');
    expect(file?.filePath).toBe('src/services/base-service.ts');
  });

  it('headline names the spec version, analysis id, and status', () => {
    expect(impactHeadline(analyzeDoc)).toContain('analysis-1');
    expect(impactHeadline(analyzeDoc)).toContain('draft');
  });

  it('likelihood and impact-type filters hide non-matching impacts (§40.4)', () => {
    const filtered = buildImpactItems(analyzeDoc, { likelihoods: ['required'] });
    const roles = filtered[0]?.children ?? [];
    expect(roles.map((bucket) => bucket.label)).toEqual(['Planning impacts']);
    expect(roles[0]?.children.map((bucket) => bucket.label)).toEqual(['required']);
    expect(filtered[0]?.description).toBe('1 impact(s)');

    const none = buildImpactItems(analyzeDoc, { impactTypes: ['migration'] });
    expect(none[0]?.children).toEqual([]);
  });

  it('impact-type grouping projects the same impacts under sorted type buckets', () => {
    const grouped = buildImpactItems(analyzeDoc, { grouping: 'impact-type' });
    expect(grouped.map((bucket) => bucket.label)).toEqual(['business-rule']);
    expect(grouped[0]?.children.map((impact) => impact.label)).toEqual([
      'DealService',
      'BaseService',
    ]);
    // decision refs survive regrouping so accept/reject keeps working
    expect(grouped[0]?.children[0]?.impactRef?.requirementId).toBe('req-1');
  });
});

const reviewDoc: CliReviewOutput = {
  schemaVersion: 1,
  command: 'review',
  analysis: {
    id: 'analysis-1',
    specificationId: 'spec-feature',
    specificationVersion: 1,
    approvedSnapshotId: 'snap-1',
  },
  target: 'working-tree',
  reviewSnapshotId: 'snap-2',
  changedFiles: ['src/services/deal-service.ts', 'src/rogue.ts'],
  findings: [
    {
      category: 'matched',
      nodeId: 'sym:service',
      nodeName: 'DealService',
      requirementId: 'req-1',
      explanation: 'Predicted required impact changed.',
      filePaths: ['src/services/deal-service.ts'],
    },
    {
      category: 'unexpected',
      nodeId: 'file:src/rogue.ts',
      nodeName: 'rogue.ts',
      explanation: 'not part of the approved analysis',
      filePaths: ['src/rogue.ts'],
    },
  ],
  coverage: [
    {
      requirementId: 'req-1',
      statement: 'DealService must filter expired deals.',
      status: 'implemented',
      evidence: [{ marker: 'confirmed', note: 'DealService changed as predicted' }],
    },
  ],
  edgeChanges: { added: [], removed: [] },
  ruleViolations: [
    {
      ruleId: 'schema-needs-migration',
      message: 'schema changed without migration',
      filePaths: ['prisma/schema.prisma'],
    },
  ],
  discrepanciesFound: true,
};

describe('review tree mapping (Story 11.4, §18.7/§43.6)', () => {
  it('leads with human-judgment wording, groups findings by category, and lists violations', () => {
    const roots = buildReviewItems(reviewDoc);
    expect(roots[0]?.label).toContain('human judgment');
    const categories = roots.filter((node) => node.kind === 'category').map((node) => node.label);
    expect(categories).toEqual(['matched', 'unexpected']);
    const violations = roots.find((node) => node.label === 'Rule violations');
    expect(violations?.children[0]?.label).toBe('schema-needs-migration');
  });

  it('coverage renders as an estimate with ✓/✕/? marker lines (§25)', () => {
    const roots = buildReviewItems(reviewDoc);
    const coverage = roots.find((node) => node.label.includes('estimate'));
    const requirement = coverage?.children[0];
    expect(requirement?.label).toBe('req-1: implemented');
    expect(requirement?.children[0]?.label).toContain('✓');
  });

  it('finding files are clickable navigation targets', () => {
    const roots = buildReviewItems(reviewDoc);
    const matched = roots.find((node) => node.label === 'matched');
    expect(matched?.children[0]?.children[0]?.filePath).toBe('src/services/deal-service.ts');
  });
});
