import { createActualImpact, measureAnalysis } from '@impactgraph/domain';
import { artifactsPath, createActualImpactStore } from '@impactgraph/persistence';

import { loadAnalysis } from './analyses.js';
import { failWith } from './failure.js';
import { loadGraphForSnapshot } from './graphs.js';
import { predictArtifacts } from './reports/predicted-artifacts.js';
import { loadSpecification } from './specifications.js';

import type { Failable } from './failure.js';
import type {
  ActualImpact,
  ArtifactCategory,
  EvaluationMetrics,
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
  Specification,
} from '@impactgraph/domain';
import type { ActualImpactRecord } from '@impactgraph/persistence';

/**
 * Record what an implementation actually touched, and measure the prediction against it (item 12).
 *
 * The measurement happens at record time and is stored WITH the outcome, rather than recomputed on
 * read. Two reasons. The graph moves, so a later recomputation would measure the prediction against a
 * repository it never saw. And the number is evidence: a stored figure can be cited in a review and
 * checked later, while a derived one changes under the reader.
 *
 * Nothing here modifies the analysis, the specification, or committed repository knowledge. A single
 * measured outcome informs a human decision about ranking; it never becomes one.
 */

export interface RecordActualImpactRequest {
  readonly rootDir: string;
  readonly analysisId: string;
  readonly outcomeId?: string | undefined;
  readonly changedFiles?: readonly string[] | undefined;
  readonly addedFiles?: readonly string[] | undefined;
  readonly removedFiles?: readonly string[] | undefined;
  readonly changedSymbols?: ActualImpact['changedSymbols'] | undefined;
  readonly relationshipChanges?: ActualImpact['relationshipChanges'] | undefined;
  readonly contractsChanged?: readonly string[] | undefined;
  readonly migrationsChanged?: readonly string[] | undefined;
  readonly manualFindings?: ActualImpact['manualFindings'] | undefined;
  readonly note?: string | undefined;
  readonly recordedAt?: string | undefined;
}

const pathsOf = (analysis: ImpactAnalysis, graph: KnowledgeGraph): ReadonlyMap<string, string> => {
  const paths = new Map<string, string>();
  for (const impact of analysis.requirementImpacts) {
    const path = graph.nodes.get(impact.nodeId as NodeId)?.path;
    if (path !== undefined) {
      paths.set(impact.nodeId, path);
    }
  }
  return paths;
};

/**
 * Relationship types the predicted routes crossed — the denominator for "types we did not see".
 *
 * Built from an adjacency index rather than by rescanning every edge per hop: a real analysis has
 * hundreds of impacts and a real graph has tens of thousands of edges.
 */
const routeTypesOf = (analysis: ImpactAnalysis, graph: KnowledgeGraph): ReadonlySet<string> => {
  const byPair = new Map<string, string[]>();
  for (const edge of graph.edges.values()) {
    for (const key of [`${edge.sourceId}|${edge.targetId}`, `${edge.targetId}|${edge.sourceId}`]) {
      byPair.set(key, [...(byPair.get(key) ?? []), edge.type]);
    }
  }
  const types = new Set<string>();
  for (const impact of analysis.requirementImpacts) {
    for (let index = 0; index + 1 < impact.dependencyPath.length; index += 1) {
      const key = `${String(impact.dependencyPath[index])}|${String(impact.dependencyPath[index + 1])}`;
      for (const type of byPair.get(key) ?? []) {
        types.add(type);
      }
    }
  }
  return types;
};

export interface RecordActualImpactOutcome extends ActualImpactRecord {
  /** Every outcome recorded against this analysis so far, this one included. */
  readonly historyCount: number;
}

/** The outcome record itself, built from the request and the analysis it measures. */
/**
 * Absent lists become empty ones HERE and nowhere else. A caller that knows only the changed files
 * should not have to state that it knows nothing about symbols — but the record must still say
 * "none recorded" rather than leaving the field undefined, or every aggregate over outcomes has to
 * re-decide what absence meant.
 */
