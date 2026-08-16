import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractConstraints, looksLikeGuardPath } from '@impactgraph/application';
import { stableContentId } from '@impactgraph/domain';

import type { GuardFile } from '@impactgraph/application';
import type { KnowledgeGraph, RepositoryConstraint } from '@impactgraph/domain';

/**
 * Collect the repository's guards and turn them into indexed constraints.
 *
 * Candidates come from the graph rather than a fresh directory walk: only files the index already
 * knows about are read, so the constraint layer inherits the index's ignore rules, its snapshot
 * binding and its bounded size for free — and a guard inside an ignored directory is honestly
 * absent rather than half-present.
 */

/** Files worth reading as guards, beyond the conventional guard paths. */
const EXTRA_GUARD_PATHS =
  /(^|\/)(eslint\.config\.(m?js|cjs|ts)|\.eslintrc(\.\w+)?|\.gitlab-ci\.yml)$|(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)(adrs?|decisions)\/[^/]+\.(md|markdown)$/i;

/** A guard inside a test fixture is the FIXTURE's rule, never this workspace's. */
const FIXTURE_PATH = /(^|\/)(fixtures?|__fixtures__|testdata)\//i;

const isGuardCandidate = (path: string): boolean =>
  !FIXTURE_PATH.test(path) && (looksLikeGuardPath(path) || EXTRA_GUARD_PATHS.test(path));

/** Reading a guard must never break analysis: an unreadable file is simply not a guard we saw. */
const readGuard = (rootDir: string, path: string): GuardFile | undefined => {
  try {
    const content = readFileSync(join(rootDir, path), 'utf8');
    return content.length > 0 && content.length < 400_000 ? { path, content } : undefined;
  } catch {
    return undefined;
  }
};

export const collectGuardFiles = (rootDir: string, graph: KnowledgeGraph): readonly GuardFile[] => {
  const paths = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.path !== undefined && isGuardCandidate(node.path)) {
      paths.add(node.path);
    }
  }
  return [...paths]
    .sort()
    .map((path) => readGuard(rootDir, path))
    .filter((file): file is GuardFile => file !== undefined);
};

export interface LoadedConstraints {
  readonly constraints: readonly RepositoryConstraint[];
  readonly opaqueGuardPaths: readonly string[];
  readonly guardFileCount: number;
}

export const loadConstraints = (
  rootDir: string,
  graph: KnowledgeGraph,
  snapshotId: string,
  createdAt: string,
): LoadedConstraints => {
  const files = collectGuardFiles(rootDir, graph);
  const result = extractConstraints({
    files,
    repositorySnapshotId: snapshotId,
    createdAt,
    nextId: (seed) => stableContentId('constraint', seed),
    nextEvidenceId: (seed) => stableContentId('ev-constraint', seed),
  });
  return {
    constraints: result.constraints,
    opaqueGuardPaths: result.opaqueGuardPaths,
    guardFileCount: files.length,
  };
};
