import { deserializeFragment } from '@impactgraph/language-adapters';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { IndexStorePort } from '@impactgraph/application';
import type { RepositorySnapshotId } from '@impactgraph/domain';
import type { CallFact, DecoratorFact, SymbolReference } from '@impactgraph/language-adapters';

// The fragment cache (PRD §32) keeps per-file adapter facts that assembly deliberately does not
// turn into edges: member calls matched by name, string-literal call/decorator arguments, and
// unresolved symbol references. find_references and search_literals read them back at the
// CURRENT snapshot's file hashes, so an answer never mixes two index generations.

/** The read-back fact channels of every cached fragment at one snapshot. */
export interface FragmentFacts {
  readonly callFacts: readonly CallFact[];
  readonly decorators: readonly DecoratorFact[];
  readonly symbolReferences: readonly SymbolReference[];
  /** 1-based start line per evidence id, when the cached evidence carries a file range. */
  readonly lineByEvidenceId: ReadonlyMap<string, number>;
  /** Files the snapshot recorded — the denominator of every honest scope statement. */
  readonly filesSearched: number;
  /** Files whose cached facts were missing or unreadable — counted, never guessed around. */
  readonly filesWithoutCachedFacts: number;
}

/**
 * deserializeFragment rebinds every record to the context it is given. The rebound graph records
 * are DISCARDED here — the persisted graph stays the only authority — and only the fact channels
 * plus the evidence ranges are read, both of which are content-derived and snapshot-neutral.
 * The constant timestamp exists solely to satisfy the domain parser; it is never stored.
 */
const FACT_READ_CREATED_AT = '1970-01-01T00:00:00.000Z';

export const loadFragmentFacts = async (
  store: IndexStorePort,
  snapshotId: string,
): Promise<Failable<FragmentFacts>> => {
  const hashes = await store.getFileHashes(snapshotId as RepositorySnapshotId);
  if (!hashes.ok) {
    return failWith('indexingFailure', hashes.error.message);
  }
  const requests = Object.entries(hashes.value).map(([filePath, contentHash]) => ({
    filePath,
    contentHash,
  }));
  const cached = await store.getCachedFragments(requests);
  if (!cached.ok) {
    return failWith('indexingFailure', cached.error.message);
  }
  // Map, not object lookup: file paths are untrusted repository text (PRD §42.5).
  const payloadByPath = new Map(Object.entries(cached.value));
  const context = {
    repositorySnapshotId: snapshotId,
    analysisRunId: 'fragment-fact-read',
    createdAt: FACT_READ_CREATED_AT,
  };
  const callFacts: CallFact[] = [];
  const decorators: DecoratorFact[] = [];
  const symbolReferences: SymbolReference[] = [];
  const lineByEvidenceId = new Map<string, number>();
  let filesWithFacts = 0;
  for (const request of requests) {
    const payload = payloadByPath.get(request.filePath);
    const fragment = payload === undefined ? undefined : deserializeFragment(payload, context);
    if (fragment === undefined) {
      continue; // missing or unreadable cache entry — counted below, never guessed around
    }
    filesWithFacts += 1;
    callFacts.push(...fragment.callFacts);
    decorators.push(...fragment.decorators);
    symbolReferences.push(...fragment.symbolReferences);
    for (const record of fragment.evidence) {
      if (record.source.kind === 'file' && record.source.range !== undefined) {
        lineByEvidenceId.set(record.id, record.source.range.startLine);
      }
    }
  }
  return {
    ok: true,
    value: {
      callFacts,
      decorators,
      symbolReferences,
      lineByEvidenceId,
      filesSearched: requests.length,
      filesWithoutCachedFacts: requests.length - filesWithFacts,
    },
  };
};

/** The empty channels — what a degraded reference query searches when the cache is unreadable. */
export const EMPTY_FRAGMENT_FACTS: FragmentFacts = {
  callFacts: [],
  decorators: [],
  symbolReferences: [],
  lineByEvidenceId: new Map<string, number>(),
  filesSearched: 0,
  filesWithoutCachedFacts: 0,
};
