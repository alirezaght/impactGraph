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
// impacts" is distinguishable from "20 impacts, 300 withheld".

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

  it('hides lexical-only, excluded, and sub-possible tiers by default', () => {
    const selection = selectImpacts(analysis);
    expect(selection.impacts.map((entry) => entry.nodeId)).toEqual(['sym:req', 'sym:pos']);
    expect(selection.totalMatching).toBe(2);
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
    impact('sym:c', 'possible', ['transitive-structural']),
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
