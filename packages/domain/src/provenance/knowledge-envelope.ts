import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';

import { buildConfidenceScore, collectConfidenceIssues } from './confidence.js';
import { blankIdIssue, isValidTimestamp } from './evidence.js';
import { isProvenance, knowledgeCategoryOf } from './provenance.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { AnalysisRunId, EvidenceId, RepositorySnapshotId, SpecificationId } from '../ids.js';
import type { ConfidenceScore, ConfidenceScoreInput } from './confidence.js';
import type { Provenance } from './provenance.js';

export interface SpecificationRef {
  readonly specificationId: SpecificationId;
  readonly specificationVersion: number;
}

/**
 * The provenance envelope every knowledge record carries (main skill §3,
 * docs/engineering/provenance-model.md). `specification` is optional: deterministic records
 * produced by indexing exist before any specification does; intent/impact records require it.
 */
export interface KnowledgeEnvelope {
  readonly provenance: Provenance;
  readonly evidenceIds: readonly EvidenceId[];
  readonly confidence: ConfidenceScore;
  readonly createdAt: string;
  readonly repositorySnapshotId: RepositorySnapshotId;
  readonly analysisRunId: AnalysisRunId;
  readonly specification?: SpecificationRef;
}

export interface SpecificationRefInput {
  readonly specificationId: string;
  readonly specificationVersion: number;
}

export interface KnowledgeEnvelopeInput {
  readonly provenance: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: ConfidenceScoreInput;
  readonly createdAt: string;
  readonly repositorySnapshotId: string;
  readonly analysisRunId: string;
  readonly specification?: SpecificationRefInput;
}

const provenanceIssues = (input: KnowledgeEnvelopeInput, path: string): ValidationIssue[] => {
  if (!isProvenance(input.provenance)) {
    return [
      validationIssue(
        'unknown-provenance',
        `${path}.provenance`,
        `unknown provenance '${input.provenance}' (PRD §12.3)`,
      ),
    ];
  }
  if (knowledgeCategoryOf(input.provenance) === 'reserved') {
    return [
      validationIssue(
        'reserved-provenance',
        `${path}.provenance`,
        `'${input.provenance}' is reserved — no V1 code path may produce it`,
      ),
    ];
  }
  if (input.provenance !== 'human-confirmed' && input.evidenceIds.length === 0) {
    return [
      validationIssue(
        'missing-evidence',
        `${path}.evidenceIds`,
        `'${input.provenance}' records require at least one evidence ID`,
      ),
    ];
  }
  return [];
};

const specificationIssues = (
  specification: SpecificationRefInput | undefined,
  path: string,
): ValidationIssue[] => {
  if (specification === undefined) {
    return [];
  }
  const issues = blankIdIssue(specification.specificationId, `${path}.specificationId`);
  if (
    !Number.isInteger(specification.specificationVersion) ||
    specification.specificationVersion < 1
  ) {
    issues.push(
      validationIssue(
        'out-of-range',
        `${path}.specificationVersion`,
        'specificationVersion must be a positive integer',
      ),
    );
  }
  return issues;
};

export const collectEnvelopeIssues = (
  input: KnowledgeEnvelopeInput,
  path: string,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [
    ...provenanceIssues(input, path),
    ...blankIdIssue(input.repositorySnapshotId, `${path}.repositorySnapshotId`),
    ...blankIdIssue(input.analysisRunId, `${path}.analysisRunId`),
    ...collectConfidenceIssues(input.confidence, `${path}.confidence`),
    ...specificationIssues(input.specification, `${path}.specification`),
  ];
  input.evidenceIds.forEach((id, index) => {
    issues.push(...blankIdIssue(id, `${path}.evidenceIds[${index}]`));
  });
  if (!isValidTimestamp(input.createdAt)) {
    issues.push(
      validationIssue(
        'invalid-timestamp',
        `${path}.createdAt`,
        'createdAt must be an ISO-8601 timestamp (clock port)',
      ),
    );
  }
  return issues;
};

/** Assumes the input already passed collectEnvelopeIssues. */
export const buildKnowledgeEnvelope = (input: KnowledgeEnvelopeInput): KnowledgeEnvelope => {
  const base = {
    provenance: input.provenance as Provenance,
    evidenceIds: input.evidenceIds.map((id) => id as EvidenceId),
    confidence: buildConfidenceScore(input.confidence),
    createdAt: input.createdAt,
    repositorySnapshotId: input.repositorySnapshotId as RepositorySnapshotId,
    analysisRunId: input.analysisRunId as AnalysisRunId,
  };
  const envelope =
    input.specification === undefined
      ? base
      : {
          ...base,
          specification: {
            specificationId: input.specification.specificationId as SpecificationId,
            specificationVersion: input.specification.specificationVersion,
          },
        };
  return deepFreeze(envelope);
};

export const createKnowledgeEnvelope = (
  input: KnowledgeEnvelopeInput,
): Result<KnowledgeEnvelope, ValidationError> => {
  const issues = collectEnvelopeIssues(input, 'knowledge');
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(buildKnowledgeEnvelope(input));
};
