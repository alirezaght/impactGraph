import { existsSync } from 'node:fs';
import { relative } from 'node:path';

import { indexDatabasePath, openSqliteIndexStore } from '@impactgraph/persistence';

import { performIndexRun } from './indexing.js';
import { readRepositoryRoster } from './registered-repositories.js';
import { discoverCandidateRepositories } from './repository-discovery.js';

import type { Failable } from './failure.js';
import type { RegisteredRepository, RepositoryRoster } from './registered-repositories.js';
import type { CandidateRepositoryDto, RepositoryIndexStateDto } from '@impactgraph/contracts';

/**
 * Per-repository index state, DERIVED from the current snapshot's file hashes by path prefix —
 * never persisted. A stored "indexed" flag would go stale the moment configuration changes; the
 * file list that produced the current graph cannot.
 */

const ROOT_STATE_NAME = '(workspace root)';

export interface WorkspaceRepositoryContext {
  /** Roster members with their derived index state (the workspace root is always first). */
  readonly repositories: readonly RepositoryIndexStateDto[];
  /** Discovered git directories that are NOT registered — candidates needing user confirmation. */
  readonly candidates: readonly CandidateRepositoryDto[];
  /** Roster limitations, ready to attach to a query outcome. */
  readonly limitations: readonly string[];
}

export const memberPrefix = (rootDir: string, member: RegisteredRepository): string | undefined =>
  member.resolvedPath === undefined || member.resolvedPath === rootDir
    ? undefined
    : relative(rootDir, member.resolvedPath);

const unusableState = (member: RegisteredRepository): RepositoryIndexStateDto => ({
  name: member.name,
  path: member.declaredPath,
  indexed: false,
  fileCount: 0,
  reason: member.enabled
    ? (member.reason ?? 'the declared path does not exist on disk')
    : 'disabled in configuration',
});

/** Assign each indexed file to the deepest member prefix; the remainder belongs to the root. */
const stateFromFilePaths = (
  rootDir: string,
  roster: RepositoryRoster,
  filePaths: readonly string[],
): RepositoryIndexStateDto[] => {
  const members = roster.members.filter((member) => member.name !== ROOT_STATE_NAME);
  const prefixed = members
    .map((member) => ({ member, prefix: memberPrefix(rootDir, member) }))
    .filter((entry): entry is { member: RegisteredRepository; prefix: string } =>
      Boolean(entry.member.enabled && entry.member.present && entry.prefix !== undefined),
    )
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const counts = new Map<string, number>(prefixed.map((entry) => [entry.member.name, 0]));
  let rootCount = 0;
  for (const path of filePaths) {
    const owner = prefixed.find((entry) => path.startsWith(`${entry.prefix}/`));
    if (owner === undefined) {
      rootCount += 1;
    } else {
      counts.set(owner.member.name, (counts.get(owner.member.name) ?? 0) + 1);
    }
  }
  return [
    { name: ROOT_STATE_NAME, indexed: filePaths.length > 0, fileCount: rootCount },
    ...members.map((member) => {
      const entry = prefixed.find((candidate) => candidate.member.name === member.name);
      if (entry === undefined) {
        return unusableState(member);
      }
      const fileCount = counts.get(member.name) ?? 0;
      return {
        name: member.name,
        path: entry.prefix,
        indexed: fileCount > 0,
        fileCount,
        ...(fileCount > 0
          ? {}
          : { reason: 'registered but not in the current index — run index_workspace' }),
      };
    }),
  ];
};

const currentIndexedFilePaths = async (rootDir: string): Promise<readonly string[]> => {
  const dbPath = indexDatabasePath(rootDir);
  if (!existsSync(dbPath)) {
    return [];
  }
  const store = openSqliteIndexStore(dbPath);
  if (!store.ok) {
    return [];
  }
  try {
    const current = await store.value.getCurrentSnapshotId();
    if (!current.ok || current.value === undefined) {
      return [];
    }
    const hashes = await store.value.getFileHashes(current.value);
    return hashes.ok ? Object.keys(hashes.value) : [];
  } finally {
    await store.value.close();
  }
};

export const collectWorkspaceRepositoryContext = async (
  rootDir: string,
): Promise<Failable<WorkspaceRepositoryContext>> => {
  const roster = readRepositoryRoster(rootDir);
  if (!roster.ok) {
    return roster;
  }
  const filePaths = await currentIndexedFilePaths(rootDir);
  return {
    ok: true,
    value: {
      repositories: stateFromFilePaths(rootDir, roster.value, filePaths),
      candidates: discoverCandidateRepositories(rootDir, roster.value),
      limitations: roster.value.limitations,
    },
  };
};

export interface EnsureIndexedOutcome {
  readonly reindexed: boolean;
  /** Why an attempted reindex did not happen cleanly — reported, never swallowed. */
  readonly failureMessage?: string;
}

/**
 * Automatic indexing of REGISTERED repositories only (never candidates): when the workspace has a
 * current index but an enabled, present member contributed no files to it — typically a repository
 * registered after the last run — reindex before analyzing instead of analyzing a graph that is
 * known to be missing a member.
 */
export const ensureRegisteredRepositoriesIndexed = async (
  rootDir: string,
): Promise<Failable<EnsureIndexedOutcome>> => {
  const context = await collectWorkspaceRepositoryContext(rootDir);
  if (!context.ok) {
    return context;
  }
  const anythingIndexed = context.value.repositories.some((state) => state.indexed);
  const unindexedMember = context.value.repositories.some(
    (state) =>
      state.name !== ROOT_STATE_NAME &&
      !state.indexed &&
      state.path !== undefined &&
      state.reason?.includes('not in the current index') === true,
  );
  if (!anythingIndexed || !unindexedMember) {
    return { ok: true, value: { reindexed: false } };
  }
  const run = await performIndexRun(rootDir);
  if (!run.ok) {
    return { ok: true, value: { reindexed: false, failureMessage: run.failure.message } };
  }
  return { ok: true, value: { reindexed: true } };
};
