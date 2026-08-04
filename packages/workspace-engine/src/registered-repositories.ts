import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { readWorkspaceConfig } from '@impactgraph/persistence';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';

/**
 * Related repositories registered as one workspace (item 6).
 *
 * The requirement is precise about what this is NOT: repositories keep separate identities and
 * separate snapshots. So this does not merge trees — it resolves the roster, reports which members are
 * present, and reports which are registered-but-absent. That last set is the important one: an absent
 * repository does not make the analysis wrong, it makes it INCOMPLETE in a way that has to be stated,
 * because "no consumer found" and "the consumer's repository was not on disk" are opposite claims.
 */

export interface RegisteredRepository {
  readonly name: string;
  /** Declared path, verbatim, as written in configuration. */
  readonly declaredPath: string;
  /** Absolute path when it resolves inside the workspace and exists; absent otherwise. */
  readonly resolvedPath?: string;
  readonly present: boolean;
  readonly enabled: boolean;
  /** Why an entry is unusable, when it is. */
  readonly reason?: string;
}

export interface RepositoryRoster {
  /** The workspace root itself, always first: it is a member of its own workspace. */
  readonly members: readonly RegisteredRepository[];
  /** Registered, enabled, and not on disk. The scope limitation to report on every answer. */
  readonly absent: readonly RegisteredRepository[];
  /** One sentence per limitation, ready to attach to a query outcome. */
  readonly limitations: readonly string[];
}

const ROOT_NAME = '(workspace root)';

/**
 * A declared path must stay inside the workspace root.
 *
 * Not a stylistic rule: the path comes from committed configuration, which is repository content and
 * therefore untrusted (PRD §42.5). A `../../..` entry would have the indexer read and report on files
 * outside the directory the user pointed it at.
 */
const resolveMember = (
  rootDir: string,
  declaredPath: string,
): { path?: string; reason?: string } => {
  const absolute = isAbsolute(declaredPath) ? declaredPath : resolve(rootDir, declaredPath);
  if (!absolute.startsWith(rootDir)) {
    return {
      reason:
        'the declared path resolves outside the workspace root, which is refused — registered repositories must live inside it',
    };
  }
  if (!existsSync(absolute)) {
    return { reason: 'the declared path does not exist on disk' };
  }
  return { path: absolute };
};

export const readRepositoryRoster = (rootDir: string): Failable<RepositoryRoster> => {
  const config = readWorkspaceConfig(rootDir);
  if (!config.ok) {
    return failWith('configurationError', config.error.message);
  }
  const declared = config.value?.repositories ?? [];
  const members: RegisteredRepository[] = [
    { name: ROOT_NAME, declaredPath: '.', resolvedPath: rootDir, present: true, enabled: true },
  ];
  for (const entry of declared) {
    const enabled = entry.enabled ?? true;
    const resolved = resolveMember(rootDir, entry.path);
    members.push({
      name: entry.name,
      declaredPath: entry.path,
      ...(resolved.path === undefined ? {} : { resolvedPath: resolved.path }),
      present: resolved.path !== undefined,
      enabled,
      ...(resolved.reason === undefined ? {} : { reason: resolved.reason }),
    });
  }
  const absent = members.filter((member) => member.enabled && !member.present);
  return {
    ok: true,
    value: {
      members,
      absent,
      limitations: limitationsFor(members, absent),
    },
  };
};

const limitationsFor = (
  members: readonly RegisteredRepository[],
  absent: readonly RegisteredRepository[],
): readonly string[] => {
  const registered = members.length - 1;
  if (registered === 0) {
    return [
      'Only this repository was analyzed; no related repositories are registered in .impactgraph/config.yml (`repositories:`).',
    ];
  }
  const disabled = members.filter((member) => !member.enabled).map((member) => member.name);
  return [
    `${String(registered)} related repository/repositories are registered; ${String(registered - absent.length - disabled.length)} were analyzed.`,
    ...absent.map(
      (member) =>
        `'${member.name}' is registered but was not analyzed (${member.reason ?? 'not present'}) — outbound boundaries to it are reported with an unresolved consumer rather than as absent.`,
    ),
    ...(disabled.length === 0
      ? []
      : [`Disabled in configuration, so not analyzed: ${disabled.join(', ')}.`]),
  ];
};

/** Absolute roots to index this run: the workspace plus every present, enabled member. */
export const indexableRoots = (roster: RepositoryRoster): readonly string[] =>
  roster.members
    .filter((member) => member.enabled && member.present)
    .map((member) => member.resolvedPath)
    .filter((path): path is string => path !== undefined);
