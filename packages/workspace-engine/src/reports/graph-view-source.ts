import { loadCurrentGraph, withIndexStore } from '../graphs.js';
import { applicationsForGraph, contextsForGraph } from '../overlay.js';

import { buildGraphView } from './graph-view.js';

import type { Failable } from '../failure.js';
import type { GraphGrouping, GraphView } from './graph-view-model.js';
import type { KnowledgeGraph } from '@impactgraph/domain';

// Loads the architecture read model from the CURRENT index. Read-only: it opens the disposable
// SQLite index, projects the stored graph, and closes it. No re-scan, no writes, no network.

/** Package-node names, so `--group package` never groups under a workspace root. */
const packageNames = (graph: KnowledgeGraph): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.type === 'package') {
      names.add(node.name);
    }
  }
  return names;
};

/**
 * §18.4 grouping. `context` is the default and falls back to the owning application when no
 * bounded context is assigned — a fallback that is LABELLED in the view rather than presented as
 * a context, because inventing a context from a path is exactly what §Z5 forbids.
 */
const groupingFor = (
  rootDir: string,
  graph: KnowledgeGraph,
  grouping: GraphGrouping,
): ReadonlyMap<string, string> => {
  const applications = applicationsForGraph(graph);
  if (grouping === 'application') {
    return applications;
  }
  if (grouping === 'package') {
    const packages = packageNames(graph);
    return new Map([...applications.entries()].filter(([, owner]) => packages.has(owner)));
  }
  const contexts = contextsForGraph(rootDir, graph);
  const merged = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    const context = contexts.get(node.id);
    const owner = applications.get(node.id);
    const label = context ?? (owner === undefined ? undefined : `${owner} (no context)`);
    if (label !== undefined) {
      merged.set(node.id, label);
    }
  }
  return merged;
};

export const loadGraphView = async (
  rootDir: string,
  grouping: GraphGrouping,
): Promise<Failable<GraphView>> =>
  withIndexStore(rootDir, async (store) => {
    const current = await loadCurrentGraph(store);
    if (!current.ok) {
      return current;
    }
    const graph = current.value.graph;
    return {
      ok: true,
      value: buildGraphView({
        snapshotId: current.value.snapshotId,
        grouping,
        nodes: [...graph.nodes.values()],
        edges: [...graph.edges.values()],
        groupOf: groupingFor(rootDir, graph, grouping),
      }),
    };
  });
