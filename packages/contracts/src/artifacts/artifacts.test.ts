import { describe, expect, it } from 'vitest';

import {
  evidenceRecordArtifactSchema,
  graphEdgeArtifactSchema,
  graphNodeArtifactSchema,
  repositorySnapshotArtifactSchema,
} from '../index.js';

const envelope = {
  provenance: 'llm-inferred',
  evidenceIds: ['ev-1'],
  confidence: {
    value: 0.74,
    signals: [{ type: 'event-relationship', contribution: 0.4, description: 'via topic' }],
  },
  createdAt: '2026-07-31T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
  specification: { specificationId: 'spec-1', specificationVersion: 2 },
};

const nodeFixture = {
  schemaVersion: 2,
  id: 'node-1',
  category: 'application',
  type: 'service',
  name: 'DealService',
  path: 'src/deals/DealService.ts',
  knowledge: envelope,
};

const edgeFixture = {
  schemaVersion: 1,
  id: 'edge-1',
  type: 'MAY_AFFECT',
  sourceId: 'node-1',
  targetId: 'node-2',
  knowledge: envelope,
};

const evidenceFixture = {
  schemaVersion: 1,
  id: 'ev-1',
  kind: 'import-statement',
  source: {
    kind: 'file',
    filePath: 'src/deals/DealService.ts',
    range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 42 },
    symbolName: 'DealRepository',
  },
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-07-31T10:00:00.000Z',
};

const snapshotFixture = {
  schemaVersion: 1,
  id: 'snap-1',
  repositoryIdentity: '/repo/root',
  head: { kind: 'branch', branch: 'main', commitSha: '4f8a29c' },
  dirtyWorkingTree: false,
  indexVersion: 1,
  createdAt: '2026-07-31T10:00:00.000Z',
};

describe('artifact schemas v1 — valid fixtures round-trip', () => {
  it('parses valid artifacts and returns them unchanged (round-trip identity)', () => {
    expect(graphNodeArtifactSchema.parse(nodeFixture)).toEqual(nodeFixture);
    expect(graphEdgeArtifactSchema.parse(edgeFixture)).toEqual(edgeFixture);
    expect(evidenceRecordArtifactSchema.parse(evidenceFixture)).toEqual(evidenceFixture);
    expect(repositorySnapshotArtifactSchema.parse(snapshotFixture)).toEqual(snapshotFixture);
  });
});

describe('artifact schemas v1 — invalid fixtures rejected', () => {
  it('rejects unknown schema versions', () => {
    // 1 is now the OLD version: readable only through the upgrader, never by the current schema.
    expect(graphNodeArtifactSchema.safeParse({ ...nodeFixture, schemaVersion: 1 }).success).toBe(
      false,
    );
    expect(graphNodeArtifactSchema.safeParse({ ...nodeFixture, schemaVersion: 3 }).success).toBe(
      false,
    );
    expect(
      repositorySnapshotArtifactSchema.safeParse({ ...snapshotFixture, schemaVersion: 0 }).success,
    ).toBe(false);
  });

  it('rejects unknown provenance values and missing envelope fields', () => {
    const badProvenance = {
      ...nodeFixture,
      knowledge: { ...envelope, provenance: 'guesswork' },
    };
    expect(graphNodeArtifactSchema.safeParse(badProvenance).success).toBe(false);

    const withoutRunId: Record<string, unknown> = { ...envelope };
    delete withoutRunId['analysisRunId'];
    expect(
      graphEdgeArtifactSchema.safeParse({ ...edgeFixture, knowledge: withoutRunId }).success,
    ).toBe(false);
  });

  it('rejects unknown keys (strict shapes — no prototype-polluting extras)', () => {
    expect(graphNodeArtifactSchema.safeParse({ ...nodeFixture, extra: 1 }).success).toBe(false);
    expect(
      evidenceRecordArtifactSchema.safeParse({
        ...evidenceFixture,
        source: { ...evidenceFixture.source, sneaky: true },
      }).success,
    ).toBe(false);
  });

  it('rejects empty confidence signals and out-of-range values', () => {
    const emptySignals = { ...envelope, confidence: { value: 0.5, signals: [] } };
    expect(
      graphNodeArtifactSchema.safeParse({ ...nodeFixture, knowledge: emptySignals }).success,
    ).toBe(false);

    const tooHigh = {
      ...envelope,
      confidence: { value: 1.2, signals: envelope.confidence.signals },
    };
    expect(graphNodeArtifactSchema.safeParse({ ...nodeFixture, knowledge: tooHigh }).success).toBe(
      false,
    );
  });

  it('rejects malformed snapshot heads and commit SHAs', () => {
    expect(
      repositorySnapshotArtifactSchema.safeParse({
        ...snapshotFixture,
        head: { kind: 'tag', commitSha: '4f8a29c' },
      }).success,
    ).toBe(false);
    expect(
      repositorySnapshotArtifactSchema.safeParse({
        ...snapshotFixture,
        head: { kind: 'branch', branch: 'main', commitSha: 'not hex!' },
      }).success,
    ).toBe(false);
  });
});
