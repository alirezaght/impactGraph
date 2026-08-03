import {
  createNextSpecificationVersion,
  createSpecification,
  ok,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_TYPES,
  stableContentId,
  stableRequirementId,
} from '@impactgraph/domain';

import { fallbackExtraction } from './fallback-extractor.js';

import type {
  ExtractedQuestionDraft,
  ExtractedRequirementDraft,
  SpecificationExtraction,
  SpecificationExtractionPort,
} from './extraction-types.js';
import type { ClockPort } from '../ports/clock.js';
import type { ModelProviderError } from '../ports/model-provider.js';
import type {
  OpenQuestion,
  OpenQuestionSeverity,
  Requirement,
  RequirementPriority,
  RequirementType,
  Result,
  Specification,
  SpecificationSourceType,
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

const toRequirement = (draft: ExtractedRequirementDraft, rawText: string): Requirement => {
  const type = (REQUIREMENT_TYPES as readonly string[]).includes(draft.type)
    ? (draft.type as RequirementType)
    : 'functional';
  const priority =
    draft.priority !== undefined &&
    (REQUIREMENT_PRIORITIES as readonly string[]).includes(draft.priority)
      ? (draft.priority as RequirementPriority)
      : undefined;
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
