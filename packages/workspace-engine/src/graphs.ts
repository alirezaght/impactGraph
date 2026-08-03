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
