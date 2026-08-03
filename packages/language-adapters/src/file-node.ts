import { deterministicEnvelope } from './fragment-builder.js';
import { isTestFilePath } from './test-detection.js';

import type { FragmentBuilder } from './fragment-builder.js';
import type { IndexingContext, RepositoryFile } from './types.js';

// The one file-level fact every adapter emits, kept out of any single adapter so that the
// fallback adapter, the language adapters, and analyzeDiff can share it without an import cycle.

export const fileNodeId = (relativePath: string): string => `file:${relativePath}`;

/** Emit the File node + file-presence evidence every file gets, whatever its language. */
export const addFileFact = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  context: IndexingContext,
): void => {
  const evidenceId = builder.addEvidence(
    {
      id: `ev:file-presence:${file.relativePath}`,
      kind: 'file-presence',
      source: { kind: 'file', filePath: file.relativePath },
      repositorySnapshotId: context.repositorySnapshotId,
      createdAt: context.createdAt,
    },
    file.relativePath,
  );
  if (evidenceId === undefined) {
    return;
  }
  // Test files are typed as test nodes by naming convention (Story 2.5, PRD §12.1).
  const isTest = isTestFilePath(file.relativePath);
  builder.addNode(
    {
      id: fileNodeId(file.relativePath),
      category: isTest ? 'application' : 'repository',
      type: isTest ? 'test' : 'file',
      name: file.relativePath.slice(file.relativePath.lastIndexOf('/') + 1),
      path: file.relativePath,
      knowledge: deterministicEnvelope(
        context,
        [evidenceId],
        isTest ? 'framework-convention' : 'static-analysis',
      ),
    },
    file.relativePath,
  );
};
