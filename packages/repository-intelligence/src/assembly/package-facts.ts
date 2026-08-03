import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import type { PackageInfo, ScannedFile } from '../scanner/scanner.js';
import type { GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

export const packageNodeId = (info: PackageInfo): string => `package:${info.name}`;

interface PackageFactsState {
  readonly builder: FragmentBuilder;
  readonly packages: readonly PackageInfo[];
  readonly files: readonly ScannedFile[];
  readonly context: IndexingContext;
}

const nearestPackage = (
  filePath: string,
  packages: readonly PackageInfo[],
): PackageInfo | undefined => {
  let best: PackageInfo | undefined;
  for (const candidate of packages) {
    const inside = candidate.relativeDir === '' || filePath.startsWith(`${candidate.relativeDir}/`);
    if (inside && (best === undefined || candidate.relativeDir.length > best.relativeDir.length)) {
      best = candidate;
    }
  }
  return best;
};

const addWorkspaceFacts = (
  state: PackageFactsState,
  root: PackageInfo,
  evidenceId: string,
): void => {
  const workspaceId = `workspace:${root.name}`;
  state.builder.addNode(
    {
      id: workspaceId,
      category: 'repository',
      type: 'workspace',
      name: root.name,
      path: root.manifestPath,
      knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
    },
    root.manifestPath,
  );
  for (const member of state.packages) {
    if (member !== root) {
      state.builder.addEdge(
        {
          id: `contains:${packageNodeId(member)}`,
          type: 'CONTAINS',
          sourceId: workspaceId,
          targetId: packageNodeId(member),
          knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
        },
        member.manifestPath,
      );
    }
  }
};

const addContainsFileEdges = (
  state: PackageFactsState,
  info: PackageInfo,
  evidenceId: string,
): void => {
  for (const file of state.files) {
    if (nearestPackage(file.relativePath, state.packages) === info) {
      state.builder.addEdge(
        {
          id: `contains:file:${file.relativePath}`,
          type: 'CONTAINS',
          sourceId: packageNodeId(info),
          targetId: `file:${file.relativePath}`,
          knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
        },
        file.relativePath,
      );
    }
  }
};

const addPackageFact = (state: PackageFactsState, info: PackageInfo): void => {
  const evidenceId = state.builder.addEvidence(
    {
      id: `ev:config-entry:${info.manifestPath}:name`,
      kind: 'config-entry',
      source: { kind: 'config', filePath: info.manifestPath, configKey: 'name' },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    info.manifestPath,
  );
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addNode(
    {
      id: packageNodeId(info),
      category: 'repository',
      type: 'package',
      name: info.name,
      path: info.manifestPath,
      knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
    },
    info.manifestPath,
  );
  if (info.workspaces.length > 0) {
    addWorkspaceFacts(state, info, evidenceId);
  }
  addContainsFileEdges(state, info, evidenceId);
};

/**
 * Packages/workspaces discovered from manifests (PRD §15.1), provenance `configuration`:
 * package nodes, workspace node when the root manifest declares workspaces, and CONTAINS
 * edges package → file (nearest manifest wins).
 */
export const buildPackageFacts = (
  packages: readonly PackageInfo[],
  files: readonly ScannedFile[],
  context: IndexingContext,
): GraphFragment => {
  const builder = new FragmentBuilder('package-discovery');
  const state: PackageFactsState = { builder, packages, files, context };
  for (const info of packages) {
    addPackageFact(state, info);
  }
  return builder.build();
};
