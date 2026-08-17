import { describe, expect, it } from 'vitest';

import { createPreflightFinding, isBlocking, isPlanFinding } from './preflight-finding.js';

import type { PreflightFinding } from './preflight-finding.js';

// A false BLOCKED verdict costs more than an uncertain warning: developers who watch the gate stop
// a valid specification learn to override it, and every later legitimate block is worth less. So
// "blocking" is not a severity a producer may simply assert — it is a claim about the EVIDENCE.

const finding = (overrides: Partial<PreflightFinding> = {}): PreflightFinding => {
  const result = createPreflightFinding({
    id: 'finding-1',
    kind: 'invalid-assumption',
    severity: 'blocking',
    verification: 'verified-contradiction',
    requirementIds: ['req-1'],
    statement: 'req-1 references Foo.bar, but bar is not a member of Foo.',
    recommendation: 'Correct the specification.',
    subject: { assumedSymbol: 'Foo.bar' },
    evidenceIds: ['ev-1'],
    confidence: 0.9,
    provenance: 'static-analysis',
    analyzer: 'check-assumptions',
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`fixture invalid: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

describe('blocking requires a verified contradiction', () => {
  it('accepts a blocking finding that carries verified evidence', () => {
    expect(isBlocking(finding())).toBe(true);
  });

  it('refuses to construct a blocking finding that only failed to verify', () => {
    const result = createPreflightFinding({
      ...finding(),
      severity: 'blocking',
      verification: 'unverified-assumption',
    });

    expect(result.ok).toBe(false);
  });

  it('refuses to construct a blocking finding that is a limitation of the analysis', () => {
    const result = createPreflightFinding({
      ...finding(),
      severity: 'blocking',
      origin: 'analysis-caveat',
      verification: 'unverified-assumption',
    });

    expect(result.ok).toBe(false);
  });

  it('reads an unverified assumption as a warning, never as a block', () => {
    const unverified = finding({
      severity: 'warning',
      verification: 'unverified-assumption',
      statement: 'bar could not be verified on Foo or its resolved base types.',
    });

    expect(isBlocking(unverified)).toBe(false);
    expect(isPlanFinding(unverified)).toBe(true);
  });
});

describe('plan findings, analysis caveats and background conditions are different claims', () => {
  it('treats a finding as a plan finding by default', () => {
    expect(isPlanFinding(finding({ severity: 'warning' }))).toBe(true);
  });

  it('does not count an analysis caveat as evidence against the plan', () => {
    const caveat = finding({
      severity: 'warning',
      kind: 'runtime-topology-gap',
      origin: 'analysis-caveat',
      verification: 'unverified-assumption',
      requirementIds: [],
      statement:
        'The deployment chain stops at local.alerts_service_url — it could not be resolved.',
    });

    expect(isPlanFinding(caveat)).toBe(false);
    expect(isBlocking(caveat)).toBe(false);
  });

  it('allows a caveat to name no requirement at all', () => {
    const result = createPreflightFinding({
      ...finding(),
      severity: 'warning',
      verification: 'unverified-assumption',
      origin: 'analysis-caveat',
      requirementIds: [],
    });

    expect(result.ok).toBe(true);
  });

  // A claim about the plan has to be attributable to something a reader can open. Review-time
  // findings legitimately name only the code, so the subject counts as attribution too.
  it('still refuses a plan finding that names neither a requirement nor any code', () => {
    const result = createPreflightFinding({
      ...finding(),
      severity: 'warning',
      verification: 'unverified-assumption',
      origin: 'plan-finding',
      requirementIds: [],
      subject: {},
    });

    expect(result.ok).toBe(false);
  });

  it('accepts a plan finding attributed to code rather than to a requirement', () => {
    const result = createPreflightFinding({
      ...finding(),
      severity: 'warning',
      verification: 'unverified-assumption',
      origin: 'plan-finding',
      requirementIds: [],
      subject: { filePaths: ['src/policy.ts'] },
    });

    expect(result.ok).toBe(true);
  });
});
