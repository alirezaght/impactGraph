import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { createImpactAnalysis } from '../impact/impact-analysis.js';

import {
  checkSchemaVersion,
  isRawObject,
  readArray,
  readNumber,
  readOptionalString,
  readString,
  readStringArray,
} from './parse-helpers.js';
import { readProposedStructure } from './proposed-structure-json.js';

import type { RawObject } from './parse-helpers.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { ImpactEvidenceType } from '../impact/evidence-basis.js';
import type {
  AnalysisWarning,
  ArchitecturalOption,
  ChangeExpectation,
  OptionImplications,
  ImpactAnalysis,
  RequirementImpact,
  UserImpactDecision,
} from '../impact/impact-analysis.js';
import type { PlanningRole, PlanningRoleRule } from '../impact/planning-role.js';
import type { UnresolvedSurface, UnresolvedSurfaceKind } from '../impact/unresolved-surface.js';
import type { EvidenceProvenance } from '../preflight/evidence-provenance.js';
import type { ConfidenceSignal } from '../provenance/confidence.js';

export const IMPACT_ANALYSIS_SCHEMA_VERSION = 1;

export interface ImpactAnalysisJson extends ImpactAnalysis {
  readonly schemaVersion: number;
}

export const serializeImpactAnalysis = (analysis: ImpactAnalysis): ImpactAnalysisJson => ({
  schemaVersion: IMPACT_ANALYSIS_SCHEMA_VERSION,
  ...analysis,
});

type Reader<T> = (raw: unknown, path: string, issues: ValidationIssue[]) => T;

const expectObject = (raw: unknown, path: string, issues: ValidationIssue[]): RawObject => {
  if (isRawObject(raw)) {
    return raw;
  }
  issues.push(validationIssue('invalid-type', path, `${path} must be an object`));
  return {};
};

const readEach = <T>(
  raws: readonly unknown[],
  path: string,
  issues: ValidationIssue[],
  reader: Reader<T>,
): T[] => raws.map((raw, index) => reader(raw, `${path}[${index}]`, issues));

const readSignal: Reader<ConfidenceSignal> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const description = readOptionalString(obj, 'description', `${path}.description`, issues);
  return {
    type: readString(obj, 'type', `${path}.type`, issues) as ConfidenceSignal['type'],
    contribution: readNumber(obj, 'contribution', `${path}.contribution`, issues),
    ...(description === undefined ? {} : { description }),
  };
};

/**
 * The additive impact fields, all absent on analyses stored before their axis existed. Left absent
 * rather than defaulted so `evidenceTypesOf` / `evidenceProvenanceOf` own the one place that
 * decides what absence means (weakest reading). Unknown values are rejected by
 * createImpactAnalysis, not read through.
 */
const readAdditiveImpactFields = (
  obj: RawObject,
  path: string,
  issues: ValidationIssue[],
): Partial<RequirementImpact> => {
  const cappedBy = readOptionalString(obj, 'tierCappedBy', `${path}.tierCappedBy`, issues);
  const evidenceProvenance = readOptionalString(
    obj,
    'evidenceProvenance',
    `${path}.evidenceProvenance`,
    issues,
  );
  const changeExpectation = readOptionalString(
    obj,
    'changeExpectation',
    `${path}.changeExpectation`,
    issues,
  );
  const planningRole = readOptionalString(obj, 'planningRole', `${path}.planningRole`, issues);
  const planningRoleRule = readOptionalString(
    obj,
    'planningRoleRule',
    `${path}.planningRoleRule`,
    issues,
  );
  const planningRoleReason = readOptionalString(
    obj,
    'planningRoleReason',
    `${path}.planningRoleReason`,
    issues,
  );
  return {
    ...(obj['evidenceTypes'] === undefined
      ? {}
      : {
          evidenceTypes: readStringArray(
            obj,
            'evidenceTypes',
            `${path}.evidenceTypes`,
            issues,
          ) as readonly ImpactEvidenceType[],
        }),
    ...(cappedBy === undefined ? {} : { tierCappedBy: cappedBy as ImpactEvidenceType }),
    ...(evidenceProvenance === undefined
      ? {}
      : { evidenceProvenance: evidenceProvenance as EvidenceProvenance }),
    ...(changeExpectation === undefined
      ? {}
      : { changeExpectation: changeExpectation as ChangeExpectation }),
    ...(planningRole === undefined ? {} : { planningRole: planningRole as PlanningRole }),
    ...(planningRoleRule === undefined
      ? {}
      : { planningRoleRule: planningRoleRule as PlanningRoleRule }),
    ...(planningRoleReason === undefined ? {} : { planningRoleReason }),
  };
};

