import { describe, expect, it } from 'vitest';

import { createEvidenceRecord, EVIDENCE_KINDS } from '../index.js';

import type { CreateEvidenceRecordInput } from '../index.js';

const validInput: CreateEvidenceRecordInput = {
  id: 'ev-import-dealservice-1',
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

describe('EvidenceRecord (provenance-model.md, PRD §18.5)', () => {
  it('exposes the evidence kind vocabulary', () => {
    expect(EVIDENCE_KINDS).toContain('import-statement');
    expect(EVIDENCE_KINDS).toContain('config-entry');
    expect(EVIDENCE_KINDS).toContain('human-statement');
    expect(EVIDENCE_KINDS).toContain('model-output-reference');
  });

  it('constructs an immutable record bound to a file range and snapshot', () => {
    const result = createEvidenceRecord(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.repositorySnapshotId).toBe('snap-4f8a29c');
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.source)).toBe(true);
    }
  });

  it('supports config-key and git-commit source bindings', () => {
    const config = createEvidenceRecord({
      ...validInput,
      id: 'ev-config-1',
      kind: 'config-entry',
      source: {
        kind: 'config',
        filePath: '.impactgraph/architecture.yml',
        configKey: 'contexts.search',
      },
    });
    expect(config.ok).toBe(true);

    const commit = createEvidenceRecord({
      ...validInput,
      id: 'ev-cochange-1',
      kind: 'co-change-history',
      source: { kind: 'git-commit', commitSha: 'a1b2c3d' },
    });
    expect(commit.ok).toBe(true);
  });

  it('rejects blank ids, unknown kinds, and malformed timestamps', () => {
    expect(createEvidenceRecord({ ...validInput, id: '  ' }).ok).toBe(false);
    expect(createEvidenceRecord({ ...validInput, kind: 'vibes' }).ok).toBe(false);
    expect(createEvidenceRecord({ ...validInput, createdAt: 'yesterday' }).ok).toBe(false);
    expect(createEvidenceRecord({ ...validInput, repositorySnapshotId: '' }).ok).toBe(false);
  });

  it('rejects a file source with a blank path or an inverted range', () => {
    const blankPath = createEvidenceRecord({
      ...validInput,
      source: { kind: 'file', filePath: ' ' },
    });
    expect(blankPath.ok).toBe(false);

    const invertedRange = createEvidenceRecord({
      ...validInput,
      source: {
        kind: 'file',
        filePath: 'src/a.ts',
        range: { startLine: 10, startColumn: 1, endLine: 2, endColumn: 1 },
      },
    });
    expect(invertedRange.ok).toBe(false);
  });
});
