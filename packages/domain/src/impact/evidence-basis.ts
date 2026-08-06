import type { ImpactLikelihood } from './impact-analysis.js';

/**
 * WHY an impact was selected (trial finding: "Keyword matches were labeled required despite having
 * no structural relationship").
 *
 * Confidence alone cannot answer this. Two impacts can score 0.6 because one is a call away from a
 * component the specification named and the other shares a word with it, and a reader has no way to
 * tell them apart from a number. The basis is therefore recorded as its own field, from a closed
 * vocabulary, and the tier a basis may reach is capped by it — a lexical coincidence can never be
 * labeled `required` however many other signals pile on.
 */
export const IMPACT_EVIDENCE_TYPES = [
  /** The specification named this component, or it is one propagating hop from one that was. */
  'direct-structural',
  /** Reached over two or more propagating relationships. */
  'transitive-structural',
  /** Reached across an event, topic, queue, subscription, or outbox relationship. */
  'async-event',
  /** Reached across an HTTP route, OpenAPI operation, or an unresolved external boundary. */
  'external-contract',
  /** Reached by following a named field or payload attribute through code. */
  'field-data-flow',
  /** A configuration file, asset, locale entry, migration, or contract document. */
  'configuration-asset',
  /**
   * Matched by deterministic fuzzy name similarity — whole-token alignment plus character
   * coverage — not by exact identifier or alias. The engine GUESSED which component was meant, and
   * a guess is never an obligation: this basis tops out at `likely` and poisons every route
   * reached through it.
   */
  'name-similarity',
  /** Matched by meaning — documentation, sibling symbols, normalized naming — not by identifier. */
  'semantic-match',
  /**
   * Matched only because text overlaps. No relationship to anything the specification named was
   * established. Never `required`, never `likely`, and hidden from default views.
   */
  'lexical-only',
] as const;

export type ImpactEvidenceType = (typeof IMPACT_EVIDENCE_TYPES)[number];

export const isImpactEvidenceType = (value: unknown): value is ImpactEvidenceType =>
  typeof value === 'string' && (IMPACT_EVIDENCE_TYPES as readonly string[]).includes(value);

/**
 * Strongest first. Used to pick the primary basis and to order the default view.
 *
 * `name-similarity` sits below every structural type — a name resemblance establishes no
 * relationship, and every type above it reflects an actually traversed one — but above
 * `semantic-match`: deterministic token alignment against a real symbol name is more reliable
 * evidence of "this is the component the specification meant" than a meaning-level association.
 */
const STRENGTH_ORDER: readonly ImpactEvidenceType[] = [
  'direct-structural',
  'async-event',
  'external-contract',
  'field-data-flow',
  'configuration-asset',
  'transitive-structural',
  'name-similarity',
  'semantic-match',
  'lexical-only',
];

export const evidenceStrengthRank = (type: ImpactEvidenceType): number => {
  const rank = STRENGTH_ORDER.indexOf(type);
  return rank === -1 ? STRENGTH_ORDER.length : rank;
};

/** The strongest basis in the set — the one an impact is filed under. */
export const primaryEvidenceType = (types: readonly ImpactEvidenceType[]): ImpactEvidenceType =>
  [...types].sort((a, b) => evidenceStrengthRank(a) - evidenceStrengthRank(b))[0] ?? 'lexical-only';

/**
 * The highest tier each basis may reach, whatever else corroborates it.
 *
 * This is the enforcement point for "a lexical match must never be labeled required". It is a
 * ceiling, not a floor: strong evidence still has to earn `required` through the classification
 * rules — the cap only stops a weak basis from being talked up.
 */
const TIER_CEILING: Readonly<Record<ImpactEvidenceType, ImpactLikelihood>> = {
  'direct-structural': 'required',
  'async-event': 'required',
  'external-contract': 'required',
  'field-data-flow': 'required',
  'configuration-asset': 'likely',
  'transitive-structural': 'likely',
  'name-similarity': 'likely',
  'semantic-match': 'likely',
  'lexical-only': 'lexical-only',
};

const TIER_RANK: Readonly<Record<ImpactLikelihood, number>> = {
  required: 0,
  likely: 1,
  possible: 2,
  'lexical-only': 3,
  unlikely: 4,
  excluded: 5,
};

export const likelihoodRank = (likelihood: ImpactLikelihood): number =>
  TIER_RANK[likelihood] ?? TIER_RANK.unlikely;

/** Apply the ceiling: returns the weaker of the proposed tier and what the basis permits. */
export const capLikelihood = (
  proposed: ImpactLikelihood,
  types: readonly ImpactEvidenceType[],
): ImpactLikelihood => {
  const ceiling = TIER_CEILING[primaryEvidenceType(types)];
  return likelihoodRank(proposed) >= likelihoodRank(ceiling) ? proposed : ceiling;
};

/** Bases shown by default. Lexical-only noise is opt-in, never the first thing a reader sees. */
export const STRUCTURAL_EVIDENCE_TYPES: readonly ImpactEvidenceType[] =
  IMPACT_EVIDENCE_TYPES.filter((type) => type !== 'lexical-only');
