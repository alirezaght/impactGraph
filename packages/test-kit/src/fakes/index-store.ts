import { ok } from '@impactgraph/domain';

import type { FragmentCacheEntry, IndexStorePort } from '@impactgraph/application';
import type { GraphEdge, GraphNode, RepositorySnapshotId } from '@impactgraph/domain';

/**
 * In-memory IndexStorePort fake: one fixed "current" snapshot with a hand-built graph and,
 * optionally, pre-serialized fragment-cache payloads per file path. Enough for engine-level
 * queries (graph reads + fragment-fact reads) without SQLite or a fixture repository.
 *
 * Payloads are stored in a Map, never a plain object: file paths are test data here but
 * untrusted repository text in production, and object lookups answer `constructor` from the
 * prototype (PRD §42.5) — the fake must not model a lookup the real store would never do.
 */
export interface FakeIndexStoreInput {
  readonly snapshotId: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Serialized fragment payloads keyed by file path (use language-adapters' serializeFragment). */
  readonly fragmentPayloads?: ReadonlyMap<string, string>;
}

export const createFakeIndexStore = (input: FakeIndexStoreInput): IndexStorePort => {
  const payloads = input.fragmentPayloads ?? new Map<string, string>();
  const hashes = Object.fromEntries(
    [...payloads.keys()].map((filePath) => [filePath, `hash:${filePath}`]),
  );
  return {
    applyIndexUpdate: () => Promise.resolve(ok(undefined)),
    loadGraph: () => Promise.resolve(ok({ nodes: input.nodes, edges: input.edges })),
    getSnapshot: () => Promise.resolve(ok(undefined)),
    listSnapshots: () => Promise.resolve(ok([])),
    getEvidence: () => Promise.resolve(ok([])),
    getFileHashes: () => Promise.resolve(ok(hashes)),
    getCurrentSnapshotId: () =>
      Promise.resolve(ok(input.snapshotId as RepositorySnapshotId | undefined)),
    cacheFragments: () => Promise.resolve(ok(undefined)),
    getCachedFragments: (
      requests: readonly Pick<FragmentCacheEntry, 'filePath' | 'contentHash'>[],
    ) => {
      const found: Record<string, string> = {};
      for (const request of requests) {
        const payload = payloads.get(request.filePath);
        if (payload !== undefined) {
          found[request.filePath] = payload;
        }
      }
      return Promise.resolve(ok(found));
    },
    saveRunRecord: () => Promise.resolve(ok(undefined)),
    getRunRecord: () => Promise.resolve(ok(undefined)),
    close: () => Promise.resolve(),
  };
};
