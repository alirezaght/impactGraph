import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { resolveOverlay } from './overlay.js';

import type { ArchitectureConfigDto } from '@impactgraph/contracts';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

// Story 8.3 (§Z5) — the six-level precedence ladder, and §16 corrections as a READ-TIME overlay:
// the graph handed in is never modified, so a reindex can never lose a correction and a
// correction can never invent a graph fact.

const envelope = (provenance: string): Parameters<typeof createGraphNode>[0]['knowledge'] => ({
  provenance,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-08-02T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
});

interface NodeSpec {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly type: string;
  readonly path?: string;
  readonly provenance?: string;
}

const node = (spec: NodeSpec): GraphNode => {
  const created = createGraphNode({
    id: spec.id,
    name: spec.name,
    category: spec.category,
    type: spec.type,
    ...(spec.path === undefined ? {} : { path: spec.path }),
    knowledge: envelope(spec.provenance ?? 'static-analysis'),
  });
  if (!created.ok) {
    throw new Error(`bad fixture node: ${spec.id}`);
  }
  return created.value;
};

const edge = (
  id: string,
  sourceId: string,
  targetId: string,
  provenance = 'static-analysis',
): GraphEdge => {
  const created = createGraphEdge({
    id,
    type: 'DEPENDS_ON',
    sourceId,
    targetId,
    knowledge: envelope(provenance),
  });
  if (!created.ok) {
    throw new Error(`bad fixture edge: ${id}`);
  }
  return created.value;
};

