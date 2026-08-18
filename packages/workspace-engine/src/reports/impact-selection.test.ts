import { describe, expect, it } from 'vitest';

import { byStrength, cursorFor, DEFAULT_TOP_N, selectImpacts } from './impact-selection.js';

import type {
  ImpactAnalysis,
  ImpactEvidenceType,
  ImpactLikelihood,
  RequirementImpact,
} from '@impactgraph/domain';

// The selection rules the trials made necessary (item 9 + item 4): structural findings first,
// lexical-only and excluded hidden by default, and the applied defaults echoed back so "20
// impacts" is distinguishable from "20 impacts, 300 withheld". ADR-0025 added the role gate: the
// default answer is the planning decisions, and reachable-only components page separately.

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
  confidence: 0.5,
  confidenceSignals: [{ type: 'semantic-concept-match', contribution: 0.5 }],
  explanation: 'fixture',
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

describe('selectImpacts — defaults', () => {
  const analysis = analysisWith([
    impact('sym:req', 'required', ['direct-structural']),
    impact('sym:lex', 'lexical-only', ['lexical-only']),
    impact('sym:exc', 'excluded', ['direct-structural']),
    impact('sym:unl', 'unlikely', ['transitive-structural']),
    impact('sym:pos', 'possible', ['transitive-structural']),
  ]);

  it('hides lexical-only, excluded, sub-possible tiers and reachable-only context by default', () => {
    const selection = selectImpacts(analysis);
    // `sym:pos` is a possible transitive hit on an ordinary domain-model surface — reachable, with
    // nothing establishing that it changes. ADR-0025 files it as dependency context.
    expect(selection.impacts.map((entry) => entry.nodeId)).toEqual(['sym:req']);
    expect(selection.totalMatching).toBe(1);
  });

  it('returns reachable-only context when the caller asks for that role', () => {
    const selection = selectImpacts(analysis, { roles: ['dependency-context'] });
    expect(selection.impacts.map((entry) => entry.nodeId)).toEqual(['sym:pos']);
  });

  it('promotes a possible finding that reached a contract-bearing surface', () => {
    const consequence = analysisWith([
      impact('sym:api', 'possible', ['transitive-structural'], { impactType: 'api-contract' }),
    ]);
    expect(selectImpacts(consequence).impacts.map((entry) => entry.nodeId)).toEqual(['sym:api']);
  });

  it('echoes the roles it applied, so a caller cannot mistake the default for everything', () => {
    expect(selectImpacts(analysis).appliedFilters.roles).toEqual(['planning-impact']);
  });

  it('echoes the defaults it applied, even when the caller set nothing', () => {
    const selection = selectImpacts(analysis);
    expect(selection.appliedFilters).toMatchObject({
      topN: DEFAULT_TOP_N,
      minLikelihood: 'possible',
      includeLexicalOnly: false,
      includeExcluded: false,
    });
  });

  it('returns the hidden tiers only on explicit opt-in', () => {
    const withLexical = selectImpacts(analysis, { includeLexicalOnly: true });
    expect(withLexical.impacts.some((entry) => entry.nodeId === 'sym:lex')).toBe(true);
    const withExcluded = selectImpacts(analysis, { includeExcluded: true });
    expect(withExcluded.impacts.some((entry) => entry.nodeId === 'sym:exc')).toBe(true);
  });
});

describe('byStrength — ordering', () => {
  it('orders by tier first: a required impact beats a stronger-based possible one', () => {
    const requiredTransitive = impact('sym:a', 'required', ['transitive-structural']);
    const possibleDirect = impact('sym:b', 'possible', ['direct-structural']);
    expect(byStrength(requiredTransitive, possibleDirect)).toBeLessThan(0);
  });

  it('breaks tier ties by evidence strength, then confidence, then node id', () => {
    const direct = impact('sym:z', 'likely', ['direct-structural']);
    const fuzzy = impact('sym:a', 'likely', ['name-similarity']);
    expect(byStrength(direct, fuzzy)).toBeLessThan(0);

    const confident = impact('sym:z', 'likely', ['direct-structural'], { confidence: 0.9 });
    const hesitant = impact('sym:a', 'likely', ['direct-structural'], { confidence: 0.4 });
    expect(byStrength(confident, hesitant)).toBeLessThan(0);

    const tieA = impact('sym:a', 'likely', ['direct-structural']);
    const tieB = impact('sym:b', 'likely', ['direct-structural']);
    expect(byStrength(tieA, tieB)).toBeLessThan(0);
  });

  it('ranks name-similarity below structural bases and above semantic and lexical', () => {
    const fuzzy = impact('sym:a', 'likely', ['name-similarity']);
    const transitive = impact('sym:b', 'likely', ['transitive-structural']);
    const semantic = impact('sym:c', 'likely', ['semantic-match']);
    expect(byStrength(transitive, fuzzy)).toBeLessThan(0);
    expect(byStrength(fuzzy, semantic)).toBeLessThan(0);
  });
});

