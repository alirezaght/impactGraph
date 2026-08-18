/**
 * A term the specification names that resolves to no indexed artifact — modelled as a finding in
 * its own right rather than as the absence of one (ADR-0025).
 *
 * The failure this replaces: a specification introducing `/threshold-eval/export` produced a
 * warning nobody read and a page of existing artifacts whose names happen to contain "export". The
 * absence WAS the finding — there is no such surface, and building it is the work — but the output
 * presented the coincidences as the answer and the absence as a footnote.
 *
 * The other half of the failure is forcing a single reading. "No indexed artifact matches" is
 * consistent with at least five different plans, and they are not variations on each other: build
 * it, call it, index the repository that has it, rename the concept, or admit we cannot tell. So a
 * surface carries the reading the evidence best supports AND the readings that remain open, and a
 * consumer that needs certainty is told it does not have any.
 */

export const UNRESOLVED_SURFACE_KINDS = [
  /** Nothing exists yet and the specification is asking for it to be built. */
  'new-surface',
  /** It lives in a system this repository calls but does not contain. */
  'external-dependency',
  /** It may well exist — in a repository or directory that is not in the index. */
  'coverage-gap',
  /** Something very like it exists under a different name; the vocabularies disagree. */
  'terminology-mismatch',
  /** None of the above is better supported than any other. Stated, never guessed away. */
  'insufficient-evidence',
] as const;

export type UnresolvedSurfaceKind = (typeof UNRESOLVED_SURFACE_KINDS)[number];

export const isUnresolvedSurfaceKind = (value: unknown): value is UnresolvedSurfaceKind =>
  typeof value === 'string' && (UNRESOLVED_SURFACE_KINDS as readonly string[]).includes(value);

/**
 * How the author wrote the term. It decides how loudly absence should be reported: a route or a
 * path is a commitment to a specific surface, so its absence is a planning fact; a bare prose term
 * absent from the index is usually just vocabulary.
 */
export const CONCEPT_SHAPES = ['route', 'path', 'identifier', 'term'] as const;
export type ConceptShape = (typeof CONCEPT_SHAPES)[number];

const FILE_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
const IDENTIFIER_SHAPE = /^[A-Za-z_$][\w$]*$/;

export const conceptShapeOf = (concept: string): ConceptShape => {
  const trimmed = concept.trim();
  // Whitespace means prose, whatever punctuation it also contains: "configures service" is a
  // phrase, not a path, and reporting it as an absent commitment is how a useful list turns
  // back into a wall of adjectives.
  if (/\s/.test(trimmed)) {
    return 'term';
  }
  if (trimmed.startsWith('/') && !FILE_EXTENSION.test(trimmed)) {
    return 'route';
  }
  if (trimmed.includes('/')) {
    return 'path';
  }
  if (FILE_EXTENSION.test(trimmed) || (IDENTIFIER_SHAPE.test(trimmed) && /[A-Z_]/.test(trimmed))) {
    return 'identifier';
  }
  return 'term';
};

export interface UnresolvedSurface {
  readonly concept: string;
  readonly shape: ConceptShape;
  /** The best-supported reading. Never the only one a consumer is allowed to consider. */
  readonly kind: UnresolvedSurfaceKind;
  /** The readings that remain open on this evidence, strongest first. May be empty. */
  readonly alternativeKinds: readonly UnresolvedSurfaceKind[];
  readonly rationale: string;
  readonly requirementIds: readonly string[];
  /**
   * Indexed names that came close without matching. This is the terminology-mismatch evidence, and
   * it is deliberately reported HERE rather than as impacts: "something called `exportJob` exists"
   * is a lead about a name, not a prediction that `exportJob` changes.
   */
  readonly nearestExisting: readonly string[];
  readonly confidence: number;
}

/** Deterministic observations the caller supplies; the classifier invents nothing. */
export interface UnresolvedSurfaceSignals {
  readonly concept: string;
  readonly requirementIds: readonly string[];
  /** The requirement that names it uses creation language ("add", "introduce", "new"). */
  readonly usesCreationLanguage: boolean;
  /** The requirement names an external system, host, or third-party boundary. */
  readonly referencesExternalBoundary: boolean;
  /** Repository coverage is insufficient, or an indexing gap overlaps the requirement's area. */
  readonly withinCoverageGap: boolean;
  /** Surfaces of the same kind ARE indexed — so the index reaches here and the thing is absent. */
  readonly siblingSurfaceIndexed: boolean;
  readonly nearestExisting: readonly string[];
}

