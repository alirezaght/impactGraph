import type { RepositoryIndexStateDto } from '@impactgraph/contracts';

/**
 * Typed predicates over a repository's index state (dogfooding item 9, GAP: "reason strings are
 * the API"). Required actions, coverage verdicts and auto-reindexing used to string-match the
 * human `reason` sentence, so rewording it silently changed behavior. They key off `reasonCode`
 * now; the string match remains ONLY as a fallback for payloads produced before the code existed.
 */

const UNINDEXED_MARKER = 'not in the current index';
const DISABLED_REASON = 'disabled in configuration';

/** Registered, present, enabled — but absent from the current index. Fixed by index_workspace. */
export const isNotIndexedState = (state: RepositoryIndexStateDto): boolean =>
  state.reasonCode === undefined
    ? state.reason?.includes(UNINDEXED_MARKER) === true
    : state.reasonCode === 'not-indexed';

/** Disabled in configuration: a user decision, never a coverage gap to act on. */
export const isDisabledState = (state: RepositoryIndexStateDto): boolean =>
  state.reasonCode === undefined
    ? state.reason === DISABLED_REASON
    : state.reasonCode === 'disabled';

/** Unavailable for a reason indexing cannot fix: absent from disk or a refused path. */
export const isUnavailableState = (state: RepositoryIndexStateDto): boolean =>
  !state.indexed &&
  state.reason !== undefined &&
  !isNotIndexedState(state) &&
  !isDisabledState(state);