const readImpact: Reader<RequirementImpact> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  return {
    requirementId: readString(obj, 'requirementId', `${path}.requirementId`, issues),
    nodeId: readString(obj, 'nodeId', `${path}.nodeId`, issues),
    likelihood: readString(
      obj,
      'likelihood',
      `${path}.likelihood`,
      issues,
    ) as RequirementImpact['likelihood'],
    impactType: readString(
      obj,
      'impactType',
      `${path}.impactType`,
      issues,
    ) as RequirementImpact['impactType'],
    directness: readString(
      obj,
      'directness',
      `${path}.directness`,
      issues,
    ) as RequirementImpact['directness'],
    confidence: readNumber(obj, 'confidence', `${path}.confidence`, issues),
    confidenceSignals: readEach(
      readArray(obj, 'confidenceSignals', `${path}.confidenceSignals`, issues),
      `${path}.confidenceSignals`,
      issues,
      readSignal,
    ),
    explanation: readString(obj, 'explanation', `${path}.explanation`, issues),
    expectedChanges: readStringArray(obj, 'expectedChanges', `${path}.expectedChanges`, issues),
    evidenceIds: readStringArray(obj, 'evidenceIds', `${path}.evidenceIds`, issues),
    dependencyPath: readStringArray(obj, 'dependencyPath', `${path}.dependencyPath`, issues),
    provenance: readString(
      obj,
      'provenance',
      `${path}.provenance`,
      issues,
    ) as RequirementImpact['provenance'],
    ...readAdditiveImpactFields(obj, path, issues),
  };
};

const readWarning: Reader<AnalysisWarning> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const requirementId = readOptionalString(obj, 'requirementId', `${path}.requirementId`, issues);
  return {
    code: readString(obj, 'code', `${path}.code`, issues) as AnalysisWarning['code'],
    message: readString(obj, 'message', `${path}.message`, issues),
    ...(requirementId === undefined ? {} : { requirementId }),
  };
};

const readDecision: Reader<UserImpactDecision> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const reason = readOptionalString(obj, 'reason', `${path}.reason`, issues);
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    requirementId: readString(obj, 'requirementId', `${path}.requirementId`, issues),
    nodeId: readString(obj, 'nodeId', `${path}.nodeId`, issues),
    decision: readString(
      obj,
      'decision',
      `${path}.decision`,
      issues,
    ) as UserImpactDecision['decision'],
    ...(reason === undefined ? {} : { reason }),
    decidedAt: readString(obj, 'decidedAt', `${path}.decidedAt`, issues),
  };
};

const readImplications = (
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): OptionImplications | undefined => {
  if (!isRawObject(raw)) {
    return undefined;
  }
  return {
    affectedComponentCount: readNumber(raw, 'affectedComponentCount', `${path}.count`, issues),
    dataChanges: readStringArray(raw, 'dataChanges', `${path}.dataChanges`, issues),
    contractChanges: readStringArray(raw, 'contractChanges', `${path}.contractChanges`, issues),
    infrastructureChanges: readStringArray(raw, 'infrastructureChanges', `${path}.infra`, issues),
    testingImpact: readStringArray(raw, 'testingImpact', `${path}.testingImpact`, issues),
    complexity: readString(
      raw,
      'complexity',
      `${path}.complexity`,
      issues,
    ) as OptionImplications['complexity'],
    risks: readStringArray(raw, 'risks', `${path}.risks`, issues),
  };
};

