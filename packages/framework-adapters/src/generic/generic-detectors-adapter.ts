import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import type {
  CodeGraph,
  FrameworkAdapter,
  FrameworkContext,
  FrameworkDetection,
} from '../types.js';
import type { GraphNode } from '@impactgraph/domain';
import type { GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Story 3.4 — coarse convention detectors (PRD §6.2, §15.1): migrations, Dockerfiles, CI
// pipelines. Path-convention facts with `framework-convention` provenance; MIGRATES edges are
// emitted only where derivable (same Prisma directory), never guessed.

const MIGRATION_PATTERN = /(^|\/)migrations\/.*\.(sql|ts|js)$/;
const CI_PATTERN = /((^|\/)\.github\/workflows\/.*\.ya?ml|(^|\/)\.gitlab-ci\.ya?ml)$/;

const isDockerfile = (path: string): boolean =>
  path === 'Dockerfile' || path.endsWith('/Dockerfile') || path.endsWith('.dockerfile');

type DetectorKind = 'migration' | 'docker' | 'ci';

const classify = (path: string): DetectorKind | undefined => {
  if (MIGRATION_PATTERN.test(path)) {
    return 'migration';
  }
  if (isDockerfile(path)) {
    return 'docker';
  }
  if (CI_PATTERN.test(path)) {
    return 'ci';
  }
  return undefined;
};

const NODE_SHAPE: Readonly<
  Record<DetectorKind, { prefix: string; category: string; type: string }>
> = {
  migration: { prefix: 'migration', category: 'data', type: 'migration' },
  docker: { prefix: 'docker', category: 'infrastructure', type: 'docker-image' },
  ci: { prefix: 'pipeline', category: 'infrastructure', type: 'deployment-pipeline' },
};

const detectorEvidence = (
  builder: FragmentBuilder,
  path: string,
  context: IndexingContext,
): string | undefined =>
  builder.addEvidence(
    {
      id: `ev:file-presence:${path}:detector`,
      kind: 'file-presence',
      source: { kind: 'file', filePath: path },
      repositorySnapshotId: context.repositorySnapshotId,
      createdAt: context.createdAt,
    },
    path,
  );

const addDetectedNode = (
  builder: FragmentBuilder,
  file: GraphNode,
  kind: DetectorKind,
  context: IndexingContext,
): string | undefined => {
  const path = file.path ?? file.id;
  const evidenceId = detectorEvidence(builder, path, context);
  if (evidenceId === undefined) {
    return undefined;
  }
  const shape = NODE_SHAPE[kind];
  const nodeId = `${shape.prefix}:${path}`;
  builder.addNode(
    {
      id: nodeId,
      category: shape.category,
      type: shape.type,
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      knowledge: deterministicEnvelope(context, [evidenceId], 'framework-convention'),
    },
    path,
  );
  builder.addEdge(
    {
      id: `generic:contains:${nodeId}`,
      type: 'CONTAINS',
      sourceId: file.id,
      targetId: nodeId,
      knowledge: deterministicEnvelope(context, [evidenceId], 'framework-convention'),
    },
    path,
  );
  return evidenceId;
};

/** Prisma migrations migrate the tables declared in the same prisma/ tree — derivable. */
const addMigratesEdges = (
  builder: FragmentBuilder,
  graph: CodeGraph,
  migration: { nodeId: string; path: string; evidenceId: string },
  context: IndexingContext,
): void => {
  const root = migration.path.split('/')[0];
  if (root === undefined) {
    return;
  }
  for (const node of graph.nodes) {
    if (node.type === 'table' && node.path?.startsWith(`${root}/`) === true) {
      builder.addEdge(
        {
          id: `generic:migrates:${migration.nodeId}->${node.id}`,
          type: 'MIGRATES',
          sourceId: migration.nodeId,
          targetId: node.id,
          knowledge: deterministicEnvelope(context, [migration.evidenceId], 'framework-convention'),
        },
        migration.path,
      );
    }
  }
};

class GenericDetectorsAdapter implements FrameworkAdapter {
  public readonly id = 'generic-detectors';
  public readonly languageIds: readonly string[] = ['typescript'];

  public detect(graph: CodeGraph): Promise<FrameworkDetection> {
    const hits = graph.nodes.filter(
      (node) => node.path !== undefined && classify(node.path) !== undefined,
    );
    return Promise.resolve({
      detected: hits.length > 0,
      evidenceIds: hits.flatMap((node) => node.knowledge.evidenceIds),
      reason:
        hits.length > 0
          ? `migration/Docker/CI conventions present (${String(hits.length)} files)`
          : 'no generic conventions found',
    });
  }

  public enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const node of graph.nodes) {
      if (node.path === undefined || !node.id.startsWith('file:')) {
        continue;
      }
      const kind = classify(node.path);
      if (kind === undefined) {
        continue;
      }
      const evidenceId = addDetectedNode(builder, node, kind, context.indexing);
      if (kind === 'migration' && evidenceId !== undefined) {
        addMigratesEdges(
          builder,
          graph,
          { nodeId: `migration:${node.path}`, path: node.path, evidenceId },
          context.indexing,
        );
      }
    }
    return Promise.resolve(builder.build());
  }
}

export const createGenericDetectorsAdapter = (): FrameworkAdapter => new GenericDetectorsAdapter();
