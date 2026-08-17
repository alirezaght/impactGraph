import {
  createNextSpecificationVersion,
  createSpecification,
  isProvisional,
  isStructuredOrigin,
  ok,
  originOf,
  REQUIREMENT_ORIGINS,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_TYPES,
  specNoteId,
  stableContentId,
  stableRequirementId,
  strategyFor,
} from '@impactgraph/domain';

import { fallbackExtraction } from './fallback-extractor.js';

import type {
  ExtractedNoteDraft,
  ExtractedQuestionDraft,
  ExtractedRequirementDraft,
  SpecificationExtraction,
  SpecificationExtractionPort,
} from './extraction-types.js';
import type { ClockPort } from '../ports/clock.js';
import type { ModelProviderError } from '../ports/model-provider.js';
import type {
  ExtractionQuality,
  OpenQuestion,
  OpenQuestionSeverity,
  Requirement,
  RequirementOrigin,
  RequirementPriority,
  RequirementType,
  Result,
  Specification,
  SpecificationSourceType,
  SpecNote,
  ValidationError,
} from '@impactgraph/domain';

export interface ExtractSpecificationRequest {
  readonly specificationId: string;
  readonly title: string;
  readonly rawText: string;
  readonly sourceType: SpecificationSourceType;
  readonly sourceReference?: string;
  /** Re-extraction appends a new version to this spec; ids stay stable by statement. */
  readonly previousVersion?: Specification;
}

export interface ExtractSpecificationDeps {
  readonly clock: ClockPort;
  /** Absent in deterministic-only mode (PRD §8). */
  readonly extractor?: SpecificationExtractionPort;
}

export interface ExtractSpecificationOutcome {
  readonly specification: Specification;
  readonly extractionMode: 'provider' | 'deterministic-fallback';
  /** Present when a configured provider failed and the fallback took over (PRD §34). */
  readonly providerError?: ModelProviderError;
}

/**
 * Vocabulary coercion for provider-supplied drafts. Anything outside a closed vocabulary falls back
 * to the WEAKEST legal value — never a strong one — so a provider typo cannot inflate a claim.
 */
const coerce = (draft: ExtractedRequirementDraft) => ({
  type: (REQUIREMENT_TYPES as readonly string[]).includes(draft.type)
    ? (draft.type as RequirementType)
    : ('functional' as const),
  priority:
    draft.priority !== undefined &&
    (REQUIREMENT_PRIORITIES as readonly string[]).includes(draft.priority)
      ? (draft.priority as RequirementPriority)
      : undefined,
  origin:
    draft.origin !== undefined && (REQUIREMENT_ORIGINS as readonly string[]).includes(draft.origin)
      ? draft.origin
      : ('prose-fallback' as RequirementOrigin),
});

/** In [0, 1] or absent — an out-of-range value is dropped, never clamped into a stronger claim. */
const confidenceOf = (
  draft: ExtractedRequirementDraft,
): Partial<Pick<Requirement, 'extractionConfidence'>> => {
  const value = draft.extractionConfidence;
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1
    ? { extractionConfidence: value }
    : {};
};

const toRequirement = (draft: ExtractedRequirementDraft, rawText: string): Requirement => {
  const { type, priority, origin } = coerce(draft);
  const offset = draft.sourceExcerpt === undefined ? -1 : rawText.indexOf(draft.sourceExcerpt);
  return {
    id: stableRequirementId(draft.statement),
    statement: draft.statement,
    type,
    concepts: draft.concepts,
    actors: draft.actors,
    ...(priority === undefined ? {} : { priority }),
    ...(offset < 0 || draft.sourceExcerpt === undefined
      ? {}
      : { sourceRange: { startOffset: offset, endOffset: offset + draft.sourceExcerpt.length } }),
    status: 'draft',
    origin,
    ...(draft.label === undefined ? {} : { label: draft.label }),
    ...(draft.heading === undefined ? {} : { heading: draft.heading }),
    ...confidenceOf(draft),
  };
};

const toNote = (draft: ExtractedNoteDraft, rawText: string): SpecNote => {
  const offset = rawText.indexOf(draft.statement);
  return {
    id: specNoteId(draft.kind, draft.statement),
    kind: draft.kind,
    statement: draft.statement,
    ...(draft.heading === undefined ? {} : { heading: draft.heading }),
    ...(offset < 0
      ? {}
      : { sourceRange: { startOffset: offset, endOffset: offset + draft.statement.length } }),
  };
};

/**
 * A provider that returns no quality report still gets one, derived from what its drafts say about
 * themselves. Absent is never read as "good": drafts with no origin count as prose, which makes
 * the extraction provisional — the same treatment the deterministic fallback gets.
 */