const graphOf = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]): KnowledgeGraph => {
  const created = createKnowledgeGraph(nodes, edges);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

const PACKAGE = node({
  id: 'pkg:api',
  name: 'api',
  category: 'repository',
  type: 'package',
  path: 'apps/api/package.json',
  provenance: 'configuration',
});

const FILE = node({
  id: 'file:apps/api/src/deals/policy.ts',
  name: 'policy.ts',
  category: 'repository',
  type: 'file',
  path: 'apps/api/src/deals/policy.ts',
});

const empty: ArchitectureConfigDto = { schemaVersion: 1 };

describe('§Z5 configuration precedence overlay (Story 8.3)', () => {
  it('level 6 — nothing configured or detected leaves role/context at defaults', () => {
    const view = resolveOverlay(graphOf([FILE], []), empty);
    const component = view.components.get(FILE.id);
    expect(component?.role).toMatchObject({ value: undefined, level: 'defaults', rank: 6 });
    expect(component?.context).toMatchObject({ value: undefined, level: 'defaults', rank: 6 });
    expect(component?.name).toMatchObject({ value: 'policy.ts', level: 'deterministic-detection' });
  });

  it('level 5 beats level 6 — an AI-inferred node contributes a role at rank 5', () => {
    const inferred = node({
      id: 'sym:Policy',
      name: 'Policy',
      category: 'domain',
      type: 'policy',
      path: 'apps/api/src/deals/policy.ts',
      provenance: 'llm-inferred',
    });
    const view = resolveOverlay(graphOf([inferred], []), empty);
    expect(view.components.get(inferred.id)?.role).toMatchObject({
      value: 'domain',
      level: 'ai-inferred',
      rank: 5,
      provenance: 'llm-inferred',
    });
  });

  it('level 4 beats level 5 — deterministic detection outranks the same AI-inferred fact', () => {
    const detected = node({
      id: 'sym:Policy',
      name: 'Policy',
      category: 'domain',
      type: 'policy',
      path: 'apps/api/src/deals/policy.ts',
      provenance: 'static-analysis',
    });
    const view = resolveOverlay(graphOf([detected], []), empty);
    expect(view.components.get(detected.id)?.role).toMatchObject({
      level: 'deterministic-detection',
      rank: 4,
      provenance: 'static-analysis',
    });
  });

  it('level 3 beats level 4 — repository metadata supplies the context fallback', () => {
    const view = resolveOverlay(graphOf([PACKAGE, FILE], []), empty);
    expect(view.components.get(FILE.id)?.context).toMatchObject({
      value: 'api',
      level: 'repo-metadata',
      rank: 3,
      provenance: 'configuration',
    });
  });

  it('level 2 beats level 3 — an agent-approved context assignment wins over package metadata', () => {
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      contexts: [{ name: 'deals', paths: ['apps/api/src/deals/**'], source: 'agent-approved' }],
    };
    const view = resolveOverlay(graphOf([PACKAGE, FILE], []), config);
    expect(view.components.get(FILE.id)?.context).toMatchObject({
      value: 'deals',
      level: 'agent-approved',
      rank: 2,
      // an agent's value committed to YAML is still AI-inferred knowledge (§3)
      provenance: 'llm-inferred',
    });
  });

  it('level 1 beats level 2 — a human-confirmed assignment wins over the agent-approved one', () => {
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      contexts: [{ name: 'deals', paths: ['apps/api/src/deals/**'], source: 'agent-approved' }],
      components: [
        {
          path: 'apps/api/src/deals/**',
          context: 'deal-management',
          role: 'domain',
          source: 'human-confirmed',
        },
      ],
    };
    const view = resolveOverlay(graphOf([PACKAGE, FILE], []), config);
    const component = view.components.get(FILE.id);
    expect(component?.context).toMatchObject({
      value: 'deal-management',
      level: 'human-confirmed',
      rank: 1,
      provenance: 'human-confirmed',
    });
    expect(component?.role).toMatchObject({ value: 'domain', level: 'human-confirmed', rank: 1 });
  });

  it('an entry without `source` is read as human-confirmed — hand-written YAML is human knowledge', () => {
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      components: [{ path: 'apps/api/src/deals/**', role: 'domain' }],
    };
    const view = resolveOverlay(graphOf([FILE], []), config);
    expect(view.components.get(FILE.id)?.role).toMatchObject({ level: 'human-confirmed', rank: 1 });
  });

  it('renames overlay the name, keep the graph name, and report a merge on collision', () => {
    const a = node({ id: 'sym:a', name: 'DealSvc', category: 'application', type: 'service' });
    const b = node({ id: 'sym:b', name: 'DealsService', category: 'application', type: 'service' });
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      renames: [
        { from: 'DealSvc', to: 'DealService', reason: 'canonical', confirmedAt: 'now' },
        { from: 'DealsService', to: 'DealService', reason: 'canonical', confirmedAt: 'now' },
      ],
    };
    const view = resolveOverlay(graphOf([a, b], []), config);
    expect(view.components.get('sym:a')).toMatchObject({
      graphName: 'DealSvc',
      name: { value: 'DealService', level: 'human-confirmed' },
      mergedWithNodeIds: ['sym:b'],
    });
    expect(view.summary).toMatchObject({ renamed: 2, merged: 1 });
  });

  it('markers carry their own precedence level', () => {
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      components: [
        {
          path: 'apps/api/src/deals/**',
          markers: ['generated', 'shared'],
          source: 'agent-approved',
        },
      ],
    };
    const view = resolveOverlay(graphOf([FILE], []), config);
    expect(view.components.get(FILE.id)?.markers).toEqual([
      expect.objectContaining({ marker: 'generated', level: 'agent-approved', rank: 2 }),
      expect.objectContaining({ marker: 'shared', level: 'agent-approved', rank: 2 }),
    ]);
  });

  it('a rejected relationship is excluded VISIBLY and the graph edge is untouched', () => {
    const dependency = edge('edge:a->b', PACKAGE.id, FILE.id);
    const graph = graphOf([PACKAGE, FILE], [dependency]);
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      relationships: [
        {
          edgeId: 'edge:a->b',
          confirmed: false,
          reason: 'test-only shim, not a real dependency',
          confirmedAt: 'now',
        },
      ],
    };
    const view = resolveOverlay(graph, config);

    const relationship = view.relationships.get('edge:a->b');
    expect(relationship).toMatchObject({
      status: 'rejected',
      excluded: true,
      reason: 'test-only shim, not a real dependency',
      level: 'human-confirmed',
    });
    expect([...view.rejectedEdgeIds]).toEqual(['edge:a->b']);
    expect(view.summary.rejectedRelationships).toBe(1);

    // the deterministic graph still has the edge, unchanged (§34: corrections never rewrite facts)
    expect(graph.edges.get(dependency.id)).toBe(dependency);
    expect(graph.edges.size).toBe(1);
  });

  it('an undecided relationship reports the level of its own detection provenance', () => {
    const inferred = edge('edge:x', PACKAGE.id, FILE.id, 'llm-inferred');
    const view = resolveOverlay(graphOf([PACKAGE, FILE], [inferred]), empty);
    expect(view.relationships.get('edge:x')).toMatchObject({
      status: 'undecided',
      excluded: false,
      level: 'ai-inferred',
      rank: 5,
    });
    expect(view.rejectedEdgeIds.size).toBe(0);
  });

  it('confirming a relationship keeps it in the effective view at human-confirmed level', () => {
    const dependency = edge('edge:a->b', PACKAGE.id, FILE.id);
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      relationships: [
        { edgeId: 'edge:a->b', confirmed: true, reason: 'reviewed by hand', confirmedAt: 'now' },
      ],
    };
    const view = resolveOverlay(graphOf([PACKAGE, FILE], [dependency]), config);
    expect(view.relationships.get('edge:a->b')).toMatchObject({
      status: 'confirmed',
      excluded: false,
      level: 'human-confirmed',
      provenance: 'human-confirmed',
    });
    expect(view.summary.confirmedRelationships).toBe(1);
  });
});

