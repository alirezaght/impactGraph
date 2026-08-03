import {
  isRawObject,
  readArray,
  readNumber,
  readOptionalObject,
  readString,
  readStringArray,
} from './parse-helpers.js';

import type { RawObject } from './parse-helpers.js';
import type { ValidationIssue } from '../errors/validation.js';
import type {
  ProposedEndpointKind,
  ProposedNode,
  ProposedRelationship,
  ProposedStructure,
} from '../impact/proposed-structure.js';
import type { ConfidenceSignal } from '../provenance/confidence.js';
import type { Provenance } from '../provenance/provenance.js';
import type { EdgeType } from '../repository/edge-types.js';
import type { NodeCategory, NodeType } from '../repository/node-types.js';

// Reader for the additive `proposedStructure` field of the v1 analysis artifact. Absent in every
// artifact written before it existed, which is exactly what "no proposed structure" means — so
// prior-version documents keep parsing unchanged (ADR-0009). Values are only SHAPED here;
// createImpactAnalysis is what accepts or rejects them.

const readSignals = (raw: RawObject, path: string, issues: ValidationIssue[]): ConfidenceSignal[] =>
  readArray(raw, 'confidenceSignals', `${path}.confidenceSignals`, issues).map((entry, index) => {
    const signalPath = `${path}.confidenceSignals[${String(index)}]`;
    const obj = isRawObject(entry) ? entry : {};
    return {
      type: readString(obj, 'type', `${signalPath}.type`, issues) as ConfidenceSignal['type'],
      contribution: readNumber(obj, 'contribution', `${signalPath}.contribution`, issues),
    };
  });

interface ProposedCoreJson {
  readonly originOptionId: string;
  readonly rationale: string;
  readonly provenance: Provenance;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  readonly confidenceSignals: readonly ConfidenceSignal[];
}

const readCore = (raw: RawObject, path: string, issues: ValidationIssue[]): ProposedCoreJson => ({
  originOptionId: readString(raw, 'originOptionId', `${path}.originOptionId`, issues),
  rationale: readString(raw, 'rationale', `${path}.rationale`, issues),
  provenance: readString(raw, 'provenance', `${path}.provenance`, issues) as Provenance,
  evidenceIds: readStringArray(raw, 'evidenceIds', `${path}.evidenceIds`, issues),
  confidence: readNumber(raw, 'confidence', `${path}.confidence`, issues),
  confidenceSignals: readSignals(raw, path, issues),
});

const readNode = (entry: unknown, path: string, issues: ValidationIssue[]): ProposedNode => {
  const raw = isRawObject(entry) ? entry : {};
  return {
    id: readString(raw, 'id', `${path}.id`, issues),
    name: readString(raw, 'name', `${path}.name`, issues),
    category: readString(raw, 'category', `${path}.category`, issues) as NodeCategory,
    type: readString(raw, 'type', `${path}.type`, issues) as NodeType,
    ...readCore(raw, path, issues),
  };
};

const readRelationship = (
  entry: unknown,
  path: string,
  issues: ValidationIssue[],
): ProposedRelationship => {
  const raw = isRawObject(entry) ? entry : {};
  return {
    id: readString(raw, 'id', `${path}.id`, issues),
    sourceId: readString(raw, 'sourceId', `${path}.sourceId`, issues),
    targetId: readString(raw, 'targetId', `${path}.targetId`, issues),
    sourceKind: readString(raw, 'sourceKind', `${path}.sourceKind`, issues) as ProposedEndpointKind,
    targetKind: readString(raw, 'targetKind', `${path}.targetKind`, issues) as ProposedEndpointKind,
    type: readString(raw, 'type', `${path}.type`, issues) as EdgeType,
    status: readString(raw, 'status', `${path}.status`, issues) as 'proposed',
    ...readCore(raw, path, issues),
  };
};

export const readProposedStructure = (
  value: RawObject,
  issues: ValidationIssue[],
): ProposedStructure | undefined => {
  const raw = readOptionalObject(value, 'proposedStructure', 'proposedStructure', issues);
  if (raw === undefined) {
    return undefined;
  }
  return {
    nodes: readArray(raw, 'nodes', 'proposedStructure.nodes', issues).map((entry, index) =>
      readNode(entry, `proposedStructure.nodes[${String(index)}]`, issues),
    ),
    relationships: readArray(raw, 'relationships', 'proposedStructure.relationships', issues).map(
      (entry, index) =>
        readRelationship(entry, `proposedStructure.relationships[${String(index)}]`, issues),
    ),
  };
};
