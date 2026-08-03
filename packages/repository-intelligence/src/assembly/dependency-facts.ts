import { deterministicEnvelope, FragmentBuilder } from '@impactgraph/language-adapters';

import { packageNodeId, packageNodeIdOf } from './package-facts.js';

import type { ManifestDependency, PackageInfo } from '../scanner/scanner.js';
import type { GraphFragment, IndexingContext } from '@impactgraph/language-adapters';

// Declared dependencies as first-class graph nodes (PRD §15.1). A specification that says "the
// packaged extension must contain the better-sqlite3 native binding" names a dependency, not a
// source symbol; with no node for it the requirement matched nothing and the analysis silently
// said the change had no impact. Provenance is `configuration` — the manifest is the evidence.
//
// The PRD §12.1 node roster is closed and has no "library" type, so an external dependency is
// emitted as the closest existing member, `third-party-service`: a component this package
// depends on that lives outside the repository.

export const dependencyNodeId = (name: string): string => `dependency:${name}`;

interface DependencyState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  /** Workspace-internal package names — these already have `package:` nodes. */
  readonly internalNames: ReadonlySet<string>;
  readonly emitted: Set<string>;
}

const addDependencyFact = (
  state: DependencyState,
  info: PackageInfo,
  dependency: ManifestDependency,
): void => {
  const evidenceId = state.builder.addEvidence(
    {
      id: `ev:config-entry:${info.manifestPath}:${dependency.configKey}`,
      kind: 'config-entry',
      source: {
        kind: 'config',
        filePath: info.manifestPath,
        configKey: dependency.configKey,
      },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    info.manifestPath,
  );
  if (evidenceId === undefined) {
    return;
  }
  const internal = state.internalNames.has(dependency.name);
  const targetId = internal ? packageNodeIdOf(dependency.name) : dependencyNodeId(dependency.name);
  if (!internal && !state.emitted.has(targetId)) {
    state.emitted.add(targetId);
    state.builder.addNode(
      {
        id: targetId,
        category: 'integration',
        type: 'third-party-service',
        name: dependency.name,
        knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
      },
      info.manifestPath,
    );
  }
  state.builder.addEdge(
    {
      id: `depends-on:${packageNodeId(info)}->${targetId}`,
      type: 'DEPENDS_ON',
      sourceId: packageNodeId(info),
      targetId,
      knowledge: deterministicEnvelope(state.context, [evidenceId], 'configuration'),
    },
    info.manifestPath,
  );
};

/**
 * One node per external dependency (deduplicated across manifests) plus a DEPENDS_ON edge from
 * every declaring package. Workspace-internal dependencies get the edge only — their node already
 * exists, and duplicating it would split the same component across two ids.
 */
export const buildDependencyFacts = (
  packages: readonly PackageInfo[],
  context: IndexingContext,
): GraphFragment => {
  const builder = new FragmentBuilder('dependency-discovery');
  const state: DependencyState = {
    builder,
    context,
    internalNames: new Set(packages.map((info) => info.name)),
    emitted: new Set(),
  };
  for (const info of packages) {
    for (const dependency of info.dependencies) {
      addDependencyFact(state, info, dependency);
    }
  }
  return builder.build();
};
