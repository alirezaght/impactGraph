// Contract ↔ domain alignment: whatever packages/domain serializes must satisfy the persisted
// artifact schemas (validation at BOTH ends — persistence writes domain-serialized JSON and
// Zod-validates it against these schemas). Test-only import of domain is allowed.
import {
  createEvidenceRecord,
  createGraphEdge,
  createGraphNode,
  createRepositorySnapshot,
  knowledgeCategoryOf,
  PROVENANCE_VALUES,
  serializeEvidenceRecord,
  serializeGraphEdge,
  serializeGraphNode,
  serializeRepositorySnapshot,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  evidenceRecordArtifactSchema,
  graphEdgeArtifactSchema,
  graphNodeArtifactSchema,
  knowledgeCategoryForProvenance,
  repositorySnapshotArtifactSchema,
} from '../index.js';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-import', contribution: 1 }] },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const unwrap = <T>(result: { ok: boolean; value?: T }): T => {
  expect(result.ok).toBe(true);
  return result.value as T;
};

describe('domain serialization satisfies artifact schemas', () => {
  it('graph node', () => {
    const node = unwrap(
      createGraphNode({
        id: 'node-1',
        category: 'application',
        type: 'service',
        name: 'DealService',
        knowledge,
      }),
    );
    const json = serializeGraphNode(node);
    expect(graphNodeArtifactSchema.parse(JSON.parse(JSON.stringify(json)))).toEqual(json);
  });

  it('graph edge', () => {
    const edge = unwrap(
      createGraphEdge({
        id: 'edge-1',
        type: 'IMPORTS',
        sourceId: 'node-1',
        targetId: 'node-2',
        knowledge,
      }),
    );
    const json = serializeGraphEdge(edge);
    expect(graphEdgeArtifactSchema.parse(JSON.parse(JSON.stringify(json)))).toEqual(json);
  });

  it('evidence record', () => {
    const evidence = unwrap(
      createEvidenceRecord({
        id: 'ev-1',
        kind: 'import-statement',
        source: { kind: 'file', filePath: 'src/a.ts', symbolName: 'A' },
        repositorySnapshotId: 'snap-1',
        createdAt: '2026-07-31T10:00:00.000Z',
      }),
    );
    const json = serializeEvidenceRecord(evidence);
    expect(evidenceRecordArtifactSchema.parse(JSON.parse(JSON.stringify(json)))).toEqual(json);
  });

  it('repository snapshot', () => {
    const snapshot = unwrap(
      createRepositorySnapshot({
        id: 'snap-1',
        repositoryIdentity: '/repo/root',
        head: { kind: 'detached', commitSha: 'a1b2c3d' },
        dirtyWorkingTree: true,
        indexVersion: 3,
        createdAt: '2026-07-31T10:00:00.000Z',
      }),
    );
    const json = serializeRepositorySnapshot(snapshot);
    expect(repositorySnapshotArtifactSchema.parse(JSON.parse(JSON.stringify(json)))).toEqual(json);
  });
});

describe('knowledge-category table mirrors packages/domain (PRD §3, ADR-0002)', () => {
  it('agrees with knowledgeCategoryOf for every provenance value', () => {
    for (const provenance of PROVENANCE_VALUES) {
      expect(knowledgeCategoryForProvenance(provenance)).toBe(knowledgeCategoryOf(provenance));
    }
  });
});
