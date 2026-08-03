import { readArchitectureConfig } from '@impactgraph/persistence';

import { resolveComponent } from './overlay-components.js';
import { levelForProvenance, levelForSource, precedenceRank } from './overlay-precedence.js';

import type {
  ComponentOverlayInputs,
  EffectiveComponent,
  PackageDirectory,
} from './overlay-components.js';
import type { PrecedenceLevel, Resolved } from './overlay-precedence.js';
import type { ArchitectureConfigDto } from '@impactgraph/contracts';
import type { KnowledgeGraph, NodeId } from '@impactgraph/domain';

// PRD §16 + §Z5 — the config/graph merge layer. Corrections committed to `.impactgraph/` are
// applied as a READ-TIME OVERLAY: the deterministic graph is never mutated, so reindexing can
// never lose a human correction and a correction can never fabricate a graph fact (§34, §43.3).
// Every effective value reports which precedence level produced it.

export type { EffectiveComponent, EffectiveMarker } from './overlay-components.js';
export type { PrecedenceLevel, Resolved } from './overlay-precedence.js';
export { precedenceRank } from './overlay-precedence.js';

export interface EffectiveRelationship {
  readonly edgeId: string;
  readonly status: 'confirmed' | 'rejected' | 'undecided';
  /** Rejected relationships are EXCLUDED from the effective view — listed, never dropped. */
  readonly excluded: boolean;
  readonly reason?: string | undefined;
  readonly level: PrecedenceLevel;
  readonly rank: number;
  readonly provenance: string;
  readonly detail: string;
}

export interface CorrectionSummary {
  readonly renamed: number;
  readonly rolesSet: number;
  readonly contextsAssigned: number;
  readonly marked: number;
  /** Components resolving to a committed owner (§16 ownership). */
  readonly ownersSet: number;
  readonly confirmedRelationships: number;
  readonly rejectedRelationships: number;
  readonly merged: number;
}

export interface EffectiveView {
  readonly components: ReadonlyMap<string, EffectiveComponent>;
  readonly relationships: ReadonlyMap<string, EffectiveRelationship>;
  readonly rejectedEdgeIds: ReadonlySet<string>;
  readonly summary: CorrectionSummary;
}

const directoryOf = (manifestPath: string | undefined): string =>
  manifestPath === undefined || !manifestPath.includes('/')
    ? ''
    : manifestPath.slice(0, manifestPath.lastIndexOf('/'));

/** Package nodes give the §Z5 level-3 "repository-native metadata" fallback for context. */
const packageDirectories = (graph: KnowledgeGraph): PackageDirectory[] => {
  const packages: PackageDirectory[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type === 'package') {
      packages.push({
        directory: directoryOf(node.path),
        name: node.name,
        provenance: node.knowledge.provenance,
      });
    }
  }
  return packages;
};

const resolveRelationships = (
  graph: KnowledgeGraph,
  architecture: ArchitectureConfigDto,
): Map<string, EffectiveRelationship> => {
  const decisions = new Map(
    (architecture.relationships ?? []).map((entry) => [entry.edgeId, entry] as const),
  );
  const resolvedEdges = new Map<string, EffectiveRelationship>();
  for (const edge of graph.edges.values()) {
    const decision = decisions.get(edge.id);
    if (decision === undefined) {
      const level = levelForProvenance(edge.knowledge.provenance);
      resolvedEdges.set(edge.id, {
        edgeId: edge.id,
        status: 'undecided',
        excluded: false,
        level,
        rank: precedenceRank(level),
        provenance: edge.knowledge.provenance,
        detail: 'no human decision recorded — the relationship stands as detected',
      });
      continue;
    }
    const level = levelForSource(decision.source);
    resolvedEdges.set(edge.id, {
      edgeId: edge.id,
      status: decision.confirmed ? 'confirmed' : 'rejected',
      excluded: !decision.confirmed,
      reason: decision.reason,
      level,
      rank: precedenceRank(level),
      provenance: level === 'human-confirmed' ? 'human-confirmed' : 'llm-inferred',
      detail: `architecture.yml relationships: ${decision.confirmed ? 'confirmed' : 'rejected'} — ${decision.reason}`,
    });
  }
  return resolvedEdges;
};

