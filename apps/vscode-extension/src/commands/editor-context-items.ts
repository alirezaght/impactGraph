import type { RequirementImpact } from '@impactgraph/domain';
import type { ComponentHit, NodeExplanation, StackDetection } from '@impactgraph/workspace-engine';

// Story 7.5 / §19 editor context commands — pure projections from engine query results to
// quick-pick data. No vscode types, no computation beyond filtering/formatting: the engine
// decided what the graph and the analysis contain; this file only shapes it for display.

/** §10.1 step 6 — one-line detection-review summary shown after initialization. */
export const stackSummaryMessage = (detection: StackDetection): string => {
  const part = (name: string, values: readonly string[]): string =>
    `${name}: ${values.length > 0 ? values.join(', ') : 'none detected'}`;
  return [
    part('languages', detection.languages),
    part('frameworks', detection.frameworks),
    part('signals', detection.signals),
  ].join(' · ');
};

/** The graph node standing for a file: exact path match, file-typed nodes preferred. */
export const bestFileHit = (
  hits: readonly ComponentHit[],
  relPath: string,
): ComponentHit | undefined => {
  const matching = hits.filter((hit) => hit.path === relPath);
  return matching.find((hit) => hit.type === 'file') ?? matching[0];
};

/** Node ids of every graph node located in the given file (file node + its symbols). */
export const nodeIdsForFile = (
  hits: readonly ComponentHit[],
  relPath: string,
): ReadonlySet<string> =>
  new Set(hits.filter((hit) => hit.path === relPath).map((hit) => hit.nodeId));

export interface DependencyPickItem {
  readonly label: string;
  readonly description: string;
  readonly nodeId: string;
}

/** Outgoing then incoming edges, direction and edge type as text (§37 — never color). */
export const dependencyPickItems = (explanation: NodeExplanation): DependencyPickItem[] => [
  ...explanation.outgoingEdges.map((edge) => ({
    label: `→ ${edge.toName}`,
    description: `${edge.type} (outgoing)`,
    nodeId: edge.to,
  })),
  ...explanation.incomingEdges.map((edge) => ({
    label: `← ${edge.fromName}`,
    description: `${edge.type} (incoming)`,
    nodeId: edge.from,
  })),
];

/** Impacts whose target node or dependency path touches any of the file's nodes. */
export const impactsTouching = (
  impacts: readonly RequirementImpact[],
  fileNodeIds: ReadonlySet<string>,
): RequirementImpact[] =>
  impacts.filter(
    (impact) =>
      fileNodeIds.has(impact.nodeId) || impact.dependencyPath.some((id) => fileNodeIds.has(id)),
  );

export interface ImpactPickItem {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
}

/** Likelihood, type, confidence, and provenance stay text on every item (§37, §3). */
export const impactPickItems = (impacts: readonly RequirementImpact[]): ImpactPickItem[] =>
  impacts.map((impact) => ({
    label: `${impact.likelihood} · ${impact.nodeId}`,
    description: `${impact.impactType} · ${impact.confidence.toFixed(2)} · ${impact.provenance} · ${impact.requirementId}`,
    detail: impact.explanation,
  }));

/** Specification name recorded for an editor-selection analysis (1-based lines). */
export const selectionSpecName = (relPath: string, startLine: number, endLine: number): string =>
  `selection ${relPath}:${String(startLine)}-${String(endLine)}`;
