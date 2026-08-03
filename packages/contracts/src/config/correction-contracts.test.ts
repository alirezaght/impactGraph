import { describe, expect, it } from 'vitest';

import { architectureConfigSchema } from './architecture-config.js';
import { componentCorrectionSchema } from './corrections.js';
import { configOperationSchema } from './operations.js';
import { CONFIG_PRECEDENCE_LEVELS, effectiveComponentSchema } from './overlay.js';

// Story 8.2/8.3 (§16, §Z5, §Z7) — the correction operation variants and the records they persist.

const REASON = 'the team calls it DealService';

describe('§16 correction operations', () => {
  it('every correction variant is also a configuration operation — one vocabulary', () => {
    const corrections = [
      { kind: 'rename-component', from: 'DealSvc', to: 'DealService', reason: REASON },
      { kind: 'assign-context', path: 'src/deals/**', context: 'deals', reason: REASON },
      { kind: 'set-component-role', path: 'src/deals/**', role: 'domain', reason: REASON },
      { kind: 'mark-component', path: 'generated/**', marker: 'generated', reason: REASON },
      {
        kind: 'set-component-owner',
        component: 'src/deals/**',
        owner: 'deals-team',
        reason: REASON,
      },
      { kind: 'set-relationship-confirmation', edgeId: 'e-1', confirmed: false, reason: REASON },
    ];
    for (const correction of corrections) {
      expect(componentCorrectionSchema.safeParse(correction).success, correction.kind).toBe(true);
      expect(configOperationSchema.safeParse(correction).success, correction.kind).toBe(true);
    }
  });

  it('operations are strict: unknown keys and a missing reason are rejected', () => {
    expect(
      componentCorrectionSchema.safeParse({
        kind: 'rename-component',
        from: 'A',
        to: 'B',
        reason: REASON,
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      componentCorrectionSchema.safeParse({ kind: 'rename-component', from: 'A', to: 'B' }).success,
    ).toBe(false);
  });

  it('the §16 marker vocabulary is closed', () => {
    const marked = (marker: string): boolean =>
      componentCorrectionSchema.safeParse({
        kind: 'mark-component',
        path: 'x/**',
        marker,
        reason: REASON,
      }).success;
    for (const marker of ['generated', 'ignored', 'infrastructure', 'shared']) {
      expect(marked(marker), marker).toBe(true);
    }
    expect(marked('domain')).toBe(false);
  });

  it('confirm and reject are the same operation with an explicit boolean', () => {
    const decision = (confirmed: unknown): boolean =>
      componentCorrectionSchema.safeParse({
        kind: 'set-relationship-confirmation',
        edgeId: 'e-1',
        confirmed,
        reason: REASON,
      }).success;
    expect(decision(true)).toBe(true);
    expect(decision(false)).toBe(true);
    // no implicit default — a decision must be stated
    expect(decision(undefined)).toBe(false);
    expect(decision('yes')).toBe(false);
  });

  it('the §16 owner vocabulary is open — a team, a handle, or a distribution list all parse', () => {
    const owned = (owner: unknown): boolean =>
      componentCorrectionSchema.safeParse({
        kind: 'set-component-owner',
        component: 'src/deals/**',
        owner,
        reason: REASON,
      }).success;
    // organizations name owners differently; rejecting a valid team name is the worse failure
    for (const owner of ['Platform Team', '@acme/deals', 'deals@acme.example', 'squad-7 (EU)']) {
      expect(owned(owner), owner).toBe(true);
    }
    expect(owned('')).toBe(false);
    expect(owned('x'.repeat(201))).toBe(false);
    expect(owned(undefined)).toBe(false);
  });

  it('ownership can only be asserted, never requested as an inference (§16, ADR-0002)', () => {
    // There is no operation that asks the system to work out an owner…
    for (const kind of ['infer-component-owner', 'detect-component-owner']) {
      expect(
        configOperationSchema.safeParse({ kind, component: 'src/**', reason: REASON }).success,
        kind,
      ).toBe(false);
    }
    // …and set-component-owner takes no source hint that would let git history stand in for a
    // human assertion. The owner string is the whole input; provenance comes from the applier.
    expect(
      componentCorrectionSchema.safeParse({
        kind: 'set-component-owner',
        component: 'src/deals/**',
        owner: 'deals-team',
        derivedFrom: 'git-blame',
        reason: REASON,
      }).success,
    ).toBe(false);
  });

  it('splitting a component is deliberately not expressible as a configuration operation', () => {
    expect(
      configOperationSchema.safeParse({
        kind: 'split-component',
        from: 'DealService',
        into: ['DealReader', 'DealWriter'],
        reason: REASON,
      }).success,
    ).toBe(false);
  });
});

describe('§16 correction records in architecture.yml', () => {
  it('accepts renames, relationship decisions, markers and sources — all additive to v1', () => {
    const document = {
      schemaVersion: 1,
      contexts: [{ name: 'deals', paths: ['src/deals/**'], source: 'agent-approved' }],
      components: [
        {
          path: 'src/deals/**',
          role: 'domain',
          context: 'deals',
          markers: ['shared'],
          owner: 'deals-team',
          source: 'human-confirmed',
        },
      ],
      renames: [
        {
          from: 'DealSvc',
          to: 'DealService',
          reason: REASON,
          confirmedAt: '2026-08-02T10:00:00.000Z',
          source: 'human-confirmed',
        },
      ],
      relationships: [
        {
          edgeId: 'edge:a->b',
          confirmed: false,
          reason: REASON,
          confirmedAt: '2026-08-02T10:00:00.000Z',
        },
      ],
    };
    const parsed = architectureConfigSchema.parse(document);
    expect(architectureConfigSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('a v1 document written before corrections existed still parses (no required new field)', () => {
    const legacy = {
      schemaVersion: 1,
      contexts: [{ name: 'deals', paths: ['src/deals/**'] }],
      components: [{ path: 'src/domain/**', role: 'domain' }],
    };
    expect(architectureConfigSchema.safeParse(legacy).success).toBe(true);
  });

  it('an owner is free-form but never empty, and stays absent when nobody assigned one', () => {
    const withOwner = (owner: unknown): boolean =>
      architectureConfigSchema.safeParse({
        schemaVersion: 1,
        components: [{ path: 'src/deals/**', owner }],
      }).success;
    expect(withOwner('Platform Team')).toBe(true);
    expect(withOwner('')).toBe(false);
    // absence means unowned — there is no "unknown yet" sentinel to fill in later
    const parsed = architectureConfigSchema.parse({
      schemaVersion: 1,
      components: [{ path: 'src/deals/**', role: 'domain' }],
    });
    expect(parsed.components?.[0]).not.toHaveProperty('owner');
  });

  it('rejects an unknown source level and an empty marker list', () => {
    expect(
      architectureConfigSchema.safeParse({
        schemaVersion: 1,
        components: [{ path: 'x/**', source: 'guessed' }],
      }).success,
    ).toBe(false);
    expect(
      architectureConfigSchema.safeParse({
        schemaVersion: 1,
        components: [{ path: 'x/**', markers: [] }],
      }).success,
    ).toBe(false);
  });
});

describe('§Z5 precedence contract', () => {
  it('names all six levels, highest priority first', () => {
    expect([...CONFIG_PRECEDENCE_LEVELS]).toEqual([
      'human-confirmed',
      'agent-approved',
      'repo-metadata',
      'deterministic-detection',
      'ai-inferred',
      'defaults',
    ]);
  });

  it('an effective component always states the level, its rank and its provenance', () => {
    const resolution = {
      value: 'domain',
      level: 'human-confirmed',
      rank: 1,
      provenance: 'human-confirmed',
      detail: 'architecture.yml: src/deals/**',
    };
    const component = {
      nodeId: 'file:a.ts',
      graphName: 'a.ts',
      name: { ...resolution, value: 'a.ts' },
      role: resolution,
      context: { ...resolution, value: undefined },
      markers: [],
      mergedWithNodeIds: [],
    };
    expect(effectiveComponentSchema.safeParse(component).success).toBe(true);
    const { level, ...withoutLevel } = resolution;
    void level;
    expect(effectiveComponentSchema.safeParse({ ...component, role: withoutLevel }).success).toBe(
      false,
    );
    // owner is additive and optional: payloads written before it existed still parse
    expect(
      effectiveComponentSchema.safeParse({
        ...component,
        owner: { ...resolution, value: 'deals-team' },
      }).success,
    ).toBe(true);
    expect(
      effectiveComponentSchema.safeParse({ ...component, owner: { value: 'deals-team' } }).success,
    ).toBe(false);
  });
});
