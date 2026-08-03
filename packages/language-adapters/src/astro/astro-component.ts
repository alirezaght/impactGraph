import { addFileFact, fileNodeId } from '../file-node.js';
import { deterministicEnvelope } from '../fragment-builder.js';

import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext, RepositoryFile } from '../types.js';

// Astro's central convention: an `.astro` FILE is a component, default-exported and named by its
// own file name (PRD §15.2). That single convention is what lets
// `import Base from '../layouts/Base.astro'` in one file bind to `<Base>` in its template — so
// the component node is emitted by the language adapter, not by framework enrichment, because
// without it nothing downstream can resolve a component reference at all.

/** `src/layouts/Base.astro` → 'Base'. */
export const componentNameOf = (relativePath: string): string => {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
};

export const componentNodeId = (relativePath: string): string =>
  `symbol:${relativePath}#${componentNameOf(relativePath)}`;

/**
 * Emit the File node and the component node for one `.astro` file. Returns the component node id,
 * or undefined when the file-level evidence could not be recorded (the node would be unprovable).
 */
export const addAstroComponent = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  context: IndexingContext,
): string | undefined => {
  addFileFact(builder, file, context);
  const name = componentNameOf(file.relativePath);
  const evidenceId = builder.addEvidence(
    {
      id: `ev:file-presence:astro-component:${file.relativePath}`,
      kind: 'file-presence',
      source: { kind: 'file', filePath: file.relativePath, symbolName: name },
      repositorySnapshotId: context.repositorySnapshotId,
      createdAt: context.createdAt,
    },
    file.relativePath,
  );
  if (evidenceId === undefined) {
    return undefined;
  }
  const nodeId = componentNodeId(file.relativePath);
  // Convention-derived, not parsed: there is no `export default` to read in an `.astro` file.
  const knowledge = deterministicEnvelope(context, [evidenceId], 'framework-convention');
  const node = builder.addNode(
    {
      id: nodeId,
      category: 'application',
      type: 'ui-component',
      name,
      path: file.relativePath,
      knowledge,
    },
    file.relativePath,
  );
  if (node === undefined) {
    return undefined;
  }
  builder.addEdge(
    {
      id: `contains:${nodeId}`,
      type: 'CONTAINS',
      sourceId: fileNodeId(file.relativePath),
      targetId: nodeId,
      knowledge,
    },
    file.relativePath,
  );
  builder.addExport(file.relativePath, { name, nodeId });
  return nodeId;
};