const qualityOf = (
  extraction: SpecificationExtraction,
  requirements: readonly Requirement[],
): ExtractionQuality => {
  if (extraction.quality !== undefined) {
    return extraction.quality;
  }
  const structured = requirements.filter((requirement) =>
    isStructuredOrigin(originOf(requirement)),
  ).length;
  const modal = requirements.filter(
    (requirement) => originOf(requirement) === 'prose-modal',
  ).length;
  // Origin-less drafts coerce to prose-fallback — the weakest reading, counted as uncertain so a
  // provider cannot dodge provisionality by omission.
  const fallback = requirements.length - structured - modal;
  return {
    strategy: strategyFor(structured, modal, fallback),
    structuredRequirementCount: structured,
    proseRequirementCount: modal + fallback,
    recognizedSections: [],
    provisional: isProvisional(structured, modal, fallback),
    warnings:
      structured === 0 && fallback === requirements.length && requirements.length > 0
        ? [
            'The extraction provider reported no requirement origins, so no requirement can be ' +
              'traced to an explicit statement in the specification — the analysis is provisional.',
          ]
        : [],
  };
};

const toQuestion = (
  draft: ExtractedQuestionDraft,
  requirementIds: ReadonlySet<string>,
): OpenQuestion => {
  const severity: OpenQuestionSeverity =
    draft.severity === 'blocking' || draft.severity === 'minor' ? draft.severity : 'important';
  return {
    id: stableContentId('oq', draft.question),
    question: draft.question,
    reason: draft.reason,
    affectedRequirementIds: draft.affectedRequirementStatements
      .map((statement) => stableRequirementId(statement))
      .filter((id) => requirementIds.has(id)),
    severity,
    status: 'open',
  };
};

const dedupeById = <T extends { id: string }>(records: readonly T[]): T[] => {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) {
      return false;
    }
    seen.add(record.id);
    return true;
  });
};

const buildSpecification = (
  request: ExtractSpecificationRequest,
  extraction: SpecificationExtraction,
  now: string,
): Result<Specification, ValidationError> => {
  const requirements = dedupeById(
    extraction.requirements.map((draft) => toRequirement(draft, request.rawText)),
  );
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const actorNames = new Set([
    ...extraction.actors,
    ...requirements.flatMap((requirement) => requirement.actors),
  ]);
  const content = {
    title: request.title,
    rawText: request.rawText,
    requirements,
    actors: [...actorNames].sort().map((name) => ({ id: stableContentId('actor', name), name })),
    constraints: dedupeById(
      extraction.constraints.map((statement) => ({
        id: stableContentId('con', statement),
        statement,
      })),
    ),
    openQuestions: dedupeById(
      extraction.openQuestions.map((draft) => toQuestion(draft, requirementIds)),
    ),
    decisions: request.previousVersion?.decisions ?? [],
    ...(extraction.notes === undefined
      ? {}
      : { notes: dedupeById(extraction.notes.map((draft) => toNote(draft, request.rawText))) }),
    extractionQuality: qualityOf(extraction, requirements),
  };
  if (request.previousVersion !== undefined) {
    return createNextSpecificationVersion(request.previousVersion, content, now);
  }
  return createSpecification({
    id: request.specificationId,
    sourceType: request.sourceType,
    ...(request.sourceReference === undefined ? {} : { sourceReference: request.sourceReference }),
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...content,
  });
};

/**
 * Turn raw specification text into a versioned Specification (PRD §11, §40.2). Uses the
 * extraction port when configured; degrades to the deterministic fallback on absence or any
 * provider failure — AI failure never breaks specification management (PRD §8, §34).
 */
export const extractSpecification = async (
  request: ExtractSpecificationRequest,
  deps: ExtractSpecificationDeps,
): Promise<Result<ExtractSpecificationOutcome, ValidationError>> => {
  const now = deps.clock.now();
  let extraction: SpecificationExtraction | undefined;
  let providerError: ModelProviderError | undefined;
  if (deps.extractor !== undefined) {
    const extracted = await deps.extractor.extract({
      title: request.title,
      rawText: request.rawText,
    });
    if (extracted.ok) {
      extraction = extracted.value;
    } else {
      providerError = extracted.error;
    }
  }
  const mode = extraction === undefined ? 'deterministic-fallback' : 'provider';
  const specification = buildSpecification(
    request,
    extraction ?? fallbackExtraction(request.rawText),
    now,
  );
  if (!specification.ok) {
    return specification;
  }
  return ok({
    specification: specification.value,
    extractionMode: mode,
    ...(providerError === undefined ? {} : { providerError }),
  });
};
