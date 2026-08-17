import { createPreflightFinding } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { collapseAnalysisCaveats, collapseCaveatSpread } from './collapse-caveats.js';

import type { PreflightFinding } from '@impactgraph/domain';

const caveat = (pathId: string, overrides: Partial<PreflightFinding> = {}): PreflightFinding => {
  const result = createPreflightFinding({
    id: `finding-${pathId}`,
    kind: 'runtime-topology-gap',
    severity: 'warning',
    origin: 'analysis-caveat',
    verification: 'unverified-assumption',
    requirementIds: [],
    statement: `ImpactGraph could not resolve the runtime path ${pathId}.`,
    recommendation: 'Confirm by hand which process serves this traffic.',
    subject: { runtimePathId: pathId },
    evidenceIds: ['ev-1'],
    confidence: 0.5,
    provenance: 'static-analysis',
    analyzer: 'check-runtime',
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`invalid fixture: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const planFinding = (requirementId: string): PreflightFinding => {
  const result = createPreflightFinding({
    id: `plan-${requirementId}`,
    kind: 'invalid-assumption',
    severity: 'warning',
    verification: 'unverified-assumption',
    requirementIds: [requirementId],
    statement: `${requirementId} assumes something unproven.`,
    recommendation: 'Check it.',
    subject: { assumedSymbol: 'Foo.bar' },
    evidenceIds: ['ev-1'],
    confidence: 0.6,
    provenance: 'static-analysis',
    analyzer: 'check-assumptions',
  });
  if (!result.ok) {
    throw new Error('invalid fixture');
  }
  return result.value;
};

describe('collapseAnalysisCaveats', () => {
  it('reports one caveat per repository subject, not one per occurrence', () => {
    const collapsed = collapseAnalysisCaveats([
      caveat('path-1'),
      caveat('path-1'),
      caveat('path-2'),
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((entry) => entry.statement.includes('2 paths share'))).toBeDefined();
  });

  it('never merges findings about the plan — a defect per requirement is a defect per requirement', () => {
    const collapsed = collapseAnalysisCaveats([planFinding('R1'), planFinding('R2')]);

    expect(collapsed).toHaveLength(2);
  });
});

describe('collapseCaveatSpread', () => {
  it('collapses a wide spread of the same limitation into one story', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => caveat(id));

    const collapsed = collapseCaveatSpread(many);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.statement).toContain('4 further');
    expect(collapsed[0]?.statement).toContain('not 5 risks in the plan');
  });

  it('leaves a handful of distinct caveats alone', () => {
    const few = ['a', 'b'].map((id) => caveat(id));

    expect(collapseCaveatSpread(few)).toHaveLength(2);
  });

  it('leaves plan findings untouched however many there are', () => {
    const findings = [...Array.from({ length: 6 }, (_, i) => planFinding(`R${String(i)}`))];

    expect(collapseCaveatSpread(findings)).toHaveLength(6);
  });
});
