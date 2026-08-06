import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RepositoryRoster } from './registered-repositories.js';
import type { CandidateRepositoryDto } from '@impactgraph/contracts';

/**
 * Discovered-but-unregistered repositories: first-level directories under the workspace root that
 * contain their own git repository and are not in the roster.
 *
 * These are CANDIDATES, never members. Registration is a user decision recorded in
 * .impactgraph/config.yml — inferring it would index code the user never pointed the tool at.
 * Discovery never leaves the workspace root: filesystem siblings (`../billing`) are out of scope
 * by the same containment rule that governs registration (PRD §42.5).
 */

const CANDIDATE_HINT =
  'contains its own git repository but is not registered in .impactgraph/config.yml (`repositories:`) — confirm with the user, register it, then re-run index_workspace';

export const discoverCandidateRepositories = (
  rootDir: string,
  roster: RepositoryRoster,
): readonly CandidateRepositoryDto[] => {
  const registered = new Set(
    roster.members
      .map((member) => member.resolvedPath)
      .filter((path): path is string => path !== undefined),
  );
  let entries;
  try {
    entries = readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: CandidateRepositoryDto[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const absolute = join(rootDir, entry.name);
    if (registered.has(absolute) || !existsSync(join(absolute, '.git'))) {
      continue;
    }
    candidates.push({ name: entry.name, path: entry.name, hint: CANDIDATE_HINT });
  }
  return candidates;
};
