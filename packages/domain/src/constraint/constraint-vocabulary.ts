/**
 * The constraint vocabulary — repository rules modelled as first-class entities.
 *
 * A repository invariant is not a dependency. `ci/scripts/check-service-peer-http.py` does not
 * *depend on* the services it governs; it FORBIDS a relationship between them, with named
 * exemptions, at a stated severity. Flattening that into a generic edge loses every part of it that
 * a planner needs, which is why the relations below are their own closed vocabulary.
 */

/** What sort of rule a constraint expresses. */
export const CONSTRAINT_KINDS = [
  /** A dependency or import that must not exist between two scopes. */
  'forbidden-dependency',
  /** A call made at runtime — peer HTTP, queue publish — that must not exist between two scopes. */
  'forbidden-runtime-call',
  /** Changing X obliges changing Y (a contract and its generated client, a schema and a migration). */
  'required-accompanying-change',
  /** A scope may not run without a named configuration value being present. */
  'required-config',
  /** A scope may not run without a named runtime resource being present. */
  'required-runtime',
  /** A layering rule: this scope may only be reached from, or may only reach, those scopes. */
  'boundary-restriction',
  /** A check that must pass over a scope, whose internal rule is understood. */
  'must-pass-check',
  /**
   * A check that must pass over a scope, whose internal rule was NOT extracted. Indexed anyway:
   * "there is a guard here and we cannot read it" is a finding, and silence is not.
   */
  'opaque-check',
] as const;

export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export const isConstraintKind = (value: unknown): value is ConstraintKind =>
  typeof value === 'string' && (CONSTRAINT_KINDS as readonly string[]).includes(value);

/**
 * The relation a constraint asserts over its subjects. Direction is normative:
 * ONLY_ALLOWED_FROM points from the governed scope to the scopes permitted to reach it.
 */
export const CONSTRAINT_RELATIONS = [
  'FORBIDS',
  'REQUIRES',
  'ONLY_ALLOWED_FROM',
  'ONLY_ALLOWED_TO',
  'MUST_PASS',
  'RESTRICTS_DEPENDENCY',
  'REQUIRES_CONFIG',
  'REQUIRES_RUNTIME',
  'OWNS',
  'EXEMPTS',
] as const;

export type ConstraintRelation = (typeof CONSTRAINT_RELATIONS)[number];

export const isConstraintRelation = (value: unknown): value is ConstraintRelation =>
  typeof value === 'string' && (CONSTRAINT_RELATIONS as readonly string[]).includes(value);

export const CONSTRAINT_SEVERITIES = ['blocking', 'warning', 'advisory'] as const;
export type ConstraintSeverity = (typeof CONSTRAINT_SEVERITIES)[number];

/**
 * How the constraint's semantics were arrived at. This is the field that decides whether a
 * constraint may stop a plan.
 *
 * `recognized` — a deterministic extractor matched a guard shape it understands.
 * `declared`   — a human wrote it in `.impactgraph/constraints.yml`.
 * `ai-proposed`— a model read a guard and described a rule. Never authoritative.
 * `opaque`     — a guard exists and its rule was not extracted.
 */
export const CONSTRAINT_EXTRACTIONS = ['recognized', 'declared', 'ai-proposed', 'opaque'] as const;
export type ConstraintExtraction = (typeof CONSTRAINT_EXTRACTIONS)[number];

/**
 * Extractions whose constraints may produce a BLOCKING finding.
 *
 * This is the enforcement point for "no fabricated blocking findings". A model's reading of a shell
 * script, and a guard nobody could parse, are both real information — but neither may stop a plan
 * on its own, because neither can be shown to a reviewer as proof.
 */
export const AUTHORITATIVE_EXTRACTIONS: readonly ConstraintExtraction[] = ['recognized', 'declared'];

export const canBlock = (extraction: ConstraintExtraction): boolean =>
  AUTHORITATIVE_EXTRACTIONS.includes(extraction);

/** The severity an extraction permits: non-authoritative extractions are capped at `warning`. */
export const cappedSeverity = (
  proposed: ConstraintSeverity,
  extraction: ConstraintExtraction,
): ConstraintSeverity =>
  proposed === 'blocking' && !canBlock(extraction) ? 'warning' : proposed;
