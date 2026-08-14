// Contract ↔ domain alignment: whatever packages/domain serializes must satisfy the persisted
// artifact schemas (validation at BOTH ends — persistence writes domain-serialized JSON and
// Zod-validates it against these schemas). Test-only import of domain is allowed.
import {
  createEvidenceRecord,
  createGraphEdge,
  createGraphNode,
  createRepositorySnapshot,
  knowledgeCategoryOf,
  PREFLIGHT_FINDING_KINDS,
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
  PREFLIGHT_FINDING_KIND_VALUES,
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

  // ADR-0020 §3 — declaredType is additive on the persisted node artifact: a node carrying it
  // must satisfy the schema unchanged, at the same schema version.
  it('graph node with a declared type', () => {
    const node = unwrap(
      createGraphNode({
        id: 'field-1',
        category: 'data',
        type: 'field',
        name: 'Listing.id',
        path: 'app/models.py',
        declaredType: 'Mapped[uuid.UUID]',
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

describe('preflight finding vocabulary mirrors packages/domain (ADR-0017/0020)', () => {
  it('lists exactly the kinds the domain can produce', () => {
    expect([...PREFLIGHT_FINDING_KIND_VALUES].sort()).toEqual([...PREFLIGHT_FINDING_KINDS].sort());
  });
});
