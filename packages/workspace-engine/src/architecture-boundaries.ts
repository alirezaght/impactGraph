import { configuredContextMembers } from './overlay-context-graph.js';
import {
  attributionPrefixes,
  crossRepositoryEdges,
  repositoryBreakdown,
} from './repository-attribution.js';

import type { RegisteredRepository, RepositoryRoster } from './registered-repositories.js';
import type {
  CrossRepositoryEdgeReport,
  RepositoryBreakdownEntry,
} from './repository-attribution.js';
import type { ArchitectureConfigDto } from '@impactgraph/contracts';
import type { KnowledgeGraph } from '@impactgraph/domain';

// The boundary blocks of `query_architecture` (item 6): declared contexts, per-repository
// breakdown, cross-repository edges, integration points, and contract documents — everything
// derived at answer time from the graph, the committed configuration, and the roster.

export interface ContextSummaryEntry {
  readonly name: string;
  readonly memberCount: number;
  readonly samplePaths?: readonly string[];
}

const SAMPLE_PATH_LIMIT = 5;

/** Declared bounded contexts with their structural membership. Absent when none are declared. */
export const contextsBlock = (
  graph: KnowledgeGraph,
  architecture: ArchitectureConfigDto,
): readonly ContextSummaryEntry[] | undefined => {
  const membership = configuredContextMembers(graph, architecture);
  if (membership.size === 0) {
    return undefined;
  }
  return [...membership.entries()].map(([name, members]) => {
    const paths = [...new Set(members.map((member) => member.path ?? ''))]
      .filter((path) => path.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, SAMPLE_PATH_LIMIT);
    return {
      name,
      memberCount: members.length,
      ...(paths.length === 0 ? {} : { samplePaths: paths }),
    };
  });
};

/**
 * The integration/contract node families that mark a boundary crossing — the "what am I
 * forgetting" checklist. Counts by type; absent when the graph contains none of them.
 */
export const INTEGRATION_POINT_TYPES: readonly string[] = [
  'topic',
  'queue',
  'subscription',
  'webhook',
  'external-api',
  'openapi-document',
  'openapi-operation',
  'event-definition',
  'unresolved-external-boundary',
];

export const integrationPointsBlock = (
  graph: KnowledgeGraph,
): Record<string, number> | undefined => {
  const counts: Record<string, number> = {};
  for (const node of graph.nodes.values()) {
    if (INTEGRATION_POINT_TYPES.includes(node.type)) {
      counts[node.type] = (counts[node.type] ?? 0) + 1;
    }
  }
  return Object.keys(counts).length === 0 ? undefined : counts;
};

export interface ContractDocumentEntry {
  readonly name: string;
  readonly type: string;
  readonly path?: string;
}

const CONTRACT_TYPES: ReadonlySet<string> = new Set(['openapi-document', 'generated-contract']);

const CONTRACT_LIMIT = 25;

/** Declared contract documents (OpenAPI + generated contracts), bounded and name-sorted. */
export const contractsBlock = (
  graph: KnowledgeGraph,
): readonly ContractDocumentEntry[] | undefined => {
  const documents = [...graph.nodes.values()]
    .filter((node) => CONTRACT_TYPES.has(node.type))
    .map((node) => ({
      name: node.name,
      type: node.type,
      ...(node.path === undefined ? {} : { path: node.path }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type))
    .slice(0, CONTRACT_LIMIT);
  return documents.length === 0 ? undefined : documents;
};

export interface RepositoryBlocks {
  readonly repositories?: readonly RepositoryBreakdownEntry[];
  readonly crossRepositoryEdges?: CrossRepositoryEdgeReport;
}

/**
 * Per-repository breakdown and cross-repository edges — only when related repositories are
 * actually registered. A single-repository workspace gets neither block: a breakdown of one
 * entry and a cross-repository count of zero would be noise dressed as insight.
 */
export const repositoryBlocks = (
  graph: KnowledgeGraph,
  roster: RepositoryRoster,
  prefixOf: (member: RegisteredRepository) => string | undefined,
): RepositoryBlocks => {
  const registered = roster.members.slice(1);
  if (registered.length === 0) {
    return {};
  }
  const prefixes = attributionPrefixes(
    registered.map((member) => {
      const prefix = prefixOf(member);
      return { name: member.name, ...(prefix === undefined ? {} : { path: prefix }) };
    }),
  );
  return {
    repositories: repositoryBreakdown(graph, prefixes),
    crossRepositoryEdges: crossRepositoryEdges(graph, prefixes),
  };
};
