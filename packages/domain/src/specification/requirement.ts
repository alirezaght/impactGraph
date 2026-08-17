import { validationIssue } from '../errors/validation.js';
import { blankIdIssue } from '../provenance/evidence.js';

import type { ValidationIssue } from '../errors/validation.js';

// PRD §11.1 — implemented as written.
export const REQUIREMENT_TYPES = [
  'functional',
  'business-rule',
  'exception',
  'state-transition',
  'data',
  'integration',
  'security',
  'performance',
  'operational',
  'observability',
  'testing',
  'documentation',
] as const;

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_PRIORITIES = ['must', 'should', 'could'] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const REQUIREMENT_STATUSES = ['draft', 'confirmed', 'rejected'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/**
 * Which DIRECTION a requirement points in.
 *
 * "Deduplication behaviour must remain unchanged" is a requirement — it is the author drawing a
 * REGRESSION BOUNDARY around the change — and no existing axis could carry it. `type` says what
 * subject matter, `priority` says how strongly, `origin` says where the statement came from,
 * `status` says whether a human confirmed it. Without `intent`, every one of those read the
 * sentence as a request to change the thing it protects: the exact inverse of what it says.
 *
 * A preservation requirement is NOT a non-goal. A non-goal removes a component from the analysis
 * (`excluded` likelihood; a change there is `unexpected`). A guard keeps it IN, expects it to be
 * exercised, and demands that the diff leave it alone.
 */
export const REQUIREMENT_INTENTS = ['change', 'preserve'] as const;
export type RequirementIntent = (typeof REQUIREMENT_INTENTS)[number];

/**
 * Where a requirement came from in the specification text.
 *
 * This is the honesty field. `explicit-label` means the author wrote "R3:" and the statement is
 * theirs verbatim; `prose-fallback` means no list existed and the extractor cut a sentence out of
 * running prose. Presenting those two as the same kind of object is how a specification with seven
 * numbered requirements turns into forty, and every count downstream inherits the error.
 */
export const REQUIREMENT_ORIGINS = [
  /** An author-assigned identifier: `R1`, `FR-3`, `REQ-12`. */
  'explicit-label',
  /** An item of a numbered list under a requirements-like heading. */
  'numbered-item',
  /** An item under Acceptance Criteria / Definition of Done. */
  'acceptance-criterion',
  /** A `- [ ]` task-list item. */
  'task-item',
  /** A plain bullet under a requirements-like heading. */
  'bullet-item',
  /**
   * A prose sentence the deterministic classifier admitted on normative modality (must/should/
   * shall/needs to) or an imperative head verb. The statement is the author's; the decision that
   * it is a requirement is the extractor's, which is why it carries an `extractionConfidence`.
   */
  'prose-modal',
  /** Cut out of running prose because the specification declared no requirements at all. */
  'prose-fallback',
] as const;

export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];

/** Origins whose statement text is the author's own requirement list, not an extractor guess. */
export const STRUCTURED_ORIGINS: readonly RequirementOrigin[] = [
  'explicit-label',
  'numbered-item',
  'acceptance-criterion',
  'task-item',
  'bullet-item',
];

export const isStructuredOrigin = (origin: RequirementOrigin): boolean =>
  STRUCTURED_ORIGINS.includes(origin);

