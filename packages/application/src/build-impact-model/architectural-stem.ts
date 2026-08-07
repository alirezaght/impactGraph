// ADR-0016 — architecture-aware concept matching under the name-similarity ceiling.
//
// A specification says "deals"; the repository says `DealsController`. Character coverage alone
// rejects that pair (6 of 15 characters), yet it is the single most common planning miss: the
// author named the domain word and the code added a conventional role suffix. This module
// recognizes exactly that convention — and nothing looser — so the matcher can bridge it while
// the `name-similarity` evidence basis caps everything found this way at `likely` (ADR-0015
// addendum): a convention match is a strong lead, never an obligation.

/**
 * Closed list of architectural role suffixes, as lowercase name tokens.
 *
 * Finalized against what the fixture repositories and framework adapters actually produce
 * (`DealsController`/`DealsService`/`DealsModule` in nestjs-app, `DealRepository` in ts-basic,
 * `PubSubInboundChannelAdapter` in java-spring, `TestClient`/`DealDto`, `provider-config`, …).
 * Deliberately closed and framework-agnostic: per-framework additions belong in adapter metadata
 * if this list ever starts growing per stack (ADR-0016 revisit trigger).
 */
export const ARCHITECTURAL_SUFFIX_TOKENS: ReadonlySet<string> = new Set([
  'controller',
  'service',
  'repository',
  'module',
  'handler',
  'adapter',
  'provider',
  'store',
  'factory',
  'gateway',
  'client',
  'dto',
  'config',
]);

/**
 * The component name minus its trailing architectural suffix tokens. Only TRAILING tokens are
 * stripped (stacked ones too: `DealServiceFactory` → `deal`): a suffix word in the middle of a
 * name is part of what the component is about, not a role annotation.
 */
export const architecturalStemOf = (nameTokens: readonly string[]): readonly string[] => {
  let end = nameTokens.length;
  while (end > 0 && ARCHITECTURAL_SUFFIX_TOKENS.has(nameTokens[end - 1] ?? '')) {
    end -= 1;
  }
  return nameTokens.slice(0, end);
};

/**
 * The rule is "cover the whole stem", not "share a token".
 *
 * A concept matches a conventionally-suffixed component name when, after stripping the trailing
 * architectural suffix tokens from the COMPONENT name, the concept IS the remaining stem —
 * compared as normalized character strings, so the same word behaves the same in every casing
 * (`TypeScript` splits into two tokens where `typescript` stays one; joined characters erase
 * that difference, for the same reason `nameCoverage` measures characters). Consequences:
 *
 * - `deals` → `DealsController` matches: the concept equals the whole stem (`deals`).
 * - `service` → `DealService` adds no stem token — this rule rejects it (the ordinary coverage
 *   rule may still speak for itself; a bare `dto` → `DealDto` is rejected by both).
 * - `storage` → `SecretStorage` does not match: no suffix was stripped, so this rule does not
 *   apply at all and the ordinary token-alignment + coverage rule keeps rejecting it.
 *
 * Equality is exact (no stemming): `deals` does not claim `DealController`. Loosening that is a
 * calibration decision for the matrix, not a default.
 */
export const coversArchitecturalStem = (
  conceptTokens: readonly string[],
  nameTokens: readonly string[],
): boolean => {
  const stem = architecturalStemOf(nameTokens);
  if (conceptTokens.length === 0 || stem.length === 0 || stem.length === nameTokens.length) {
    return false;
  }
  return conceptTokens.join('') === stem.join('');
};