describe('byStrength — provenance tiebreak (ADR-0017 §5)', () => {
  it('at equal tier and basis, a discovery outranks a specification echo — even a more confident one', () => {
    // The echo wins BOTH later comparators (higher confidence, earlier node id); only the
    // provenance tiebreak can put the discovery first, which is exactly what this pins.
    const echo = impact('sym:a-echo', 'required', ['direct-structural'], {
      evidenceProvenance: 'USER_SUPPLIED',
      confidence: 0.95,
    });
    const found = impact('sym:b-found', 'required', ['direct-structural'], {
      evidenceProvenance: 'INDEPENDENTLY_DISCOVERED',
      confidence: 0.6,
    });
    expect(byStrength(found, echo)).toBeLessThan(0);
    const selected = selectImpacts(analysisWith([echo, found]));
    expect(selected.impacts.map((entry) => entry.nodeId)).toEqual(['sym:b-found', 'sym:a-echo']);
  });

  it('never crosses tier or basis: a required echo still beats a likely discovery', () => {
    const requiredEcho = impact('sym:echo', 'required', ['direct-structural'], {
      evidenceProvenance: 'USER_SUPPLIED',
    });
    const likelyFound = impact('sym:found', 'likely', ['direct-structural'], {
      evidenceProvenance: 'INDEPENDENTLY_DISCOVERED',
    });
    expect(byStrength(requiredEcho, likelyFound)).toBeLessThan(0);

    const directEcho = impact('sym:echo', 'likely', ['direct-structural'], {
      evidenceProvenance: 'USER_SUPPLIED',
    });
    const asyncFound = impact('sym:found', 'likely', ['async-event'], {
      evidenceProvenance: 'INDEPENDENTLY_DISCOVERED',
    });
    expect(byStrength(directEcho, asyncFound)).toBeLessThan(0);
  });

  it('legacy analyses without provenance are untouched — confidence still decides the tie', () => {
    const confident = impact('sym:z', 'likely', ['direct-structural'], { confidence: 0.9 });
    const hesitant = impact('sym:a', 'likely', ['direct-structural'], { confidence: 0.4 });
    expect(byStrength(confident, hesitant)).toBeLessThan(0);
  });
});

describe('selectImpacts — filters and paging', () => {
  const analysis = analysisWith([
    impact('sym:a', 'required', ['direct-structural']),
    impact('sym:b', 'likely', ['async-event']),
    // A `possible` migration: reachable, and the surface reached carries a contract, so ADR-0025
    // keeps it in the plan. Chosen deliberately so paging is still tested over three roles-in.
    impact('sym:c', 'possible', ['transitive-structural'], { impactType: 'migration' }),
  ]);

  it('keeps only impacts at or above minLikelihood', () => {
    const selection = selectImpacts(analysis, { minLikelihood: 'likely' });
    expect(selection.impacts.map((entry) => entry.nodeId)).toEqual(['sym:a', 'sym:b']);
  });

  it('keeps only impacts carrying one of the requested evidence types', () => {
    const selection = selectImpacts(analysis, { evidenceTypes: ['async-event'] });
    expect(selection.impacts.map((entry) => entry.nodeId)).toEqual(['sym:b']);
  });

  it('keeps only impacts of the requested requirement', () => {
    const mixed = analysisWith([
      impact('sym:a', 'required', ['direct-structural']),
      impact('sym:b', 'required', ['direct-structural'], { requirementId: 'req-2' }),
    ]);
    const selection = selectImpacts(mixed, { requirementId: 'req-2' });
    expect(selection.impacts.map((entry) => entry.nodeId)).toEqual(['sym:b']);
  });

  it('pages with a stable cursor and reports the true total', () => {
    const first = selectImpacts(analysis, { topN: 2 });
    expect(first.impacts).toHaveLength(2);
    expect(first.totalMatching).toBe(3);
    const lastReturned = first.impacts[1];
    expect(lastReturned).toBeDefined();
    expect(first.nextCursor).toBe(lastReturned === undefined ? '' : cursorFor(lastReturned));
    const second = selectImpacts(analysis, { topN: 2, cursor: first.nextCursor });
    expect(second.impacts.map((entry) => entry.nodeId)).toEqual(['sym:c']);
    expect(second.nextCursor).toBeUndefined();
  });
});