/** Character-offset range into the specification's rawText (PRD §11.1 sourceRange). */
export interface TextRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface Requirement {
  readonly id: string;
  readonly statement: string;
  readonly type: RequirementType;
  readonly concepts: readonly string[];
  readonly actors: readonly string[];
  readonly priority?: RequirementPriority;
  readonly sourceRange?: TextRange;
  readonly status: RequirementStatus;
  /**
   * Additive field. Absent on specifications extracted before origins existed — read it through
   * `originOf` so the missing case is handled once, as `prose-fallback`, the weakest reading.
   */
  readonly origin?: RequirementOrigin;
  /** The author's own identifier when they gave one: `R3`, `AC2`, `FR-7`. */
  readonly label?: string;
  /** Heading the requirement was found under, verbatim. */
  readonly heading?: string;
  /**
   * How confident the EXTRACTOR is that this statement is a requirement at all, in [0, 1].
   * Additive; set only where admission was the extractor's decision (prose origins) — a statement
   * from the author's own list needs no such number. Never model-supplied: the value is derived
   * from the deterministic admission signal (modality strength, imperative head).
   */
  readonly extractionConfidence?: number;
  /**
   * Additive field. Absent on specifications extracted before the axis existed — read it through
   * `intentOf`, which maps absence to `change`, preserving the older reading exactly.
   */
  readonly intent?: RequirementIntent;
}

/** The weakest reading is the default: an unlabeled requirement is treated as extractor prose. */
export const originOf = (requirement: Requirement): RequirementOrigin =>
  requirement.origin ?? 'prose-fallback';

/** Absence means the pre-axis reading: the requirement asks for a change. */
export const intentOf = (requirement: Requirement): RequirementIntent =>
  requirement.intent ?? 'change';

/** Deterministic content-derived id: FNV-1a over normalized text, with a kind prefix. */
export const stableContentId = (prefix: string, text: string): string => {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
};

/**
 * Stable requirement identity: re-extracting an unchanged statement yields the same id, so
 * impacts and SATISFIES links survive re-extraction (specification skill).
 */
export const stableRequirementId = (statement: string): string => stableContentId('req', statement);

const rangeIssues = (range: TextRange | undefined, path: string): ValidationIssue[] => {
  if (range === undefined) {
    return [];
  }
  const valid =
    Number.isInteger(range.startOffset) &&
    Number.isInteger(range.endOffset) &&
    range.startOffset >= 0 &&
    range.endOffset >= range.startOffset;
  return valid
    ? []
    : [validationIssue('out-of-range', path, 'sourceRange offsets must be ordered and >= 0')];
};

const confidenceIssues = (confidence: number | undefined, path: string): ValidationIssue[] => {
  if (confidence === undefined) {
    return [];
  }
  const valid = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
  return valid
    ? []
    : [
        validationIssue(
          'out-of-range',
          `${path}.extractionConfidence`,
          'extractionConfidence must be within [0, 1]',
        ),
      ];
};

export const requirementIssues = (requirement: Requirement, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...blankIdIssue(requirement.id, `${path}.id`),
    ...rangeIssues(requirement.sourceRange, `${path}.sourceRange`),
  ];
  if (requirement.statement.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.statement`, 'statement must not be blank'));
  }
  if (!(REQUIREMENT_TYPES as readonly string[]).includes(requirement.type)) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.type`,
        `unknown requirement type '${requirement.type}'`,
      ),
    );
  }
  if (!(REQUIREMENT_STATUSES as readonly string[]).includes(requirement.status)) {
    issues.push(
      validationIssue('invalid-type', `${path}.status`, `unknown status '${requirement.status}'`),
    );
  }
  if (
    requirement.origin !== undefined &&
    !(REQUIREMENT_ORIGINS as readonly string[]).includes(requirement.origin)
  ) {
    issues.push(
      validationIssue('invalid-type', `${path}.origin`, `unknown origin '${requirement.origin}'`),
    );
  }
  if (
    requirement.intent !== undefined &&
    !(REQUIREMENT_INTENTS as readonly string[]).includes(requirement.intent)
  ) {
    issues.push(
      validationIssue('invalid-type', `${path}.intent`, `unknown intent '${requirement.intent}'`),
    );
  }
  issues.push(...confidenceIssues(requirement.extractionConfidence, path));
  if (
    requirement.priority !== undefined &&
    !(REQUIREMENT_PRIORITIES as readonly string[]).includes(requirement.priority)
  ) {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.priority`,
        `unknown priority '${requirement.priority}'`,
      ),
    );
  }
  return issues;
};
