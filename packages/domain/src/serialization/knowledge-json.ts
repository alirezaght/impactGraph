import { validationIssue } from '../errors/validation.js';

import {
  isRawObject,
  readArray,
  readNumber,
  readObject,
  readOptionalObject,
  readOptionalString,
  readString,
  readStringArray,
} from './parse-helpers.js';

import type { RawObject } from './parse-helpers.js';
import type { ValidationIssue } from '../errors/validation.js';
import type { ConfidenceSignalInput } from '../provenance/confidence.js';
import type {
  KnowledgeEnvelope,
  KnowledgeEnvelopeInput,
} from '../provenance/knowledge-envelope.js';

export interface ConfidenceSignalJson {
  readonly type: string;
  readonly contribution: number;
  readonly description?: string;
}

export interface ConfidenceJson {
  readonly value: number;
  readonly signals: readonly ConfidenceSignalJson[];
}

export interface SpecificationRefJson {
  readonly specificationId: string;
  readonly specificationVersion: number;
}

export interface KnowledgeEnvelopeJson {
  readonly provenance: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: ConfidenceJson;
  readonly createdAt: string;
  readonly repositorySnapshotId: string;
  readonly analysisRunId: string;
  readonly specification?: SpecificationRefJson;
}

// A KnowledgeEnvelope is plain, JSON-safe, frozen data; its serialized shape is the same
// structure with the ID brands erased. One source of shape, no copying.
export const serializeKnowledgeEnvelope = (envelope: KnowledgeEnvelope): KnowledgeEnvelopeJson =>
  envelope;

const readSignal = (
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): ConfidenceSignalInput => {
  if (!isRawObject(raw)) {
    issues.push(validationIssue('invalid-type', path, `${path} must be an object`));
    return { type: '', contribution: Number.NaN };
  }
  const base = {
    type: readString(raw, 'type', `${path}.type`, issues),
    contribution: readNumber(raw, 'contribution', `${path}.contribution`, issues),
  };
  const description = readOptionalString(raw, 'description', `${path}.description`, issues);
  return description === undefined ? base : { ...base, description };
};

export const readKnowledgeEnvelopeInput = (
  obj: RawObject,
  path: string,
  issues: ValidationIssue[],
): KnowledgeEnvelopeInput => {
  const confidenceObj = readObject(obj, 'confidence', `${path}.confidence`, issues);
  const signalsPath = `${path}.confidence.signals`;
  const signals = readArray(confidenceObj, 'signals', signalsPath, issues).map((raw, index) =>
    readSignal(raw, `${signalsPath}[${index}]`, issues),
  );
  const base = {
    provenance: readString(obj, 'provenance', `${path}.provenance`, issues),
    evidenceIds: readStringArray(obj, 'evidenceIds', `${path}.evidenceIds`, issues),
    confidence: {
      value: readNumber(confidenceObj, 'value', `${path}.confidence.value`, issues),
      signals,
    },
    createdAt: readString(obj, 'createdAt', `${path}.createdAt`, issues),
    repositorySnapshotId: readString(
      obj,
      'repositorySnapshotId',
      `${path}.repositorySnapshotId`,
      issues,
    ),
    analysisRunId: readString(obj, 'analysisRunId', `${path}.analysisRunId`, issues),
  };
  const specObj = readOptionalObject(obj, 'specification', `${path}.specification`, issues);
  if (specObj === undefined) {
    return base;
  }
  return {
    ...base,
    specification: {
      specificationId: readString(
        specObj,
        'specificationId',
        `${path}.specification.specificationId`,
        issues,
      ),
      specificationVersion: readNumber(
        specObj,
        'specificationVersion',
        `${path}.specification.specificationVersion`,
        issues,
      ),
    },
  };
};
