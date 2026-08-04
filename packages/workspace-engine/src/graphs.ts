import { createKnowledgeGraph } from '@impactgraph/domain';
import { indexDatabasePath, openSqliteIndexStore } from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { IndexStorePort } from '@impactgraph/application';
import type { KnowledgeGraph, RepositorySnapshotId } from '@impactgraph/domain';

export const loadGraphAt = async (
  store: IndexStorePort,
  snapshotId: string,
  role: string,
): Promise<Failable<KnowledgeGraph>> => {
  const stored = await store.loadGraph(snapshotId as RepositorySnapshotId);
  if (!stored.ok) {
    return failWith('indexingFailure', stored.error.message);
  }
  const graph = createKnowledgeGraph(stored.value.nodes, stored.value.edges);
  if (!graph.ok) {
    return failWith('indexingFailure', `stored ${role} graph failed validation`);
  }
  return { ok: true, value: graph.value };
};

export interface CurrentGraph {
  readonly graph: KnowledgeGraph;
  readonly snapshotId: string;
}

export const loadCurrentGraph = async (store: IndexStorePort): Promise<Failable<CurrentGraph>> => {
  const current = await store.getCurrentSnapshotId();
  if (!current.ok || current.value === undefined) {
    return failWith(
      'configurationError',
      'no completed index generation — run `impactgraph index` first',
    );
  }
  const graph = await loadGraphAt(store, current.value, 'current');
  if (!graph.ok) {
    return graph;
  }
  return { ok: true, value: { graph: graph.value, snapshotId: current.value } };
};

/**
 * The graph of one specific snapshot, opening and closing the store itself.
 *
 * A stored analysis is bound to the snapshot it was built at, and rendering it against the CURRENT
 * graph would silently mix two states — node ids that no longer exist would go missing without
 * explanation. Callers that hold an analysis therefore ask for its own snapshot by id.
 */
export const loadGraphForSnapshot = async (
  rootDir: string,
  snapshotId: string,
): Promise<Failable<KnowledgeGraph>> =>
  withIndexStore(rootDir, async (store) => {
    const graph = await loadGraphAt(store, snapshotId, 'analysis');
    if (!graph.ok) {
      return graph;
    }
    if (graph.value.nodes.size === 0) {
      return failWith(
        'indexingFailure',
        `snapshot ${snapshotId} is no longer in the local index — the cache was rebuilt since the analysis was created. Re-run the analysis.`,
      );
    }
    return graph;
  });

/** Open the disposable SQLite index, run `work`, and always close the store. */
export const withIndexStore = async <T>(
  rootDir: string,
  work: (store: IndexStorePort) => Promise<Failable<T>>,
): Promise<Failable<T>> => {
  const store = openSqliteIndexStore(indexDatabasePath(rootDir));
  if (!store.ok) {
    return failWith('indexingFailure', store.error.message);
  }
  try {
    return await work(store.value);
  } finally {
    await store.value.close();
  }
};
