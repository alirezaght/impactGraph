import { assignmentFor, buildImplementationContext } from '@impactgraph/application';

import { loadApprovedAnalysis } from './analyses.js';
import { failWith } from './failure.js';
import { loadGraphAt, withIndexStore } from './graphs.js';
import { loadProjectKnowledge } from './rules.js';
import { snapshotSummary } from './snapshot.js';
import { evidenceFilesFor, loadSpecification } from './specifications.js';

import type { Failable } from './failure.js';
import type {
  ArchitectureModel,
  ArchitectureRule,
  ImpactSummaryExport,
  ImplementationContext,
} from '@impactgraph/application';
import type {
  ImpactAnalysis,
  KnowledgeGraph,
  NodeId,
  RepositorySnapshotId,
  Specification,
} from '@impactgraph/domain';

interface ProjectKnowledge {
  readonly rules: readonly ArchitectureRule[];
  readonly architecture: ArchitectureModel;
}

// The §22 export workflow, shared by `impactgraph export` and the MCP
// export_implementation_context tool. Approved analyses only (§40.3).

export interface ExportBundle {
  readonly context: ImplementationContext;
  readonly possibleImpacts: readonly ImpactSummaryExport[];
  readonly affectedContexts: readonly string[];
  readonly evidenceFileById: ReadonlyMap<string, string>;
}

const summarizePossible = (
  context: ImplementationContext,
  graph: KnowledgeGraph,
): ImpactSummaryExport[] =>
  context.approvedAnalysis.requirementImpacts
    .filter((impact) => impact.likelihood === 'possible')
    .map((impact) => {
      const node = graph.nodes.get(impact.nodeId as NodeId);
      return {
        requirementId: impact.requirementId,
        nodeId: impact.nodeId,
        name: node?.name ?? impact.nodeId,
        path: node?.path,
        likelihood: impact.likelihood,
        impactType: impact.impactType,
        directness: impact.directness,
        confidence: impact.confidence,
        explanation: impact.explanation,
        expectedChanges: impact.expectedChanges,
        dependencyPath: impact.dependencyPath,
        evidenceIds: impact.evidenceIds,
      };
    });

export const buildExportBundle = async (
  rootDir: string,
  analysisId?: string,
): Promise<Failable<ExportBundle>> => {
  const analysis = await loadApprovedAnalysis(rootDir, analysisId);
  if (!analysis.ok) {
    return analysis;
  }
  const specification = await loadSpecification(
    rootDir,
    analysis.value.specificationId,
    analysis.value.specificationVersion,
  );
  if (!specification.ok) {
    return specification;
  }
  const knowledge = loadProjectKnowledge(rootDir);
  if (!knowledge.ok) {
    return knowledge;
  }
  return assembleBundle(rootDir, analysis.value, specification.value, knowledge.value);
};

const assembleBundle = async (
  rootDir: string,
  analysis: ImpactAnalysis,
  specification: Specification,
  knowledge: ProjectKnowledge,
): Promise<Failable<ExportBundle>> => {
  return withIndexStore(rootDir, async (store) => {
    const snapshotId = analysis.repositorySnapshotId as RepositorySnapshotId;
    const snapshot = await store.getSnapshot(snapshotId);
    if (!snapshot.ok || snapshot.value === undefined) {
      return failWith(
        'indexingFailure',
        `approved snapshot ${analysis.repositorySnapshotId} is no longer in the local index — the cache was rebuilt since approval`,
      );
    }
    const graph = await loadGraphAt(store, snapshotId, 'approved');
    if (!graph.ok) {
      return graph;
    }
    const built = buildImplementationContext({
      specification,
      analysis,
      graph: graph.value,
      snapshot: snapshotSummary(snapshot.value),
      constraints: knowledge.rules,
    });
    if (!built.ok) {
      return failWith('configurationError', built.error.issues[0]?.message ?? 'export rejected');
    }
    const impacts = [...built.value.requiredImpacts, ...built.value.likelyImpacts];
    const affected = new Set<string>();
    for (const impact of impacts) {
      if (impact.path !== undefined) {
        affected.add(assignmentFor(impact.path, knowledge.architecture).context ?? 'unassigned');
      }
    }
    return {
      ok: true,
      value: {
        context: built.value,
        possibleImpacts: summarizePossible(built.value, graph.value),
        affectedContexts: [...affected].sort(),
        evidenceFileById: await evidenceFilesFor(
          store,
          impacts.flatMap((impact) => impact.evidenceIds),
        ),
      },
    };
  });
};
