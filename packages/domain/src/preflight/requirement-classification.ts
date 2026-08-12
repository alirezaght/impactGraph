/**
 * Why a requirement matched no component.
 *
 * "Unmatched" was the single most useful output of the trials and simultaneously the least
 * actionable, because six different situations were reported identically. A requirement that
 * creates a new route and a requirement that depends on an unindexed repository both came back as
 * "no impact", and they call for opposite decisions: build it, versus go and index the other repo
 * before deciding anything.
 */
export const UNMATCHED_REQUIREMENT_CLASSES = [
  /** Nothing matches because the requirement creates surface that does not exist yet. */
  'NEW_SURFACE',
  /** The relevant code exists but is outside the indexed scope. Nothing can be concluded. */
  'COVERAGE_GAP',
  /** The requirement names something that should exist and does not. */
  'INVALID_ASSUMPTION',
  /** The requirement is readable more than one way, and the readings differ in what they touch. */
  'AMBIGUOUS',
  /** Indexed, unambiguous, creates nothing new — and still nothing was found. */
  'NO_EVIDENCE',
  /** Satisfied outside this repository entirely: a third-party service, another team's system. */
  'EXTERNAL_DEPENDENCY',
] as const;

export type UnmatchedRequirementClass = (typeof UNMATCHED_REQUIREMENT_CLASSES)[number];

export const isUnmatchedRequirementClass = (
  value: unknown,
): value is UnmatchedRequirementClass =>
  typeof value === 'string' && (UNMATCHED_REQUIREMENT_CLASSES as readonly string[]).includes(value);

/** The observations a classifier is allowed to use. All deterministic, all supplied by the caller. */
export interface ClassificationSignals {
  /** The requirement names an identifier that resolves to nothing indexed. */
  readonly hasInvalidSymbolAssumption: boolean;
  /** The requirement's concepts fall inside a repository that is registered but not indexed. */
  readonly touchesUnindexedRepository: boolean;
  /** The requirement's concepts fall inside a directory the index skipped. */
  readonly touchesIndexingGap: boolean;
  /** The requirement uses a creation verb — add, create, introduce, new. */
  readonly usesCreationLanguage: boolean;
  /** The requirement's concepts resolve to an external service or third-party boundary. */
  readonly referencesExternalBoundary: boolean;
  /** A concept matched too many unrelated components to anchor. */
  readonly hasAmbiguousConcept: boolean;
  /**
   * The kind of surface the requirement describes resolved to nothing, but sibling surface of the
   * same kind IS indexed — e.g. no matching locale key, but locale bundles are indexed. Strong
   * evidence of new surface rather than missing coverage.
   */
  readonly siblingSurfaceIndexed: boolean;
}

export interface RequirementClassification {
  readonly requirementId: string;
  readonly classification: UnmatchedRequirementClass;
  /** Why this class and not another, in one sentence. */
  readonly rationale: string;
  /** 0..1. Lower when the classifier is choosing between two plausible readings. */
  readonly confidence: number;
}

/**
 * Order matters and is not arbitrary.
 *
 * Coverage questions come FIRST: if the relevant code was never indexed, every downstream reading —
 * "this is new", "this symbol does not exist" — is unfounded, because absence proves nothing over a
 * scope that was not searched. Refusing to classify beyond that is the honest answer, and it is the
 * behaviour the trials got right and must keep.
 *
 * An invalid assumption then outranks new surface: the specification asserted something exists, and
 * a false assertion is a defect in the plan, whereas new surface is not.
 */
export const classifyUnmatchedRequirement = (
  requirementId: string,
  signals: ClassificationSignals,
): RequirementClassification => {
  const classify = (
    classification: UnmatchedRequirementClass,
    rationale: string,
    confidence: number,
  ): RequirementClassification => ({ requirementId, classification, rationale, confidence });

  if (signals.touchesUnindexedRepository) {
    return classify(
      'COVERAGE_GAP',
      'the requirement concerns a repository that is registered but not indexed, so absence of a match proves nothing',
      0.9,
    );
  }
  if (signals.touchesIndexingGap) {
    return classify(
      'COVERAGE_GAP',
      'the requirement concerns files the index skipped, so absence of a match proves nothing',
      0.75,
    );
  }
  if (signals.referencesExternalBoundary) {
    return classify(
      'EXTERNAL_DEPENDENCY',
      'the requirement is satisfied by a system outside this repository',
      0.7,
    );
  }
  if (signals.hasInvalidSymbolAssumption) {
    return classify(
      'INVALID_ASSUMPTION',
      'the requirement names an identifier that does not exist at the indexed revision',
      0.85,
    );
  }
  if (signals.hasAmbiguousConcept) {
    return classify(
      'AMBIGUOUS',
      'the requirement reads more than one way and the readings touch different components',
      0.6,
    );
  }
  if (signals.usesCreationLanguage && signals.siblingSurfaceIndexed) {
    return classify(
      'NEW_SURFACE',
      'the requirement creates surface of a kind this repository already indexes, and no instance of it exists yet',
      0.85,
    );
  }
  if (signals.usesCreationLanguage) {
    return classify(
      'NEW_SURFACE',
      'the requirement describes something to be created rather than something to be changed',
      0.65,
    );
  }
  return classify(
    'NO_EVIDENCE',
    'the area is indexed and the requirement is unambiguous, yet nothing in the graph answers it',
    0.5,
  );
};