/** Components whose effective name collides are the §16 "merge duplicate components" outcome. */
const applyMerges = (components: Map<string, EffectiveComponent>): number => {
  const byName = new Map<string, string[]>();
  for (const component of components.values()) {
    const bucket = byName.get(component.name.value);
    if (bucket === undefined) {
      byName.set(component.name.value, [component.nodeId]);
    } else {
      bucket.push(component.nodeId);
    }
  }
  let merged = 0;
  for (const [, nodeIds] of byName) {
    if (nodeIds.length < 2) {
      continue;
    }
    const renamedInGroup = nodeIds.some(
      (nodeId) => components.get(nodeId)?.name.value !== components.get(nodeId)?.graphName,
    );
    if (!renamedInGroup) {
      continue;
    }
    merged += 1;
    for (const nodeId of nodeIds) {
      const component = components.get(nodeId);
      if (component !== undefined) {
        components.set(nodeId, {
          ...component,
          mergedWithNodeIds: nodeIds.filter((other) => other !== nodeId),
        });
      }
    }
  }
  return merged;
};

const summarize = (
  components: ReadonlyMap<string, EffectiveComponent>,
  relationships: ReadonlyMap<string, EffectiveRelationship>,
  merged: number,
): CorrectionSummary => {
  const fromConfig = (level: PrecedenceLevel): boolean =>
    level === 'human-confirmed' || level === 'agent-approved';
  let renamed = 0;
  let rolesSet = 0;
  let contextsAssigned = 0;
  let marked = 0;
  let ownersSet = 0;
  for (const component of components.values()) {
    renamed += component.name.value === component.graphName ? 0 : 1;
    rolesSet += component.role.value !== undefined && fromConfig(component.role.level) ? 1 : 0;
    contextsAssigned +=
      component.context.value !== undefined && fromConfig(component.context.level) ? 1 : 0;
    marked += component.markers.length > 0 ? 1 : 0;
    ownersSet += component.owner.value === undefined ? 0 : 1;
  }
  const statuses = [...relationships.values()];
  return {
    renamed,
    rolesSet,
    contextsAssigned,
    marked,
    ownersSet,
    confirmedRelationships: statuses.filter((entry) => entry.status === 'confirmed').length,
    rejectedRelationships: statuses.filter((entry) => entry.status === 'rejected').length,
    merged,
  };
};

/** Pure resolver: graph + committed configuration → the effective view. No I/O, no mutation. */
export const resolveOverlay = (
  graph: KnowledgeGraph,
  architecture: ArchitectureConfigDto,
): EffectiveView => {
  const inputs: ComponentOverlayInputs = { architecture, packages: packageDirectories(graph) };
  const components = new Map<string, EffectiveComponent>();
  for (const node of graph.nodes.values()) {
    components.set(node.id, resolveComponent(node, inputs));
  }
  const merged = applyMerges(components);
  const relationships = resolveRelationships(graph, architecture);
  const rejectedEdgeIds = new Set(
    [...relationships.values()].filter((entry) => entry.excluded).map((entry) => entry.edgeId),
  );
  return {
    components,
    relationships,
    rejectedEdgeIds,
    summary: summarize(components, relationships, merged),
  };
};

/** Committed architecture knowledge for the overlay; an unreadable file overlays nothing. */
export const readOverlayConfig = (rootDir: string): ArchitectureConfigDto => {
  const architecture = readArchitectureConfig(rootDir);
  return architecture.ok ? (architecture.value ?? { schemaVersion: 1 }) : { schemaVersion: 1 };
};

export const overlayFor = (rootDir: string, graph: KnowledgeGraph): EffectiveView =>
  resolveOverlay(graph, readOverlayConfig(rootDir));

/**
 * Effective bounded context per node id (§18.4 grouping, §Z5 precedence). Only nodes that
 * actually resolve to a context appear — an absent entry means "no context assigned", which
 * the UI must render as unknown rather than inventing one from the path.
 */