const buildActual = (
  request: RecordActualImpactRequest,
  analysis: ImpactAnalysis,
): ReturnType<typeof createActualImpact> =>
  createActualImpact({
    id: request.outcomeId ?? `outcome-${request.analysisId}-${Date.now().toString(36)}`,
    analysisId: request.analysisId,
    specificationId: analysis.specificationId,
    specificationVersion: analysis.specificationVersion,
    recordedAt: request.recordedAt ?? new Date().toISOString(),
    ...emptyDefaults(request),
    ...(request.note === undefined ? {} : { note: request.note }),
  });

type ListFields = Pick<
  ActualImpact,
  | 'changedFiles'
  | 'addedFiles'
  | 'removedFiles'
  | 'changedSymbols'
  | 'relationshipChanges'
  | 'contractsChanged'
  | 'migrationsChanged'
  | 'manualFindings'
>;

const emptyDefaults = (request: RecordActualImpactRequest): ListFields => ({
  changedFiles: request.changedFiles ?? [],
  addedFiles: request.addedFiles ?? [],
  removedFiles: request.removedFiles ?? [],
  changedSymbols: request.changedSymbols ?? [],
  relationshipChanges: request.relationshipChanges ?? [],
  contractsChanged: request.contractsChanged ?? [],
  migrationsChanged: request.migrationsChanged ?? [],
  manualFindings: request.manualFindings ?? [],
});

export const recordActualImpact = async (
  request: RecordActualImpactRequest,
): Promise<Failable<RecordActualImpactOutcome>> => {
  const analysis = await loadAnalysis(request.rootDir, request.analysisId);
  if (!analysis.ok) {
    return analysis;
  }
  const graph = await loadGraphForSnapshot(request.rootDir, analysis.value.repositorySnapshotId);
  if (!graph.ok) {
    return graph;
  }
  const specification = await loadSpecification(
    request.rootDir,
    analysis.value.specificationId,
    analysis.value.specificationVersion,
  );
  if (!specification.ok) {
    return specification;
  }
  const actual = buildActual(request, analysis.value);
  if (!actual.ok) {
    return failWith(
      'configurationError',
      actual.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  const store = createActualImpactStore(artifactsPath(request.rootDir));
  const saved = store.save({
    actual: actual.value,
    metrics: measure({
      specification: specification.value,
      analysis: analysis.value,
      graph: graph.value,
      actual: actual.value,
    }),
  });
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  const history = store.listForAnalysis(request.analysisId);
  return {
    ok: true,
    value: { ...saved.value, historyCount: history.ok ? history.value.length : 1 },
  };
};

interface MeasureContext {
  readonly specification: Specification;
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly actual: ActualImpact;
}

const measure = ({ specification, analysis, graph, actual }: MeasureContext): EvaluationMetrics =>
  measureAnalysis({
    analysis,
    actual,
    pathByNodeId: pathsOf(analysis, graph),
    predictedRelationshipTypes: routeTypesOf(analysis, graph),
    predictedArtifactCategories: predictedCategories(specification, analysis, graph),
  });

/**
 * The artifact categories the analysis predicted. Recomputed from the same rules the summary uses, so
 * "the analysis predicted a locale entry" means the same thing in the measurement as in the report —
 * against the specification VERSION the analysis was built from, not against whatever it says now.
 */
const predictedCategories = (
  specification: Specification,
  analysis: ImpactAnalysis,
  graph: KnowledgeGraph,
): readonly ArtifactCategory[] =>
  predictArtifacts(specification, analysis, graph, new Set()).map(
    (prediction) => prediction.category,
  );

/** Every recorded outcome, newest first — the material for reviewing measured accuracy over time. */
export const listActualImpacts = (rootDir: string): Failable<readonly ActualImpactRecord[]> => {
  const store = createActualImpactStore(artifactsPath(rootDir));
  const all = store.listAll();
  if (!all.ok) {
    return failWith('configurationError', all.error.message);
  }
  return {
    ok: true,
    value: [...all.value].sort((a, b) => b.actual.recordedAt.localeCompare(a.actual.recordedAt)),
  };
};