const RATIONALE: Readonly<Record<UnresolvedSurfaceKind, string>> = {
  'new-surface':
    'Nothing in the index provides it, and the surrounding surfaces are indexed — plan it as new construction rather than as a change.',
  'external-dependency':
    'The requirement describes a system this repository calls rather than contains — confirm the contract outside this workspace.',
  'coverage-gap':
    'Repository coverage is incomplete here, so absence from the index is not evidence of absence from the system — index the missing area before deciding.',
  'terminology-mismatch':
    'Nothing matches the term, but similarly named artifacts exist — the specification and the repository may be using different words for the same thing.',
  'insufficient-evidence':
    'Nothing establishes which of these this is: new construction, an external system, an unindexed area, or a naming difference. Treat it as an open question, not as a decision.',
};

const CONFIDENCE: Readonly<Record<UnresolvedSurfaceKind, number>> = {
  'new-surface': 0.7,
  'external-dependency': 0.7,
  'coverage-gap': 0.8,
  'terminology-mismatch': 0.6,
  'insufficient-evidence': 0.3,
};

/** Every reading the evidence supports, strongest first. The first is taken; the rest stay open. */
const supportedKinds = (
  signals: UnresolvedSurfaceSignals,
  shape: ConceptShape,
): readonly UnresolvedSurfaceKind[] => {
  const supported: UnresolvedSurfaceKind[] = [];
  // Coverage first: when the index demonstrably does not reach the area, nothing else can be
  // concluded from absence, and treating a gap as new construction is how a plan gets built twice.
  if (signals.withinCoverageGap) {
    supported.push('coverage-gap');
  }
  if (signals.referencesExternalBoundary) {
    supported.push('external-dependency');
  }
  // Creation language is a signal about the REQUIREMENT, not about this term, so on its own it is
  // not enough: a sentence saying "add X" mentions plenty of nouns that are not X. It counts only
  // for a term the author wrote as a specific commitment — a route, a path, an identifier.
  if (shape !== 'term' && (signals.usesCreationLanguage || signals.siblingSurfaceIndexed)) {
    supported.push('new-surface');
  }
  if (signals.nearestExisting.length > 0) {
    supported.push('terminology-mismatch');
  }
  return supported;
};

/** Kinds a reader must keep in mind when nothing is better supported than anything else. */
const OPEN_READINGS: readonly UnresolvedSurfaceKind[] = UNRESOLVED_SURFACE_KINDS.filter(
  (kind) => kind !== 'insufficient-evidence',
);

const MAX_NEAREST = 5;

export const classifyUnresolvedSurface = (signals: UnresolvedSurfaceSignals): UnresolvedSurface => {
  const shape = conceptShapeOf(signals.concept);
  const supported = supportedKinds(signals, shape);
  const kind = supported[0] ?? 'insufficient-evidence';
  return {
    concept: signals.concept,
    shape,
    kind,
    alternativeKinds: kind === 'insufficient-evidence' ? OPEN_READINGS : supported.slice(1),
    rationale: RATIONALE[kind],
    requirementIds: [...signals.requirementIds],
    nearestExisting: [...signals.nearestExisting].slice(0, MAX_NEAREST),
    confidence: CONFIDENCE[kind],
  };
};

/**
 * The reader-facing label. A route or path the repository does not provide is a commitment the
 * plan has to honour, so it is announced; a prose term that resolved to nothing is a question.
 */
export const unresolvedSurfaceLabel = (surface: UnresolvedSurface): string =>
  surface.kind === 'new-surface'
    ? `NEW / UNRESOLVED SURFACE: ${surface.concept}`
    : `UNRESOLVED: ${surface.concept} (${surface.kind})`;

/**
 * Surfaces that belong in the PRIMARY output. A route, a path, or an identifier the author wrote
 * is a specific commitment; an ordinary prose term that resolved to nothing is vocabulary, and
 * promoting every one of those would recreate the noise this whole change exists to remove.
 * Everything stays in the full list either way.
 */
export const isPrimarySurface = (surface: UnresolvedSurface): boolean =>
  surface.shape !== 'term' || surface.kind === 'new-surface' || surface.kind === 'coverage-gap';