export const contextsForGraph = (
  rootDir: string,
  graph: KnowledgeGraph,
): ReadonlyMap<string, string> => {
  const view = overlayFor(rootDir, graph);
  const byNode = new Map<string, string>();
  for (const [nodeId, component] of view.components) {
    if (component.context.value !== undefined) {
      byNode.set(nodeId, component.context.value);
    }
  }
  return byNode;
};

/**
 * Owning application per node id (§18.4 "group by application"). An application is the package or
 * workspace that CONTAINS the node — walked transitively, because a symbol is contained by a file
 * which is contained by a package. A node no package contains simply has no entry: absent means
 * "not owned by any declared application", never a guess from its path.
 */
/** Nodes a CONTAINS edge leads to from `nodeId`, in graph order. */
const containedNodeIds = (graph: KnowledgeGraph, nodeId: string): string[] => {
  const targets: string[] = [];
  for (const edgeId of graph.outgoing.get(nodeId as NodeId) ?? []) {
    const edge = graph.edges.get(edgeId);
    if (edge !== undefined && edge.type === 'CONTAINS') {
      targets.push(edge.targetId);
    }
  }
  return targets;
};

/**
 * Owning application per node id (§18.4 "group by application"). An application is the package or
 * workspace that CONTAINS the node — walked transitively, because a symbol is contained by a file
 * which is contained by a package. A node no package contains simply has no entry: absent means
 * "not owned by any declared application", never a guess from its path.
 */
/** Claim every node reachable from one package over CONTAINS. First claim wins. */
const claimContained = (
  graph: KnowledgeGraph,
  rootId: string,
  applicationName: string,
  owners: Map<string, string>,
): void => {
  const queue = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const current = queue.shift() ?? '';
    const fresh = containedNodeIds(graph, current).filter((target) => !seen.has(target));
    for (const target of fresh) {
      seen.add(target);
      // A nested package cannot steal a file the package visited before it already claimed.
      owners.set(target, owners.get(target) ?? applicationName);
      queue.push(target);
    }
  }
};

/**
 * Owning application per node id (§18.4 "group by application"). An application is the package or
 * workspace that CONTAINS the node — walked transitively, because a symbol is contained by a file
 * which is contained by a package. A node no package contains simply has no entry: absent means
 * "not owned by any declared application", never a guess from its path.
 */
export const applicationsForGraph = (graph: KnowledgeGraph): ReadonlyMap<string, string> => {
  const owners = new Map<string, string>();
  const roots = [...graph.nodes.values()].filter(
    (node) => node.type === 'package' || node.type === 'workspace',
  );
  for (const root of roots) {
    claimContained(graph, root.id, root.name, owners);
  }
  return owners;
};

const defaultsResolution = (detail: string): Omit<EffectiveRelationship, 'edgeId' | 'status'> => ({
  excluded: false,
  level: 'defaults',
  rank: precedenceRank('defaults'),
  provenance: 'framework-convention',
  detail,
});

/**
 * Total lookups. A view is keyed by the graph it was built from; asking for an id that graph does
 * not contain legitimately answers at the `defaults` level rather than throwing or returning null.
 */
const unknownResolution = <T>(value: T): Resolved<T> => ({
  value,
  level: 'defaults',
  rank: precedenceRank('defaults'),
  provenance: 'framework-convention',
  detail: 'not in this graph',
});

export const componentOf = (view: EffectiveView, nodeId: string): EffectiveComponent =>
  view.components.get(nodeId) ?? {
    nodeId,
    graphName: nodeId,
    name: unknownResolution(nodeId),
    role: unknownResolution(undefined),
    context: unknownResolution(undefined),
    owner: unknownResolution(undefined),
    markers: [],
    mergedWithNodeIds: [],
  };

export const relationshipOf = (view: EffectiveView, edgeId: string): EffectiveRelationship =>
  view.relationships.get(edgeId) ?? {
    edgeId,
    status: 'undecided',
    ...defaultsResolution('not in this graph'),
  };
