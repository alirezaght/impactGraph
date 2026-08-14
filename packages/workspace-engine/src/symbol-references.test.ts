import { createEvidenceRecord, createGraphEdge, createGraphNode } from '@impactgraph/domain';
import { serializeFragment } from '@impactgraph/language-adapters';
import { createFakeIndexStore } from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import { findReferencesInStore } from './symbol-references.js';

import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type { CallFact, GraphFragment, SymbolReference } from '@impactgraph/language-adapters';

// find_references against a hand-built graph + fragment-cache fake: the questions a real session
// had to answer with grep. Structural edges and name-matched call sites must stay visibly apart.

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-14T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, type: string, path?: string): GraphNode => {
  const created = createGraphNode({
    id,
    name,
    category: type === 'file' ? 'repository' : 'application',
    type,
    ...(path === undefined ? {} : { path }),
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`bad fixture node: ${id}`);
  }
  return created.value;
};

const edge = (type: string, sourceId: string, targetId: string): GraphEdge => {
  const created = createGraphEdge({
    id: `${type}:${sourceId}->${targetId}`,
    type,
    sourceId,
    targetId,
    knowledge,
  });
  if (!created.ok) {
    throw new Error(`bad fixture edge: ${sourceId}->${targetId}`);
  }
  return created.value;
};

const evidence = (id: string, filePath: string, startLine: number) => {
  const created = createEvidenceRecord({
    id,
    kind: 'call-site',
    source: {
      kind: 'file',
      filePath,
      range: { startLine, startColumn: 1, endLine: startLine, endColumn: 40 },
    },
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-14T10:00:00.000Z',
  });
  if (!created.ok) {
    throw new Error(`bad fixture evidence: ${id}`);
  }
  return created.value;
};

const fragment = (input: {
  callFacts?: CallFact[];
  symbolReferences?: SymbolReference[];
  evidence?: ReturnType<typeof evidence>[];
}): GraphFragment => ({
  nodes: [],
  edges: [],
  evidence: input.evidence ?? [],
  imports: [],
  symbolReferences: input.symbolReferences ?? [],
  decorators: [],
  callFacts: input.callFacts ?? [],
  exportsByFile: {},
  warnings: [],
});

const NODES = [
  node('sym:listing-repo', 'ListingRepository', 'interface', 'src/domain/listing-repository.ts'),
  node('sym:sql-repo', 'SqlListingRepository', 'class', 'src/infra/sql-listing-repository.ts'),
  node('sym:mem-repo', 'MemListingRepository', 'class', 'src/infra/mem-listing-repository.ts'),
  node('sym:remove-item', 'remove_item', 'function', 'src/store.py'),
  node('sym:cleanup', 'cleanup', 'function', 'src/jobs/cleanup.py'),
  node('sym:archive', 'archive', 'function', 'src/jobs/archive.py'),
  node('sym:dup-a', 'Duplicate', 'class', 'src/a.ts'),
  node('sym:dup-b', 'Duplicate', 'class', 'src/b.ts'),
  node('sym:deal-repo', 'DealRepository', 'class', 'src/lib/deal-repository.ts'),
  node(
    'file:src/lib/deal-repository.ts',
    'deal-repository.ts',
    'file',
    'src/lib/deal-repository.ts',
  ),
];

const EDGES = [
  edge('IMPLEMENTS', 'sym:sql-repo', 'sym:listing-repo'),
  edge('IMPLEMENTS', 'sym:mem-repo', 'sym:listing-repo'),
  edge('CALLS', 'sym:cleanup', 'sym:remove-item'),
  edge('CALLS', 'sym:archive', 'sym:remove-item'),
];

const CALL_FACT: CallFact = {
  filePath: 'src/api/items.py',
  receiverName: 'store',
  calleeName: 'remove_item',
  stringArguments: ['item-123'],
  identifierArguments: [],
  evidenceId: 'ev-call-1',
};

const UNRESOLVED_CALL_REFERENCE: SymbolReference = {
  kind: 'calls',
  fromSymbolNodeId: 'sym:ghost-caller',
  filePath: 'src/legacy/tasks.py',
  targetName: 'remove_item',
  evidenceId: 'ev-ref-1',
};

const storeWithFacts = () =>
  createFakeIndexStore({
    snapshotId: 'snap-1',
    nodes: NODES,
    edges: EDGES,
    fragmentPayloads: new Map([
      [
        'src/api/items.py',
        serializeFragment(
          fragment({
            callFacts: [CALL_FACT],
            evidence: [evidence('ev-call-1', 'src/api/items.py', 12)],
          }),
        ),
      ],
      [
        'src/legacy/tasks.py',
        serializeFragment(
          fragment({
            symbolReferences: [UNRESOLVED_CALL_REFERENCE],
            evidence: [evidence('ev-ref-1', 'src/legacy/tasks.py', 7)],
          }),
        ),
      ],
    ]),
  });