const readOption: Reader<ArchitecturalOption> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  const linkedQuestionId = readOptionalString(
    obj,
    'linkedQuestionId',
    `${path}.linkedQuestionId`,
    issues,
  );
  const implications = readImplications(obj['implications'], `${path}.implications`, issues);
  return {
    id: readString(obj, 'id', `${path}.id`, issues),
    title: readString(obj, 'title', `${path}.title`, issues),
    description: readString(obj, 'description', `${path}.description`, issues),
    affectedNodeIds: readStringArray(obj, 'affectedNodeIds', `${path}.affectedNodeIds`, issues),
    ...(linkedQuestionId === undefined ? {} : { linkedQuestionId }),
    ...(implications === undefined ? {} : { implications }),
  };
};

/**
 * ADR-0025. Absent means the producer predates the axis — never "every concept resolved", which is
 * why an empty array is not written when there is nothing to report.
 */
const readSurface: Reader<UnresolvedSurface> = (raw, path, issues) => {
  const obj = expectObject(raw, path, issues);
  return {
    concept: readString(obj, 'concept', `${path}.concept`, issues),
    shape: readString(obj, 'shape', `${path}.shape`, issues) as UnresolvedSurface['shape'],
    kind: readString(obj, 'kind', `${path}.kind`, issues) as UnresolvedSurfaceKind,
    alternativeKinds: readStringArray(
      obj,
      'alternativeKinds',
      `${path}.alternativeKinds`,
      issues,
    ) as readonly UnresolvedSurfaceKind[],
    rationale: readString(obj, 'rationale', `${path}.rationale`, issues),
    requirementIds: readStringArray(obj, 'requirementIds', `${path}.requirementIds`, issues),
    nearestExisting: readStringArray(obj, 'nearestExisting', `${path}.nearestExisting`, issues),
    confidence: readNumber(obj, 'confidence', `${path}.confidence`, issues),
  };
};

const readUnresolvedSurfaces = (
  value: RawObject,
  issues: ValidationIssue[],
): Pick<ImpactAnalysis, 'unresolvedSurfaces'> | Record<string, never> =>
  value['unresolvedSurfaces'] === undefined
    ? {}
    : {
        unresolvedSurfaces: readEach(
          readArray(value, 'unresolvedSurfaces', 'unresolvedSurfaces', issues),
          'unresolvedSurfaces',
          issues,
          readSurface,
        ),
      };

export const parseImpactAnalysis = (value: unknown): Result<ImpactAnalysis, ValidationError> => {
  if (!isRawObject(value)) {
    return err(
      validationError([validationIssue('invalid-type', '', 'analysis JSON must be an object')]),
    );
  }
  const issues: ValidationIssue[] = [];
  checkSchemaVersion(value, IMPACT_ANALYSIS_SCHEMA_VERSION, issues);
  const proposedStructure = readProposedStructure(value, issues);
  const input: ImpactAnalysis = {
    id: readString(value, 'id', 'id', issues),
    specificationId: readString(value, 'specificationId', 'specificationId', issues),
    specificationVersion: readNumber(value, 'specificationVersion', 'specificationVersion', issues),
    repositorySnapshotId: readString(value, 'repositorySnapshotId', 'repositorySnapshotId', issues),
    createdAt: readString(value, 'createdAt', 'createdAt', issues),
    status: readString(value, 'status', 'status', issues) as ImpactAnalysis['status'],
    requirementImpacts: readEach(
      readArray(value, 'requirementImpacts', 'requirementImpacts', issues),
      'requirementImpacts',
      issues,
      readImpact,
    ),
    architecturalOptions: readEach(
      readArray(value, 'architecturalOptions', 'architecturalOptions', issues),
      'architecturalOptions',
      issues,
      readOption,
    ),
    warnings: readEach(
      readArray(value, 'warnings', 'warnings', issues),
      'warnings',
      issues,
      readWarning,
    ),
    userDecisions: readEach(
      readArray(value, 'userDecisions', 'userDecisions', issues),
      'userDecisions',
      issues,
      readDecision,
    ),
    ...(proposedStructure === undefined ? {} : { proposedStructure }),
    ...readUnresolvedSurfaces(value, issues),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createImpactAnalysis(input);
};
