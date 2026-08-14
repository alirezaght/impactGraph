import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  resolveSuppliedIdentifiers,
  toSuppliedIdentifiersDto,
  UNRESOLVED_IDENTIFIER_LIMIT,
} from './supplied-identifiers.js';

import type { KnowledgeGraph } from '@impactgraph/domain';

// ADR-0017 §5 — the supplied-identifier resolution check. Only PATH-SHAPED identifiers are
// checked: "the export button" failing to resolve is prose noise, "modify services/x.py" failing
// to resolve is a claim about the repository that is either new surface or wrong.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-14T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const graphWith = (paths: readonly string[]): KnowledgeGraph => {
  const nodes = paths.map((path) => {
    const node = createGraphNode({
      id: `file:${path}`,
      name: path.split('/').pop() ?? path,
      category: 'repository',
      type: 'file',
      path,
      knowledge,
    });
    if (!node.ok) {
      throw new Error('bad fixture node');
    }
    return node.value;
  });
  const created = createKnowledgeGraph(nodes, []);
  if (!created.ok) {
    throw new Error('bad fixture graph');
  }
  return created.value;
};

describe('resolveSuppliedIdentifiers', () => {
  const graph = graphWith(['src/services/send_service.py', 'src/api/issue_routes.py']);

  it('resolves a named path by suffix and reports the miss it cannot resolve', () => {
    const resolution = resolveSuppliedIdentifiers(
      'Modify services/send_service.py and services/x.py to relay events.',
      graph,
    );
    expect(resolution.pathShapedCount).toBe(2);
    expect(resolution.resolvedCount).toBe(1);
    expect(resolution.unresolved).toEqual(['services/x.py']);
  });

  it('ignores prose and bare symbols — only path-shaped identifiers are claims about files', () => {
    const resolution = resolveSuppliedIdentifiers(
      'The export button must respect NewsletterListWorkspace and send_service everywhere.',
      graph,
    );
    expect(resolution.pathShapedCount).toBe(0);
    expect(resolution.unresolved).toEqual([]);
  });

  it('does not double-count the derived basename of a path the specification wrote once', () => {
    const resolution = resolveSuppliedIdentifiers('Touch src/services/send_service.py.', graph);
    expect(resolution.pathShapedCount).toBe(1);
    expect(resolution.resolvedCount).toBe(1);
  });

  it('resolves a bare filename against the node name and path basename', () => {
    const resolution = resolveSuppliedIdentifiers('Change issue_routes.py accordingly.', graph);
    expect(resolution.pathShapedCount).toBe(1);
    expect(resolution.resolvedCount).toBe(1);
  });

  it('never resolves by loose substring — near-names stay unresolved', () => {
    const resolution = resolveSuppliedIdentifiers('Modify send_service.ts for parity.', graph);
    expect(resolution.unresolved).toEqual(['send_service.ts']);
  });
});

describe('toSuppliedIdentifiersDto', () => {
  it('caps the unresolved listing at the wire limit and keeps the honest counts', () => {
    const unresolved = Array.from(
      { length: 14 },
      (_, index) => `services/missing-${String(index)}.py`,
    );
    const dto = toSuppliedIdentifiersDto({
      pathShapedCount: 14,
      resolvedCount: 0,
      unresolved,
    });
    expect(dto.unresolved).toHaveLength(UNRESOLVED_IDENTIFIER_LIMIT);
    expect(dto.pathShapedCount).toBe(14);
    expect(dto.resolvedCount).toBe(0);
  });
});