describe('§16 component ownership through the §Z5 ladder', () => {
  const owned = (owner: string, source?: 'human-confirmed' | 'agent-approved') =>
    ({
      schemaVersion: 1,
      components: [
        {
          path: 'apps/api/src/deals/**',
          owner,
          ...(source === undefined ? {} : { source }),
        },
      ],
    }) satisfies ArchitectureConfigDto;

  it('level 6 — no committed owner leaves the component visibly unowned', () => {
    const view = resolveOverlay(graphOf([PACKAGE, FILE], []), empty);
    expect(view.components.get(FILE.id)?.owner).toMatchObject({
      value: undefined,
      level: 'defaults',
      rank: 6,
    });
    expect(view.summary.ownersSet).toBe(0);
  });

  it('level 2 — an agent-approved owner resolves at rank 2 and stays llm-inferred knowledge', () => {
    const view = resolveOverlay(graphOf([FILE], []), owned('deals-team', 'agent-approved'));
    expect(view.components.get(FILE.id)?.owner).toMatchObject({
      value: 'deals-team',
      level: 'agent-approved',
      rank: 2,
      provenance: 'llm-inferred',
      detail: 'architecture.yml: apps/api/src/deals/**',
    });
  });

  it('level 1 — a human-confirmed owner outranks an agent-approved one', () => {
    const config: ArchitectureConfigDto = {
      schemaVersion: 1,
      components: [
        { path: 'apps/api/src/**', owner: 'guessed-team', source: 'agent-approved' },
        { path: 'apps/api/src/deals/**', owner: 'Deal Platform Team', source: 'human-confirmed' },
      ],
    };
    const view = resolveOverlay(graphOf([FILE], []), config);
    expect(view.components.get(FILE.id)?.owner).toMatchObject({
      value: 'Deal Platform Team',
      level: 'human-confirmed',
      rank: 1,
      provenance: 'human-confirmed',
    });
    expect(view.summary.ownersSet).toBe(1);
  });

  it('a hand-written entry without `source` is human knowledge, like every other correction', () => {
    const view = resolveOverlay(graphOf([FILE], []), owned('Platform Team'));
    expect(view.components.get(FILE.id)?.owner).toMatchObject({
      value: 'Platform Team',
      level: 'human-confirmed',
      rank: 1,
    });
  });

  it('ownership is NEVER inferred — no provenance in the graph can produce an owner', () => {
    // Every provenance the domain lets a node carry (`runtime-observation` is reserved and the
    // domain refuses it), including the git-history one a `git blame` heuristic would ride in on.
    // None of them may fill `owner`: "who last touched this file" is a different claim from "who
    // owns it" (ADR-0002, §3).
    for (const provenance of [
      'static-analysis',
      'configuration',
      'framework-convention',
      'git-history',
      'llm-inferred',
      'human-confirmed',
    ]) {
      const probe = node({
        id: `sym:probe-${provenance}`,
        name: 'Probe',
        category: 'domain',
        type: 'policy',
        path: 'apps/api/src/deals/policy.ts',
        provenance,
      });
      const view = resolveOverlay(graphOf([PACKAGE, probe], []), empty);
      const owner = view.components.get(probe.id)?.owner;
      expect(owner?.value, provenance).toBeUndefined();
      expect(owner?.level, provenance).toBe('defaults');
    }
  });

  it('ownership resolves only at the committed-config rungs or defaults — never in between', () => {
    // Levels 3-5 (repository metadata, deterministic detection, AI inference) are unreachable by
    // construction: `resolveOwner` has no candidate source other than architecture.yml.
    const configured = resolveOverlay(graphOf([PACKAGE, FILE], []), owned('deals-team'));
    const unconfigured = resolveOverlay(graphOf([PACKAGE, FILE], []), empty);
    const levels = [...configured.components.values(), ...unconfigured.components.values()].map(
      (component) => component.owner.level,
    );
    expect(new Set(levels)).toEqual(new Set(['human-confirmed', 'defaults']));
  });
});