const unwrap = async (query: string, kinds?: string[], limit?: number) => {
  const result = await findReferencesInStore(storeWithFacts(), {
    query,
    ...(kinds === undefined ? {} : { kinds: kinds as never }),
    ...(limit === undefined ? {} : { limit }),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe('findReferences — structural relations', () => {
  it('returns the implementers of an interface as incoming IMPLEMENTS', async () => {
    const result = await unwrap('ListingRepository', ['implementations']);
    expect(result.resolution).toBe('resolved');
    expect(result.resolved?.nodeId).toBe('sym:listing-repo');
    expect(result.references).toHaveLength(1);
    const group = result.references[0];
    expect(group?.kind).toBe('implementations');
    expect(group?.edgeType).toBe('IMPLEMENTS');
    expect(group?.direction).toBe('incoming');
    expect(group?.counterparts.map((hit) => hit.name)).toEqual([
      'MemListingRepository',
      'SqlListingRepository',
    ]);
    expect(group?.counterparts.every((hit) => hit.provenance === 'static-analysis')).toBe(true);
  });

  it('returns callers as incoming CALLS AND labeled name-matched call sites', async () => {
    const result = await unwrap('remove_item', ['callers']);
    const callers = result.references.find((group) => group.kind === 'callers');
    expect(callers?.counterparts.map((hit) => hit.name)).toEqual(['archive', 'cleanup']);
    // the member call `store.remove_item('item-123')` never became an edge — it is here anyway,
    // labeled as a name match, with receiver, line and the string argument
    expect(result.nameMatchedCallSites).toEqual([
      {
        basis: 'name-match',
        filePath: 'src/api/items.py',
        calleeName: 'remove_item',
        receiver: 'store',
        line: 12,
        sampleArgument: 'item-123',
      },
      {
        basis: 'name-match',
        filePath: 'src/legacy/tasks.py',
        calleeName: 'remove_item',
        line: 7,
      },
    ]);
    expect(result.nameMatchedCallSiteTotal).toBe(2);
  });

  it('respects the limit per group and reports the pre-limit total', async () => {
    const result = await unwrap('remove_item', ['callers'], 1);
    const callers = result.references[0];
    expect(callers?.counterparts).toHaveLength(1);
    expect(callers?.totalCount).toBe(2);
    expect(result.nameMatchedCallSites).toHaveLength(1);
    expect(result.nameMatchedCallSiteTotal).toBe(2);
  });

  it('resolves by nodeId directly', async () => {
    const result = await unwrap('sym:listing-repo', ['implementations']);
    expect(result.resolution).toBe('resolved');
    expect(result.resolved?.name).toBe('ListingRepository');
  });

  it('prefers the exact-named symbol over its normalized-name file node', async () => {
    const result = await unwrap('DealRepository');
    expect(result.resolution).toBe('resolved');
    expect(result.resolved?.nodeId).toBe('sym:deal-repo');
  });
});

describe('findReferences — honesty on ambiguity and absence', () => {
  it('several exact matches return disambiguation candidates, never a guess', async () => {
    const result = await unwrap('Duplicate');
    expect(result.resolution).toBe('ambiguous');
    expect(result.resolved).toBeUndefined();
    expect(result.candidates?.map((candidate) => candidate.nodeId)).toEqual([
      'sym:dup-a',
      'sym:dup-b',
    ]);
    expect(result.references).toEqual([]);
  });

  it('an unindexed name still answers with name-matched call sites, marked not-found', async () => {
    // remove the symbol node: the name exists only as a member call in the fragment cache
    const store = createFakeIndexStore({
      snapshotId: 'snap-1',
      nodes: NODES.filter((entry) => entry.id !== ('sym:remove-item' as never)),
      edges: [],
      fragmentPayloads: new Map([
        [
          'src/api/items.py',
          serializeFragment(
            fragment({
              callFacts: [CALL_FACT],
              evidence: [evidence('ev-call-1', 'src/api/items.py', 12)],
            }),
          ),
        ],
      ]),
    });
    const result = await findReferencesInStore(store, { query: 'remove_item' });
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.resolution).toBe('not-found');
    expect(result.value.nameMatchedCallSites).toHaveLength(1);
    expect(result.value.nameMatchedCallSites[0]?.basis).toBe('name-match');
  });

  it('a dotted query matches call sites by its member name', async () => {
    const result = await unwrap('ItemStore.remove_item');
    expect(result.resolution).toBe('not-found');
    expect(result.nameMatchedCallSiteTotal).toBe(2);
  });

  it('every result carries the coverage statement with snapshot, scope and known limits', async () => {
    for (const query of ['ListingRepository', 'Duplicate', 'totally_unknown_name']) {
      const result = await unwrap(query);
      expect(result.coverage.snapshotId).toBe('snap-1');
      expect(result.coverage.searched.length).toBeGreaterThanOrEqual(2);
      expect(result.coverage.searched.join(' ')).toContain('snap-1');
      expect(result.coverage.knownLimits.some((limit) => limit.includes('name'))).toBe(true);
      expect(result.coverage.knownLimits.some((limit) => limit.includes('full-text'))).toBe(true);
      expect(result.coverage.filesSearched).toBe(2);
      expect(result.coverage.filesWithoutCachedFacts).toBe(0);
    }
  });
});
