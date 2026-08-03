import type { CategoryCounts, RenderCategory } from './graph-render-category.js';
import type { ImpactDirectness, ImpactLikelihood } from '@impactgraph/domain';

// The IMPACT half of the export read model (PRD §18.4/§18.5) — a specification's blast radius,
// projected for the same renderer that draws the architecture view.
//
// What it deliberately carries: likelihood, impact type, directness, hop counts, confidence with
// its §14 contributing signals, provenance, requirement attribution, engine explanations, and the
// proposed structure kept strictly beside the current structure.
//
// What it deliberately does NOT carry: source text, evidence excerpts, evidence line ranges and
// absolute paths — the same privacy line the architecture view holds, because this file is meant
// to be attachable to a ticket.

/** Group bucket for proposed components: they group with each other, never into a real context. */
export const PROPOSED_GROUP_LABEL = 'Proposed structure (not in the repository)';

/**
 * Absent-reads-as-absent labels (§Z5). A component the overlay resolves no group for is LABELLED
 * as unassigned; it is never silently blank and never guessed from its path.
 */
export const UNASSIGNED_GROUP_LABELS = {
  context: '(no context assigned)',
  application: '(no application assigned)',
  package: '(no package assigned)',
} as const;

/** One contributing signal behind a confidence score (§14) — a bare number is never enough. */
export interface ImpactSignalFact {
  readonly type: string;
  readonly contribution: number;
  readonly description?: string | undefined;
}

/**
 * The impact facts drawn on one component cell. A component can be impacted by several
 * requirements, so these are the AGGREGATE over that component's impacts: the strongest claim
 * leads, and the per-impact detail lives in the impacts table.
 */
export interface ImpactNodeFacts {
  /** Strongest likelihood among this component's impacts — the primary signal a reader acts on. */
  readonly likelihood: ImpactLikelihood;
  /** Highest confidence among them, 0..1. Rendered to two decimals as text. */
  readonly confidence: number;
  /** Distinct impact types affecting this component, strongest impact first. */
  readonly impactTypes: readonly string[];
  /** `mixed` when the component is reached both directly and indirectly. */
  readonly directness: ImpactDirectness | 'mixed';
  /** Hops along the dependency path. 0 = a direct concept match, not a traversal. */
  readonly minHops: number;
  readonly maxHops: number;
  readonly requirementIds: readonly string[];
  readonly impactCount: number;
  /**
   * True when the analysis cites a node id that the resolved graph does not contain — rendered as
   * "not in snapshot" rather than dropped, so a stale analysis is visible instead of quietly thin.
   */
  readonly missingFromSnapshot: boolean;
}

export interface ImpactRequirementRow {
  readonly id: string;
  /** Requirement text as extracted. Specification prose, never repository source. */
  readonly statement: string;
  readonly priority?: string | undefined;
  readonly type?: string | undefined;
  readonly impactCount: number;
  readonly componentCount: number;
  readonly strongestLikelihood?: ImpactLikelihood | undefined;
  readonly maxConfidence?: number | undefined;
  /** Warning codes the analysis raised against this requirement (`unmatched-requirement`, …). */
  readonly warningCodes: readonly string[];
}

/** One (requirement × component) impact, in full — the §18.5 evidence panel as a table row. */
export interface ImpactRow {
  readonly requirementId: string;
  readonly nodeId: string;
  readonly componentName: string;
  readonly groupId: string;
  readonly likelihood: ImpactLikelihood;
  readonly impactType: string;
  readonly directness: ImpactDirectness;
  readonly confidence: number;
  readonly hops: number;
  /** Node ids along the dependency path, source first. Names only — no line ranges. */
  readonly dependencyPath: readonly string[];
  readonly provenance: string;
  readonly knowledgeCategory: RenderCategory;
  readonly explanation: string;
  readonly expectedChanges: readonly string[];
  readonly signals: readonly ImpactSignalFact[];
  /** Count only: evidence ids embed line ranges, which this export does not publish. */
  readonly evidenceCount: number;
  /** A recorded human decision on this impact (§40.3), when one exists. */
  readonly decision?: string | undefined;
  readonly decisionReason?: string | undefined;
  readonly drawn: boolean;
}

export interface ImpactWarningRow {
  readonly code: string;
  readonly message: string;
  readonly requirementId?: string | undefined;
}

export interface ImpactProposedNodeRow {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly originOptionId: string;
  readonly rationale: string;
  readonly provenance: string;
  readonly knowledgeCategory: RenderCategory;
  readonly confidence: number;
}

export interface ImpactProposedEdgeRow {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  /** `existing` endpoints are graph nodes; `proposed` ones do not exist in the repository. */
  readonly sourceKind: string;
  readonly targetKind: string;
  readonly type: string;
  readonly originOptionId: string;
  readonly rationale: string;
  readonly provenance: string;
  readonly knowledgeCategory: RenderCategory;
  readonly confidence: number;
}

export interface ImpactProposedFacts {
  readonly nodes: readonly ImpactProposedNodeRow[];
  readonly relationships: readonly ImpactProposedEdgeRow[];
}

export interface ImpactHopBucket {
  readonly hops: number;
  readonly impactCount: number;
}

export interface ImpactTotals {
  readonly impactCount: number;
  readonly componentCount: number;
  readonly componentsShown: number;
  readonly componentsHidden: number;
  readonly requirementCount: number;
  readonly requirementsWithImpacts: number;
  readonly requirementsWithoutImpacts: number;
  readonly byLikelihood: Readonly<Record<ImpactLikelihood, number>>;
  readonly byImpactType: readonly { readonly type: string; readonly count: number }[];
  readonly byKnowledgeCategory: CategoryCounts;
  readonly directCount: number;
  readonly indirectCount: number;
  readonly hopBuckets: readonly ImpactHopBucket[];
  readonly maxHops: number;
  /** Dependency hops crossing a group boundary, and how many were drawn as arrows. */
  readonly crossGroupHops: number;
  readonly crossGroupHopsDrawn: number;
}

/** Everything the impact view adds to the shared `GraphView`. */
export interface ImpactViewFacts {
  readonly analysisId: string;
  readonly analysisStatus: string;
  readonly createdAt: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  readonly specificationTitle: string;
  /** Repository-relative source of the spec, when the specification records one. */
  readonly specificationSource?: string | undefined;
  /** Snapshot the analysis was computed against — the world it describes. */
  readonly boundSnapshotId: string;
  /** Snapshot whose graph supplied component names, types and paths. */
  readonly resolvedSnapshotId: string;
  /** False when the two differ; the file says so rather than implying the analysis is current. */
  readonly snapshotMatches: boolean;
  /** True when the specification has moved past the version this analysis saw (§40.2). */
  readonly specificationStale: boolean;
  readonly currentSpecificationVersion: number;
  readonly totals: ImpactTotals;
  readonly requirements: readonly ImpactRequirementRow[];
  readonly impacts: readonly ImpactRow[];
  readonly warnings: readonly ImpactWarningRow[];
  readonly proposed?: ImpactProposedFacts | undefined;
}
