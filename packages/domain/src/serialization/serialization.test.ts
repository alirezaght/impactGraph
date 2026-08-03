import { describe, expect, it } from 'vitest';

import {
  createEvidenceRecord,
  createGraphEdge,
  createGraphNode,
  parseEvidenceRecord,
  parseGraphEdge,
  parseGraphNode,
  serializeEvidenceRecord,
  serializeGraphEdge,
  serializeGraphNode,
} from '../index.js';

import type {
  CreateEvidenceRecordInput,
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  KnowledgeEnvelopeInput,
} from '../index.js';

const envelope: KnowledgeEnvelopeInput = {
  provenance: 'llm-inferred',
  evidenceIds: ['ev-1', 'ev-2'],
  confidence: {
    value: 0.74,
    signals: [
      { type: 'event-relationship', contribution: 0.4 },
      { type: 'semantic-concept-match', contribution: 0.4 },
      { type: 'graph-distance', contribution: -0.06, description: 'distance 2' },
    ],
  },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-4f8a29c',
  analysisRunId: 'run-001',
  specification: { specificationId: 'spec-1', specificationVersion: 3 },
};

const mustCreate = <T>(result: { ok: boolean; value?: T }): T => {
  expect(result.ok).toBe(true);
  return result.value as T;
};

const node = (): GraphNode =>
  mustCreate(
    createGraphNode({
      id: 'node-search-indexer',
      category: 'application',
      type: 'service',
      name: 'DealSearchIndexer',
      path: 'src/search/DealSearchIndexer.ts',
      knowledge: envelope,
    }),
  );

const edge = (): GraphEdge =>
  mustCreate(
    createGraphEdge({
      id: 'edge-may-affect-1',
      type: 'MAY_AFFECT',
      sourceId: 'node-requirement-visibility',
      targetId: 'node-search-indexer',
      knowledge: envelope,
    }),
  );

const evidenceInput: CreateEvidenceRecordInput = {
  id: 'ev-1',
  kind: 'import-statement',
  source: {
    kind: 'file',
    filePath: 'src/deals/application/DealService.ts',
    range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 42 },
    symbolName: 'DealRepository',
  },
  repositorySnapshotId: 'snap-4f8a29c',
  createdAt: '2026-07-31T10:00:00.000Z',
};

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

describe('JSON serialization round-trips (Story 1.1 AC)', () => {
  it('round-trips a graph node exactly, including the knowledge envelope', () => {
    const original = node();
    const parsed = parseGraphNode(roundTrip(serializeGraphNode(original)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(original);
    }
  });

  it('round-trips a graph edge exactly', () => {
    const original = edge();
    const parsed = parseGraphEdge(roundTrip(serializeGraphEdge(original)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(original);
    }
  });

  it('round-trips an evidence record exactly', () => {
    const original = mustCreate<EvidenceRecord>(createEvidenceRecord(evidenceInput));
    const parsed = parseEvidenceRecord(roundTrip(serializeEvidenceRecord(original)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(original);
    }
  });

  it('stamps an explicit schemaVersion on every serialized form', () => {
    // 2 since §12.1.1 added the structured route contract to a node.
    expect(serializeGraphNode(node()).schemaVersion).toBe(2);
    expect(serializeGraphEdge(edge()).schemaVersion).toBe(1);
    const evidence = mustCreate<EvidenceRecord>(createEvidenceRecord(evidenceInput));
    expect(serializeEvidenceRecord(evidence).schemaVersion).toBe(1);
  });
});

describe('parse validation (Story 1.1 AC — schema validation)', () => {
  it('rejects non-objects and null', () => {
    expect(parseGraphNode('a node').ok).toBe(false);
    expect(parseGraphNode(null).ok).toBe(false);
    expect(parseGraphEdge(7).ok).toBe(false);
    expect(parseEvidenceRecord([]).ok).toBe(false);
  });

  it('rejects an unsupported schemaVersion', () => {
    const json = { ...serializeGraphNode(node()), schemaVersion: 99 };
    const parsed = parseGraphNode(json);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.issues.some((i) => i.code === 'unsupported-schema-version')).toBe(true);
    }
  });

  it('rejects missing or wrongly-typed fields', () => {
    const json = serializeGraphNode(node());
    expect(parseGraphNode({ ...json, name: undefined }).ok).toBe(false);
    expect(parseGraphNode({ ...json, id: 5 }).ok).toBe(false);
    expect(parseGraphNode({ ...json, knowledge: 'trust-me' }).ok).toBe(false);
  });

  it('re-applies construction-time rules — a tampered provenance cannot sneak in', () => {
    const json = serializeGraphNode(node());
    const knowledge = { ...json.knowledge, provenance: 'runtime-observation' };
    expect(parseGraphNode({ ...json, knowledge }).ok).toBe(false);
  });

  it('keeps deterministic facts and AI inferences queryable apart after a round-trip (§3)', () => {
    const parsed = parseGraphNode(roundTrip(serializeGraphNode(node())));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.knowledge.provenance).toBe('llm-inferred');
    }
  });
});
