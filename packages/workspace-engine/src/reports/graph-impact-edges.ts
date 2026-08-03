import { knowledgeCategoryForProvenance } from '@impactgraph/contracts';

import type { RenderCategory } from './graph-render-category.js';
import type { GraphEdgeStatus, GraphViewEdge } from './graph-view-model.js';
import type { ProposedStructure, RequirementImpact } from '@impactgraph/domain';

// Relationships for the impact view (PRD §18.4). Two sources, kept strictly apart:
//
//   * CURRENT — the dependency-path hops the traversal actually walked. An impact reached at two
//     hops is a different claim from a direct match, so the paths are drawn, not just counted. Each
//     hop is resolved back to the real graph edge behind it, so an arrow says `IMPORTS ×12` rather
//     than an unfalsifiable "depends on".
//   * PROPOSED — relationships an architectural option WOULD create. They never enter the current
//     buckets: `status` is part of the aggregation key, so a current arrow and a proposed arrow
//     between the same two groups stay two arrows (§3).

/** `sourceId targetId` → the graph edge behind that hop, when the resolved graph has one. */
export type HopEdgeIndex = ReadonlyMap<
  string,
  { readonly type: string; readonly provenance: string }
>;

export const hopKey = (sourceId: string, targetId: string): string => `${sourceId} ${targetId}`;

export interface ImpactEdgeInput {
  readonly impacts: readonly RequirementImpact[];
  readonly proposed?: ProposedStructure | undefined;
  readonly hopEdges: HopEdgeIndex;
  /** Only groups that got a box can carry an arrow; the rest are counted and reported. */
  readonly drawnGroups: ReadonlySet<string>;
  readonly groupFor: (nodeId: string) => string;
  readonly proposedGroupLabel: string;
}

export interface ImpactEdgeResult {
  readonly aggregated: readonly GraphViewEdge[];
  /** Distinct (source, target) hop pairs across every dependency path in the analysis. */
  readonly hopPairs: number;
  readonly intraGroup: number;
  readonly interGroup: number;
  /** Cross-group hop pairs both of whose groups were drawn, so an arrow could be emitted. */
  readonly drawnHops: number;
  readonly proposedTotal: number;
  readonly proposedDrawn: number;
}

interface Bucket {
  readonly sourceGroupId: string;
  readonly targetGroupId: string;
  readonly knowledgeCategory: RenderCategory;
  readonly status: GraphEdgeStatus;
  readonly kinds: Map<string, number>;
  count: number;
}

const categoryOf = (provenance: string): RenderCategory =>
  knowledgeCategoryForProvenance(provenance) ?? 'unknown';

const bucketKey = (bucket: Omit<Bucket, 'kinds' | 'count'>): string =>
  `${bucket.sourceGroupId}\t${bucket.targetGroupId}\t${bucket.knowledgeCategory}\t${bucket.status}`;

const addToBucket = (
  buckets: Map<string, Bucket>,
  identity: Omit<Bucket, 'kinds' | 'count'>,
  kind: string,
): void => {
  const key = bucketKey(identity);
  const bucket: Bucket = buckets.get(key) ?? { ...identity, kinds: new Map(), count: 0 };
  buckets.set(key, bucket);
  bucket.count += 1;
  bucket.kinds.set(kind, (bucket.kinds.get(kind) ?? 0) + 1);
};

/** Distinct hop pairs, so a hop walked by forty impacts is one structural relationship, not forty. */
const distinctHops = (impacts: readonly RequirementImpact[]): [string, string][] => {
  const seen = new Map<string, [string, string]>();
  for (const impact of impacts) {
    const path = impact.dependencyPath;
    for (let index = 0; index + 1 < path.length; index += 1) {
      const source = path[index];
      const target = path[index + 1];
      if (source !== undefined && target !== undefined) {
        seen.set(hopKey(source, target), [source, target]);
      }
    }
  }
  return [...seen.values()];
};

interface HopTally {
  intraGroup: number;
  interGroup: number;
  drawnHops: number;
}

const collectHops = (
  input: ImpactEdgeInput,
  buckets: Map<string, Bucket>,
  tally: HopTally,
): void => {
  for (const [source, target] of distinctHops(input.impacts)) {
    const sourceGroupId = input.groupFor(source);
    const targetGroupId = input.groupFor(target);
    if (sourceGroupId === targetGroupId) {
      tally.intraGroup += 1;
      continue;
    }
    tally.interGroup += 1;
    if (!input.drawnGroups.has(sourceGroupId) || !input.drawnGroups.has(targetGroupId)) {
      continue;
    }
    tally.drawnHops += 1;
    const edge = input.hopEdges.get(hopKey(source, target));
    addToBucket(
      buckets,
      {
        sourceGroupId,
        targetGroupId,
        // No resolvable graph edge means the hop's provenance is not knowable from this artifact;
        // `unknown` says so instead of assuming the traversal walked a deterministic edge (§43.6).
        knowledgeCategory: edge === undefined ? 'unknown' : categoryOf(edge.provenance),
        status: 'current',
      },
      edge?.type ?? 'dependency hop',
    );
  }
};

const collectProposed = (input: ImpactEdgeInput, buckets: Map<string, Bucket>): number => {
  let drawn = 0;
  for (const relationship of input.proposed?.relationships ?? []) {
    const sourceGroupId =
      relationship.sourceKind === 'proposed'
        ? input.proposedGroupLabel
        : input.groupFor(relationship.sourceId);
    const targetGroupId =
      relationship.targetKind === 'proposed'
        ? input.proposedGroupLabel
        : input.groupFor(relationship.targetId);
    if (
      sourceGroupId === targetGroupId ||
      !input.drawnGroups.has(sourceGroupId) ||
      !input.drawnGroups.has(targetGroupId)
    ) {
      continue;
    }
    drawn += 1;
    addToBucket(
      buckets,
      {
        sourceGroupId,
        targetGroupId,
        knowledgeCategory: categoryOf(relationship.provenance),
        status: 'proposed',
      },
      relationship.type,
    );
  }
  return drawn;
};

const finish = (buckets: Map<string, Bucket>): GraphViewEdge[] =>
  [...buckets.values()]
    .map((bucket) => ({
      sourceGroupId: bucket.sourceGroupId,
      targetGroupId: bucket.targetGroupId,
      knowledgeCategory: bucket.knowledgeCategory,
      status: bucket.status,
      count: bucket.count,
      kinds: [...bucket.kinds.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    }))
    .sort(
      (a, b) =>
        // Current before proposed, so the existing architecture reads first.
        a.status.localeCompare(b.status) ||
        b.count - a.count ||
        a.sourceGroupId.localeCompare(b.sourceGroupId) ||
        a.targetGroupId.localeCompare(b.targetGroupId) ||
        a.knowledgeCategory.localeCompare(b.knowledgeCategory),
    );

export const impactEdges = (input: ImpactEdgeInput): ImpactEdgeResult => {
  const buckets = new Map<string, Bucket>();
  const tally: HopTally = { intraGroup: 0, interGroup: 0, drawnHops: 0 };
  collectHops(input, buckets, tally);
  const proposedDrawn = collectProposed(input, buckets);
  return {
    aggregated: finish(buckets),
    hopPairs: distinctHops(input.impacts).length,
    intraGroup: tally.intraGroup,
    interGroup: tally.interGroup,
    drawnHops: tally.drawnHops,
    proposedTotal: input.proposed?.relationships.length ?? 0,
    proposedDrawn,
  };
};
