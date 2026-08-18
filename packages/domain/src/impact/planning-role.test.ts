import { describe, expect, it } from 'vitest';

import { derivePlanningRole, summarisePlanningRoles } from './planning-role.js';

import type { PlanningRoleInput } from './planning-role.js';

const input = (overrides: Partial<PlanningRoleInput> = {}): PlanningRoleInput => ({
  likelihood: 'possible',
  evidenceTypes: ['transitive-structural'],
  evidenceProvenance: 'TRANSITIVE',
  impactType: 'domain-model',
  changeExpectation: 'must-change',
  directness: 'indirect',
  ...overrides,
});

describe('derivePlanningRole', () => {
  it('keeps plain reachability out of the plan', () => {
    const verdict = derivePlanningRole(input());
    expect(verdict.role).toBe('dependency-context');
    expect(verdict.rule).toBe('reachable-only');
  });

  it('files a required structural finding as a planning impact', () => {
    const verdict = derivePlanningRole(
      input({
        likelihood: 'required',
        evidenceTypes: ['direct-structural'],
        evidenceProvenance: 'INDEPENDENTLY_DISCOVERED',
      }),
    );
    expect(verdict.role).toBe('planning-impact');
    expect(verdict.rule).toBe('structural-obligation');
  });

  it('promotes a merely-possible finding that crossed an async boundary', () => {
    const verdict = derivePlanningRole(
      input({ evidenceTypes: ['async-event'], evidenceProvenance: 'STRUCTURALLY_INFERRED' }),
    );
    expect(verdict.role).toBe('planning-impact');
    expect(verdict.rule).toBe('architectural-consequence');
  });

  it('promotes a merely-possible finding that reached a contract-bearing surface', () => {
    const verdict = derivePlanningRole(input({ impactType: 'api-contract' }));
    expect(verdict.role).toBe('planning-impact');
    expect(verdict.rule).toBe('architectural-consequence');
  });

  it('does not promote a reached read-model or test surface', () => {
    for (const impactType of ['read-model', 'testing', 'documentation', 'domain-model'] as const) {
      expect(derivePlanningRole(input({ impactType })).role).toBe('dependency-context');
    }
  });

  it('files a name resemblance REACHED by traversal as a lead however strong the tier', () => {
    const verdict = derivePlanningRole(
      input({
        likelihood: 'likely',
        evidenceTypes: ['name-similarity'],
        impactType: 'api-contract',
      }),
    );
    expect(verdict.role).toBe('investigation-lead');
    expect(verdict.rule).toBe('resemblance-only');
  });

  /**
   * The engine's best reading of WHAT the requirement is about. Hiding it leaves the reader an
   * empty plan and nothing to correct, so it stays — on its own rule, and saying it is a guess.
   */
  it('keeps a resemblance-resolved SUBJECT in the plan, labelled as a guess', () => {
    const verdict = derivePlanningRole(
      input({
        likelihood: 'likely',
        evidenceTypes: ['name-similarity'],
        directness: 'direct',
      }),
    );
    expect(verdict.role).toBe('planning-impact');
    expect(verdict.rule).toBe('resolved-by-resemblance');
    expect(verdict.reason).toContain('confirm the name');
  });

  it('does not keep a resemblance-resolved subject that only reached `possible`', () => {
    expect(
      derivePlanningRole(input({ evidenceTypes: ['semantic-match'], directness: 'direct' })).role,
    ).toBe('investigation-lead');
  });

  it('never keeps a text-overlap match, even as the subject', () => {
    expect(
      derivePlanningRole(
        input({
          likelihood: 'lexical-only',
          evidenceTypes: ['lexical-only'],
          directness: 'direct',
        }),
      ).role,
    ).toBe('investigation-lead');
  });

  it('keeps a component the specification named in the plan even on a weak basis', () => {
    const verdict = derivePlanningRole(
      input({
        likelihood: 'likely',
        evidenceTypes: ['name-similarity'],
        evidenceProvenance: 'USER_SUPPLIED',
      }),
    );
    expect(verdict.role).toBe('planning-impact');
    expect(verdict.rule).toBe('named-by-specification');
  });

  it('keeps a regression boundary in the plan whatever its tier', () => {
    const verdict = derivePlanningRole(
      input({ likelihood: 'unlikely', changeExpectation: 'preserve' }),
    );
    expect(verdict.role).toBe('planning-impact');
    expect(verdict.rule).toBe('regression-boundary');
  });

  it('keeps constraint- and runtime-derived findings in the plan', () => {
    for (const evidenceProvenance of ['CONSTRAINT_DERIVED', 'RUNTIME_DERIVED'] as const) {
      const verdict = derivePlanningRole(input({ evidenceProvenance }));
      expect(verdict.role).toBe('planning-impact');
      expect(verdict.rule).toBe('adversarially-derived');
    }
  });

  it('files an excluded component as auditable context, never as a lead', () => {
    const verdict = derivePlanningRole(input({ likelihood: 'excluded' }));
    expect(verdict.role).toBe('dependency-context');
    expect(verdict.rule).toBe('non-goal-excluded');
  });

  it('demotes an unlikely finding even on a boundary basis', () => {
    expect(
      derivePlanningRole(input({ likelihood: 'unlikely', evidenceTypes: ['async-event'] })).role,
    ).toBe('dependency-context');
  });

  it('always states a reason a reader can disagree with', () => {
    expect(derivePlanningRole(input()).reason.length).toBeGreaterThan(20);
  });
});

describe('summarisePlanningRoles', () => {
  it('reports the share of the analysis that is a planning decision', () => {
    const signal = summarisePlanningRoles([
      'planning-impact',
      'dependency-context',
      'dependency-context',
      'investigation-lead',
    ]);
    expect(signal.planningImpactCount).toBe(1);
    expect(signal.dependencyContextCount).toBe(2);
    expect(signal.investigationLeadCount).toBe(1);
    expect(signal.planningShare).toBe(0.25);
    expect(signal.statement).toContain('1 of 4');
  });

  it('says so plainly when there is nothing to prioritise', () => {
    const signal = summarisePlanningRoles([]);
    expect(signal.planningShare).toBe(0);
    expect(signal.statement).toContain('no impacts');
  });
});
