import { classifyDrift } from '@impactgraph/application';

import { withConfiguredContexts } from '../overlay-context-graph.js';
import { attributionPrefixes, owningRepository } from '../repository-attribution.js';

import type { DriftClassification } from '@impactgraph/application';
import type { ArchitectureConfigDto, CliReviewDrift } from '@impactgraph/contracts';
import type { ImpactAnalysis, ImplementationReview, KnowledgeGraph } from '@impactgraph/domain';

/**
 * Item 7 (PRD §C15.3): the review's `edgeChanges` ids, classified into the drift block of the
 * review document. This builder wires the deterministic classifier to the workspace's two
 * boundary sources — configured bounded contexts (read-time overlay, `withConfiguredContexts`)
 * and the registered-repository roster (`owningRepository`) — and produces the contract DTO.
 *
 * Where neither boundary exists the classifier simply never produces the boundary categories;
 * nothing is inferred from directory names. Non-goal: edge-direction reversals are detected
 * only for the cheap exact case (removed A→B plus added B→A of the same type within this
 * review's edge changes); reversals composed across edge types, and drift entries persisted as
 * impact-shaped provenance records, remain future work.
 */

export interface ReviewDriftInputs {
  readonly review: ImplementationReview;
  readonly analysis: ImpactAnalysis;
  readonly approvedGraph: KnowledgeGraph;
  readonly currentGraph: KnowledgeGraph;
  /** Configured architecture — absent (or context-free) disables `cross-context`. */
  readonly architecture?: ArchitectureConfigDto | undefined;
  /** Roster members (`name` + workspace-relative `path`) — one prefix disables nothing,
   *  an empty list disables `cross-repository`. */
  readonly rosterRepositories?: readonly {
    readonly name: string;
    readonly path?: string | undefined;
  }[];
}

const withContexts = (
  graph: KnowledgeGraph,
  inputs: ReviewDriftInputs,
  snapshotId: string,
): KnowledgeGraph =>
  inputs.architecture === undefined
    ? graph
    : withConfiguredContexts(graph, inputs.architecture, {
        snapshotId,
        createdAt: inputs.review.createdAt,
      });

const toDto = (classification: DriftClassification): CliReviewDrift => ({
  entries: classification.entries.map((entry) => ({
    edgeId: entry.edgeId,
    edgeType: entry.edgeType,
    direction: entry.direction,
    category: entry.category,
    from: { ...entry.from },
    to: { ...entry.to },
  })),
  omitted: classification.omitted.map((entry) => ({ ...entry })),
  ...(classification.unmappedContexts === undefined
    ? {}
    : {
        unmappedContexts: {
          contexts: [...classification.unmappedContexts.contexts],
          ...(classification.unmappedContexts.omitted === undefined
            ? {}
            : { omitted: classification.unmappedContexts.omitted }),
        },
      }),
});

export const buildReviewDrift = (inputs: ReviewDriftInputs): CliReviewDrift => {
  const prefixes = attributionPrefixes(inputs.rosterRepositories ?? []);
  return toDto(
    classifyDrift({
      analysis: inputs.analysis,
      approvedGraph: withContexts(
        inputs.approvedGraph,
        inputs,
        inputs.analysis.repositorySnapshotId,
      ),
      currentGraph: withContexts(inputs.currentGraph, inputs, inputs.review.reviewSnapshotId),
      edgeChanges: inputs.review.edgeChanges,
      changedFiles: inputs.review.changedFiles,
      ...(prefixes.length === 0
        ? {}
        : { owningRepositoryOf: (path: string | undefined) => owningRepository(prefixes, path) }),
    }),
  );
};

/** Total entries every drift list dropped — feeds the measured scope limitations. */
export const driftOmittedTotal = (drift: CliReviewDrift): number =>
  drift.omitted.reduce((sum, entry) => sum + entry.count, 0) +
  (drift.unmappedContexts?.omitted ?? 0);
