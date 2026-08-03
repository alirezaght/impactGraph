import { describe, expect, it } from 'vitest';

import { graphNodeArtifactSchema, upgradeGraphNodeArtifact } from './graph.js';

// §12.1.1 migration. The point of the upgrader is that an already-written graph keeps loading, and
// that it does not manufacture evidence the old artifact never held.

const envelope = {
  provenance: 'framework-convention',
  evidenceIds: ['ev-1'],
  confidence: { value: 0.9, signals: [{ type: 'direct-observation', contribution: 0.9 }] },
  createdAt: '2026-08-03T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
  specification: { specificationId: 'spec-1', specificationVersion: 1 },
};

const v1 = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  schemaVersion: 1,
  id: 'route:GET /api/deals',
  category: 'application',
  type: 'api-endpoint',
  name: 'GET /api/deals',
  knowledge: envelope,
  ...overrides,
});

describe('graph node migration to the current schema version', () => {
  it('recovers verb and path from a legacy route name', () => {
    const upgraded = upgradeGraphNodeArtifact(v1({}));

    expect(upgraded?.node.schemaVersion).toBe(3);
    expect(upgraded?.node.route).toEqual({
      path: '/api/deals',
      method: 'GET',
      pathParameters: [],
      queryParameters: [],
    });
  });

  it('says that recovered parameters are absent evidence, not observed emptiness', () => {
    // A v1 artifact never held parameter evidence. The empty arrays are a shape requirement, and the
    // diagnostic is what stops a later rule reading "no required parameters" out of missing data.
    expect(upgradeGraphNodeArtifact(v1({}))?.diagnostic).toContain('parameter evidence');
  });

  it('keeps a route node whose name does not parse, with no contract and a diagnostic', () => {
    const upgraded = upgradeGraphNodeArtifact(v1({ id: 'route:weird', name: 'not-a-route-name' }));

    expect(upgraded?.node.id).toBe('route:weird');
    expect(upgraded?.node.route).toBeUndefined();
    expect(upgraded?.diagnostic).toContain('does not parse');
  });

  it('does not guess a contract from a lower-case verb or a relative path', () => {
    expect(upgradeGraphNodeArtifact(v1({ name: 'get /api/deals' }))?.node.route).toBeUndefined();
    expect(upgradeGraphNodeArtifact(v1({ name: 'GET api/deals' }))?.node.route).toBeUndefined();
  });

  it('upgrades a non-route node without inventing a route', () => {
    const upgraded = upgradeGraphNodeArtifact(
      v1({ id: 'symbol:a#B', type: 'service', name: 'DealService' }),
    );

    expect(upgraded?.node.schemaVersion).toBe(3);
    expect(upgraded?.node.route).toBeUndefined();
    expect(upgraded?.diagnostic).toBeUndefined();
  });

  it('passes a current node through untouched', () => {
    const node = {
      ...v1({}),
      schemaVersion: 3,
      route: { path: '/api/deals', method: 'GET', pathParameters: [], queryParameters: [] },
    };

    expect(upgradeGraphNodeArtifact(node)?.node).toEqual(node);
    expect(upgradeGraphNodeArtifact(node)?.diagnostic).toBeUndefined();
  });

  it('lifts a v2 node, keeping its contract and rewriting only requiredness', () => {
    const upgraded = upgradeGraphNodeArtifact({
      ...v1({}),
      schemaVersion: 2,
      route: {
        path: '/deals/:id',
        method: 'GET',
        pathParameters: [{ name: 'id', required: true }],
        queryParameters: [],
      },
    });

    expect(upgraded?.node.schemaVersion).toBe(3);
    expect(upgraded?.node.route?.pathParameters).toEqual([
      { name: 'id', requiredness: 'required' },
    ]);
    expect(upgraded?.diagnostic).toBeUndefined();
  });

  it('maps a v2 `required: false` to unknown, not optional', () => {
    // `false` was the default of a field no v2 producer ever wrote. Reading it as "may be omitted"
    // would turn the absence of an observation into one, which is the whole reason requiredness
    // stopped being a boolean.
    const upgraded = upgradeGraphNodeArtifact({
      ...v1({}),
      schemaVersion: 2,
      route: {
        path: '/deals/{id}',
        method: 'GET',
        pathParameters: [{ name: 'id', required: false }],
        queryParameters: [],
      },
    });

    expect(upgraded?.node.route?.pathParameters).toEqual([{ name: 'id', requiredness: 'unknown' }]);
    expect(upgraded?.diagnostic).toContain("rather than 'optional'");
  });

  it('lifts a v2 node that states no route without inventing one', () => {
    const upgraded = upgradeGraphNodeArtifact({ ...v1({ type: 'service' }), schemaVersion: 2 });

    expect(upgraded?.node.schemaVersion).toBe(3);
    expect(upgraded?.node.route).toBeUndefined();
  });

  it('every upgraded node validates against the current schema', () => {
    for (const input of [
      v1({}),
      v1({ name: 'not-a-route-name' }),
      v1({ id: 'symbol:a#B', type: 'service', name: 'DealService' }),
    ]) {
      const upgraded = upgradeGraphNodeArtifact(input);
      expect(graphNodeArtifactSchema.safeParse(upgraded?.node).success, JSON.stringify(input)).toBe(
        true,
      );
    }
  });

  it('refuses input that is no known version', () => {
    expect(upgradeGraphNodeArtifact({ schemaVersion: 1 })).toBeUndefined();
    expect(upgradeGraphNodeArtifact({ ...v1({}), schemaVersion: 4 })).toBeUndefined();
    expect(upgradeGraphNodeArtifact('not a node')).toBeUndefined();
  });
});
