import { analyzeDiffWithIndexer } from '../diff/analyze-diff.js';
import { addFileFact, fileNodeId } from '../fallback/fallback-adapter.js';
import { deterministicEnvelope, FragmentBuilder } from '../fragment-builder.js';

import type {
  AnalysisContext,
  DetectionResult,
  GitDiff,
  GraphChangeSet,
  GraphFragment,
  IndexingContext,
  LanguageAdapter,
  RepositoryContext,
  RepositoryFile,
} from '../types.js';

// Story 2.5 — Prisma schema parsing: `model X { … }` blocks become data/table nodes with
// `configuration` provenance. Parsed line-by-line, never executed (PRD §35).

const MODEL_PATTERN = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;

const parseModels = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  context: IndexingContext,
): void => {
  addFileFact(builder, file, context);
  file.content.split('\n').forEach((line, index) => {
    const match = MODEL_PATTERN.exec(line);
    const name = match?.[1];
    if (name === undefined) {
      return;
    }
    const evidenceId = builder.addEvidence(
      {
        id: `ev:symbol-declaration:${file.relativePath}:${String(index + 1)}:1`,
        kind: 'symbol-declaration',
        source: {
          kind: 'file',
          filePath: file.relativePath,
          range: {
            startLine: index + 1,
            startColumn: 1,
            endLine: index + 1,
            endColumn: line.length + 1,
          },
          symbolName: name,
        },
        repositorySnapshotId: context.repositorySnapshotId,
        createdAt: context.createdAt,
      },
      file.relativePath,
    );
    if (evidenceId === undefined) {
      return;
    }
    const nodeId = `datamodel:${file.relativePath}#${name}`;
    builder.addNode(
      {
        id: nodeId,
        category: 'data',
        type: 'table',
        name,
        path: file.relativePath,
        knowledge: deterministicEnvelope(context, [evidenceId], 'configuration'),
      },
      file.relativePath,
    );
    builder.addEdge(
      {
        id: `contains:${nodeId}`,
        type: 'CONTAINS',
        sourceId: fileNodeId(file.relativePath),
        targetId: nodeId,
        knowledge: deterministicEnvelope(context, [evidenceId], 'configuration'),
      },
      file.relativePath,
    );
    builder.addExport(file.relativePath, { name, nodeId });
  });
};

class PrismaAdapter implements LanguageAdapter {
  public readonly id = 'prisma';
  public readonly supportedExtensions: readonly string[] = ['.prisma'];

  public detectProject(context: RepositoryContext): Promise<DetectionResult> {
    const detected = context.filePaths.some((path) => path.endsWith('.prisma'));
    return Promise.resolve({
      detected,
      reason: detected ? 'Prisma schema present' : 'no Prisma schema found',
    });
  }

  public indexFiles(
    files: readonly RepositoryFile[],
    context: IndexingContext,
  ): Promise<GraphFragment> {
    const builder = new FragmentBuilder(this.id);
    for (const file of files) {
      try {
        parseModels(builder, file, context);
      } catch (error) {
        addFileFact(builder, file, context);
        const message = error instanceof Error ? error.message : String(error);
        builder.warn(file.relativePath, `prisma parse failed, file-level only: ${message}`);
      }
    }
    return Promise.resolve(builder.build());
  }

  public analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet> {
    return analyzeDiffWithIndexer(diff, context, {
      adapterId: this.id,
      supportedExtensions: this.supportedExtensions,
      indexFiles: (files, indexingContext) => this.indexFiles(files, indexingContext),
    });
  }
}

export const createPrismaAdapter = (): LanguageAdapter => new PrismaAdapter();
