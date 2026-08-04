import type { RepositorySnapshot } from './repository-snapshot.js';

/**
 * Active staleness detection (item 10: "Repository/index staleness was recorded but not actively
 * warned about").
 *
 * The index is a cache of a moving target. Every conclusion drawn from it is conditional on the
 * cache still describing the working tree, and a stale cache produces the worst kind of wrong
 * answer: a confident absence. "No callers" over a two-day-old index is not a finding.
 *
 * Freshness is DERIVED at read time and never persisted — persisting it would make it stale too.
 */
export const FRESHNESS_STATES = [
  /** Indexed at the current commit with a clean tree: conclusions hold. */
  'current',
  /** Indexed at the current commit, but the tree has uncommitted changes since. */
  'working-tree-modified',
  /** HEAD moved since the index was built. */
  'behind-head',
  /** The specification moved to a version the analysis never saw. */
  'specification-moved',
  /** Old enough that drift is likely even if HEAD matches (e.g. a long-running dirty branch). */
  'aged',
  /** Nothing indexed at all. */
  'not-indexed',
] as const;

export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export interface IndexFreshness {
  readonly state: FreshnessState;
  /** True when any conclusion drawn from this index must be labeled provisional. */
  readonly stale: boolean;
  /** One user-facing sentence per reason, in priority order. */
  readonly reasons: readonly string[];
  readonly indexedSnapshotId?: string;
  readonly indexedAt?: string;
  readonly currentCommitSha?: string;
  readonly recommendedAction?: string;
}

export interface FreshnessInput {
  /** The snapshot the index/analysis is bound to; absent → nothing indexed. */
  readonly indexed?: RepositorySnapshot | undefined;
  /** Current repository state, read at query time. */
  readonly current?: { readonly commitSha: string; readonly dirtyWorkingTree: boolean } | undefined;
  /** ISO now, from the clock port. */
  readonly now: string;
  /** Version of the specification the analysis used, and the latest stored version. */
  readonly specificationVersion?: number | undefined;
  readonly latestSpecificationVersion?: number | undefined;
  /** Hours after which an index is called `aged` even when HEAD still matches. */
  readonly ageLimitHours?: number;
}

const DEFAULT_AGE_LIMIT_HOURS = 24;

const hoursBetween = (from: string, to: string): number => {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isNaN(start) || Number.isNaN(end) ? 0 : (end - start) / 3_600_000;
};

const REINDEX = 'Run `impactgraph index` (or Reindex in the extension) and re-run the analysis.';

/**
 * One check per possible reason, in PRIORITY ORDER: a moved HEAD is a stronger reason than a dirty
 * tree, and both outrank age. The first match names the state; every match contributes a reason, so
 * nothing is hidden behind the headline.
 */
const CHECKS: readonly {
  readonly state: FreshnessState;
  readonly applies: (input: FreshnessInput, indexed: RepositorySnapshot) => boolean;
  readonly reason: (input: FreshnessInput, indexed: RepositorySnapshot) => string;
}[] = [
  {
    state: 'behind-head',
    applies: (input, indexed) =>
      input.current !== undefined && input.current.commitSha !== indexed.head.commitSha,
    reason: (input, indexed) =>
      `The index was built at commit ${indexed.head.commitSha.slice(0, 12)} but HEAD is now ${(input.current?.commitSha ?? '').slice(0, 12)} — components may have moved, been added, or been deleted since.`,
  },
  {
    state: 'working-tree-modified',
    applies: (input) => input.current?.dirtyWorkingTree === true,
    reason: () =>
      'The working tree has uncommitted changes that are not in the index, so absent results may simply be unindexed.',
  },
  {
    state: 'specification-moved',
    applies: (input) =>
      input.specificationVersion !== undefined &&
      input.latestSpecificationVersion !== undefined &&
      input.latestSpecificationVersion > input.specificationVersion,
    reason: (input) =>
      `The analysis was built against specification version ${String(input.specificationVersion)}, and version ${String(input.latestSpecificationVersion)} is now stored.`,
  },
  {
    state: 'aged',
    applies: (input, indexed) =>
      hoursBetween(indexed.createdAt, input.now) > (input.ageLimitHours ?? DEFAULT_AGE_LIMIT_HOURS),
    reason: (input, indexed) =>
      `The index is ${String(Math.floor(hoursBetween(indexed.createdAt, input.now)))} hours old; drift is likely even though HEAD matches.`,
  },
];

const NOT_INDEXED: IndexFreshness = {
  state: 'not-indexed',
  stale: true,
  reasons: ['The repository has not been indexed, so no conclusion can be drawn from the graph.'],
  recommendedAction: REINDEX,
};

export const assessFreshness = (input: FreshnessInput): IndexFreshness => {
  const indexed = input.indexed;
  if (indexed === undefined) {
    return NOT_INDEXED;
  }
  const matched = CHECKS.filter((check) => check.applies(input, indexed));
  const stale = matched.length > 0;
  return {
    state: matched[0]?.state ?? 'current',
    stale,
    reasons: matched.map((check) => check.reason(input, indexed)),
    indexedSnapshotId: indexed.id,
    indexedAt: indexed.createdAt,
    ...(input.current === undefined ? {} : { currentCommitSha: input.current.commitSha }),
    ...(stale ? { recommendedAction: REINDEX } : {}),
  };
};
