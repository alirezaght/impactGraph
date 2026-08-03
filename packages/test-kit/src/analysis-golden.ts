import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KnowledgeGraph } from '@impactgraph/domain';

// Golden-file serialization for impact analyses and review reports (PRD §42.3, Story 17.3),
// completing the graph serializer in graph-golden.ts. Same discipline: volatile fields
// (analysis/run/snapshot IDs, timestamps, evidence IDs) are excluded, and impacts are keyed by
// component NAME rather than node id so a graph-id refactor does not churn every golden.

/** The impact fields an analysis golden pins. `RequirementImpact` satisfies this via a lookup. */
export interface GoldenImpact {
  readonly requirementId: string;
  readonly nodeName: string;
  readonly likelihood: string;
  readonly impactType: string;
  readonly directness: string;
  readonly confidence: number;
  /**
   * The relationship the walk crossed FIRST, derived from the dependency path rather than stored on
   * the impact. Pinned because propagation now depends on which relationship reached a candidate: a
   * DI injection and a template call currently share the name `USES`, so splitting that vocabulary
   * would otherwise look like no change at all while materially altering future propagation.
   */
  readonly relationship: string;
  readonly signalTypes: readonly string[];
}

export interface GoldenAnalysisInput {
  readonly impacts: readonly GoldenImpact[];
  readonly warningCodes: readonly string[];
}

/** The finding fields a review golden pins. */
export interface GoldenFinding {
  readonly category: string;
  readonly nodeName: string;
  /**
   * Distinguishes two findings that share a display name. Names are NOT unique — `deals-web` is
   * both an npm package and a Cloud Run service — so keying a golden by name alone silently
   * collapses distinct findings into identical lines and hides one of them.
   */
  readonly nodeId?: string | undefined;
  readonly requirementId?: string | undefined;
}

export interface GoldenReviewInput {
  readonly findings: readonly GoldenFinding[];
  readonly coverage: readonly { requirementId: string; status: string }[];
}

const lexicographic = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

const impactLine = (impact: GoldenImpact): string =>
  [
    impact.requirementId,
    impact.nodeName,
    impact.likelihood,
    impact.impactType,
    impact.directness,
    impact.confidence.toFixed(2),
    impact.relationship,
    [...impact.signalTypes].sort(lexicographic).join('+'),
  ].join('|');

/**
 * Stable text form of an impact analysis: sorted impact lines
 * (`requirementId|name|likelihood|type|directness|confidence|relationship|signals`) then sorted warning
 * codes. Confidence is pinned to two decimals — a weighting change must be a reviewed diff.
 */
export const serializeAnalysisGolden = (analysis: GoldenAnalysisInput): string => {
  const impacts = analysis.impacts.map(impactLine).sort(lexicographic);
  const warnings = [...analysis.warningCodes].sort(lexicographic);
  return ['impacts:', ...impacts, '', 'warnings:', ...warnings, ''].join('\n');
};

/**
 * Stable text form of a review report: sorted finding lines (`category|name|nodeId|requirementId`)
 * then sorted coverage lines. Categories are the closed §24.1 set, so a miscategorized
 * finding shows up as a one-line diff.
 */
export const serializeReviewGolden = (review: GoldenReviewInput): string => {
  const findings = review.findings
    .map(
      (finding) =>
        `${finding.category}|${finding.nodeName}|${finding.nodeId ?? '-'}|${finding.requirementId ?? '-'}`,
    )
    .sort(lexicographic);
  const coverage = review.coverage
    .map((item) => `${item.requirementId}|${item.status}`)
    .sort(lexicographic);
  return ['findings:', ...findings, '', 'coverage:', ...coverage, ''].join('\n');
};

const goldenDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', 'goldens');

/** Absolute path to a committed analysis golden, e.g. analysisGoldenPath('ts-basic', 'deal'). */
export const analysisGoldenPath = (fixtureName: string, sampleName: string): string =>
  join(goldenDir(), `${fixtureName}.${sampleName}.analysis.txt`);

/** Absolute path to a committed review golden. */
export const reviewGoldenPath = (fixtureName: string, sampleName: string): string =>
  join(goldenDir(), `${fixtureName}.${sampleName}.review.txt`);

/**
 * Golden regeneration is opt-in and SCOPED: `UPDATE_GOLDENS=<name>` (comma-separated for
 * several) rewrites only those fixtures. `1`/`all` still rewrites everything, but a blanket
 * regeneration silently adopts whatever unrelated in-flight work is on disk — which is how a
 * golden ends up "reviewed into existence" by nobody. Prefer the scoped form.
 */
export const shouldUpdateGolden = (name: string): boolean => {
  const flag = process.env['UPDATE_GOLDENS'];
  if (flag === undefined || flag.length === 0) {
    return false;
  }
  if (flag === '1' || flag === 'all') {
    return true;
  }
  return flag.split(',').some((entry) => entry.trim() === name);
};

/**
 * The relationship type of a candidate's first hop, read back off its dependency path.
 *
 * Derived rather than stored: `RequirementImpact` carries the path but not the edge types, and
 * adding them would be a persisted-schema change. Shared by the golden serializers and the
 * evaluation harness so all three describe relationship provenance the same way.
 */
export const firstRelationship = (
  graph: Pick<KnowledgeGraph, 'edges' | 'outgoing' | 'incoming'>,
  dependencyPath: readonly string[],
): string => {
  const [from, to] = dependencyPath;
  if (from === undefined || to === undefined) {
    return 'anchor';
  }
  for (const edgeId of [
    ...(graph.outgoing.get(from as never) ?? []),
    ...(graph.incoming.get(from as never) ?? []),
  ]) {
    const edge = graph.edges.get(edgeId);
    if (edge !== undefined && (edge.sourceId === to || edge.targetId === to)) {
      return edge.type;
    }
  }
  return 'unresolved';
};
