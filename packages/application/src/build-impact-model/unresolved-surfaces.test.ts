import { createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { matchConcepts } from './concept-matching.js';
import { collectUnresolvedSurfaces } from './unresolved-surfaces.js';

import type { ConceptMatchResult } from './concept-matching.js';
import type { GraphNode, KnowledgeGraph, Requirement } from '@impactgraph/domain';

// ADR-0025 — the absence half of the pipeline. A specification term that resolves to nothing is a
// finding with a reading, and the near-miss names it did NOT match are reported as vocabulary
// rather than as impacts.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation' as const, contribution: 1 }] },
  createdAt: '2026-08-18T00:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, path: string, type = 'file'): GraphNode => {
  const result = createGraphNode({ id, category: 'repository', type, name, path, knowledge });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const graph = (extra: readonly GraphNode[] = []): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('file:export-job', 'exportJob.ts', 'src/jobs/exportJob.ts'),
      node('file:export-controller', 'ExportController.ts', 'src/api/ExportController.ts'),
      ...extra,
    ],
    [],
  );
  if (!result.ok) {
    throw new Error('graph');
  }
  return result.value;
};

const requirement = (statement: string, concepts: readonly string[]): Requirement => ({
  id: 'R1',
  statement,
  type: 'functional',
  concepts: [...concepts],
  actors: [],
  status: 'draft',
});

const collect = (
  built: KnowledgeGraph,
  statement: string,
  concepts: readonly string[],
  missingRepositoryCount = 0,
) => {
  const single = requirement(statement, concepts);
  const matched: ReadonlyMap<string, ConceptMatchResult> = new Map([
    [single.id, matchConcepts(built, single.concepts)],
  ]);
  return collectUnresolvedSurfaces({
    graph: built,
    requirements: [single],
    matchesByRequirement: matched,
    missingRepositoryCount,
  });
};

describe('collectUnresolvedSurfaces', () => {
  /**
   * The regression case. `/threshold-eval/export` names a route this repository does not serve;
   * `exportJob.ts` and `ExportController.ts` share a word with it and are different components.
   * Before ADR-0025 those two were impacts and the absence was a warning.
   */
  it('reports a route the repository does not serve, and never matches it by resemblance', () => {
    const built = graph();
    const surfaces = collect(
      built,
      'Add a /threshold-eval/export endpoint that streams the evaluation results.',
      ['/threshold-eval/export'],
    );
    expect(surfaces).toHaveLength(1);
    const [surface] = surfaces;
    expect(surface?.concept).toBe('/threshold-eval/export');
    expect(surface?.shape).toBe('route');
    expect(surface?.kind).toBe('new-surface');
    expect(surface?.requirementIds).toEqual(['R1']);
  });

  it('produces no impacts for a path-shaped concept that only resembles existing names', () => {
    const built = graph();
    const matched = matchConcepts(built, ['/threshold-eval/export']);
    expect(matched.matches).toEqual([]);
    expect(matched.unknownConcepts).toEqual(['/threshold-eval/export']);
  });

  it('lets a coverage gap outrank the new-surface reading and keeps it as an alternative', () => {
    const surfaces = collect(
      graph(),
      'Add a /threshold-eval/export endpoint.',
      ['/threshold-eval/export'],
      1,
    );
    expect(surfaces[0]?.kind).toBe('coverage-gap');
    expect(surfaces[0]?.alternativeKinds).toContain('new-surface');
  });

  it('keeps every reading open when the statement establishes nothing', () => {
    const surfaces = collect(graph(), 'The results are visible to reviewers.', [
      '/threshold-eval/export',
    ]);
    expect(surfaces[0]?.kind).toBe('insufficient-evidence');
    expect(surfaces[0]?.alternativeKinds.length).toBeGreaterThan(1);
    expect(surfaces[0]?.confidence).toBeLessThan(0.5);
  });

  it('says nothing when every concept resolved', () => {
    expect(collect(graph(), 'Change the export job.', ['exportJob.ts'])).toEqual([]);
  });
});
