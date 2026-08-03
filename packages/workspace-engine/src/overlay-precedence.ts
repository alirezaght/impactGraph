import { CONFIG_PRECEDENCE_LEVELS } from '@impactgraph/contracts';

import type { ConfigPrecedenceLevelDto, ConfigSourceDto } from '@impactgraph/contracts';
import type { Provenance } from '@impactgraph/domain';

// §Z5 "Configuration Sources and Priority" made executable. Six levels, highest first:
//   1 human-confirmed · 2 agent-approved · 3 repo metadata · 4 deterministic detection ·
//   5 AI-inferred · 6 defaults.
// Nothing here decides WHAT a value is — only which of several candidate sources wins, and what
// provenance the winner legitimately carries (§3: a level never upgrades a weaker category).

export type PrecedenceLevel = ConfigPrecedenceLevelDto;

export const precedenceRank = (level: PrecedenceLevel): number =>
  CONFIG_PRECEDENCE_LEVELS.indexOf(level) + 1;

/**
 * A committed configuration record's §Z5 level. Absent `source` means hand-written YAML, which is
 * human knowledge by definition (§16) — the safe reading, since agents only ever write the field.
 */
export const levelForSource = (source: ConfigSourceDto | undefined): PrecedenceLevel =>
  source === 'agent-approved' ? 'agent-approved' : 'human-confirmed';

const LEVEL_BY_PROVENANCE: Readonly<Record<Provenance, PrecedenceLevel>> = {
  'human-confirmed': 'human-confirmed',
  // Repository-native metadata: manifests, build config, lockfiles.
  configuration: 'repo-metadata',
  'static-analysis': 'deterministic-detection',
  'framework-convention': 'deterministic-detection',
  'git-history': 'deterministic-detection',
  'llm-inferred': 'ai-inferred',
  // Reserved (§12.3) — no v1 code path produces it; classified as detection if it ever appears.
  'runtime-observation': 'deterministic-detection',
};

export const levelForProvenance = (provenance: string): PrecedenceLevel =>
  LEVEL_BY_PROVENANCE[provenance as Provenance] ?? 'defaults';

/**
 * The provenance a committed configuration record may claim. A human-approved change is
 * human-confirmed knowledge; an agent-applied one stays `llm-inferred` — committing an agent's
 * value to YAML does not make it a deterministic fact (§3, ADR-0002).
 */
export const provenanceForLevel = (level: PrecedenceLevel): string => {
  if (level === 'human-confirmed') {
    return 'human-confirmed';
  }
  if (level === 'agent-approved' || level === 'ai-inferred') {
    return 'llm-inferred';
  }
  if (level === 'repo-metadata') {
    return 'configuration';
  }
  return 'framework-convention';
};

export interface Resolved<T> {
  readonly value: T;
  readonly level: PrecedenceLevel;
  readonly rank: number;
  readonly provenance: string;
  readonly detail: string;
}

export const resolved = <T>(
  value: T,
  level: PrecedenceLevel,
  detail: string,
  provenance = provenanceForLevel(level),
): Resolved<T> => ({ value, level, rank: precedenceRank(level), provenance, detail });

/**
 * Highest-priority candidate wins. Ties go to the LAST candidate, so callers order candidates
 * weakest-first and file order stays the tie-breaker inside a document (as `assignmentFor` does).
 */
export const bestOf = <T>(candidates: readonly Resolved<T>[]): Resolved<T> | undefined => {
  let best: Resolved<T> | undefined;
  for (const candidate of candidates) {
    if (best === undefined || candidate.rank <= best.rank) {
      best = candidate;
    }
  }
  return best;
};
