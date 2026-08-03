import { validationIssue } from '../errors/validation.js';
import { blankIdIssue } from '../provenance/evidence.js';
import { isProvenance, knowledgeCategoryOf } from '../provenance/provenance.js';
import { isEdgeType } from '../repository/edge-types.js';
import { isNodeCategory, isNodeTypeInCategory } from '../repository/node-types.js';

import type { ValidationIssue } from '../errors/validation.js';
import type { ConfidenceSignal } from '../provenance/confidence.js';
import type { Provenance } from '../provenance/provenance.js';
import type { EdgeType } from '../repository/edge-types.js';
import type { NodeCategory, NodeType } from '../repository/node-types.js';

// PRD §18.4 ("display current and proposed relationships") + §26 ("new dependencies" per
// architectural option). A proposed relationship is a relationship an option WOULD create; it
// is never an edge of the deterministic graph and is never merged into one. It lives in its own
// field, carries `status: 'proposed'`, and — like every other knowledge record — carries
// provenance, evidence ids, and the confidence signals its score was computed from (§3, §14).

/** Where an endpoint of a proposed relationship lives. `proposed` endpoints are NOT in the graph. */
export const PROPOSED_ENDPOINT_KINDS = ['existing', 'proposed'] as const;
export type ProposedEndpointKind = (typeof PROPOSED_ENDPOINT_KINDS)[number];

/** Fields every proposed record carries — the same envelope discipline as any knowledge record. */
interface ProposedRecordCore {
  /** The §26/§C8 option that implies this record. Proposals never exist without an option. */
  readonly originOptionId: string;
  /** Why the engine believes the option implies it — rendered as text, never interpreted. */
  readonly rationale: string;
  readonly provenance: Provenance;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  readonly confidenceSignals: readonly ConfidenceSignal[];
}

/**
 * A component an option would CREATE. It has no id in the deterministic graph and must never be
 * inserted into one — the explicit flag is the whole point (`sourceKind`/`targetKind` name it).
 */
export interface ProposedNode extends ProposedRecordCore {
  readonly id: string;
  readonly name: string;
  readonly category: NodeCategory;
  readonly type: NodeType;
}

/** A relationship an option would create between two components. */
export interface ProposedRelationship extends ProposedRecordCore {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceKind: ProposedEndpointKind;
  readonly targetKind: ProposedEndpointKind;
  readonly type: EdgeType;
  /** Literal: a record in this collection is proposed structure and nothing else. */
  readonly status: 'proposed';
}

/** The proposed half of the architecture, kept strictly beside the current half (§3). */
export interface ProposedStructure {
  readonly nodes: readonly ProposedNode[];
  readonly relationships: readonly ProposedRelationship[];
}

export interface ProposedStructureContext {
  /**
   * Node ids of the deterministic graph at the analysis's bound snapshot. When supplied, every
   * `existing` endpoint must be one of them and no proposed node may reuse one (§34, rule 4).
   * Absent only where the graph is genuinely unavailable — e.g. re-reading a stored artifact.
   */
  readonly existingNodeIds?: ReadonlySet<string> | undefined;
  /** Ids of the architectural options carried by the same analysis. */
  readonly optionIds: ReadonlySet<string>;
}

const originIssues = (
  record: ProposedRecordCore,
  optionIds: ReadonlySet<string>,
  path: string,
): ValidationIssue[] => {
  const issues = blankIdIssue(record.originOptionId, `${path}.originOptionId`);
  if (record.originOptionId.trim().length > 0 && !optionIds.has(record.originOptionId)) {
    issues.push(
      validationIssue(
        'unknown-node-reference',
        `${path}.originOptionId`,
        `proposal cites unknown architectural option '${record.originOptionId}'`,
      ),
    );
  }
  if (record.rationale.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.rationale`, 'rationale required'));
  }
  return issues;
};

/** The knowledge envelope every proposal must carry — the same bar as any other record (§3). */
const envelopeIssues = (record: ProposedRecordCore, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  if (!isProvenance(record.provenance) || knowledgeCategoryOf(record.provenance) === 'reserved') {
    issues.push(validationIssue('unknown-provenance', `${path}.provenance`, 'invalid provenance'));
  }
  if (record.evidenceIds.length === 0 && record.provenance !== 'human-confirmed') {
    issues.push(
      validationIssue('missing-evidence', `${path}.evidenceIds`, 'proposals require evidence'),
    );
  }
  if (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) {
    issues.push(validationIssue('out-of-range', `${path}.confidence`, 'confidence must be 0..1'));
  }
  if (record.confidenceSignals.length === 0) {
    issues.push(
      validationIssue(
        'missing-signals',
        `${path}.confidenceSignals`,
        'proposal confidence must carry contributing signals (PRD §14)',
      ),
    );
  }
  return issues;
};

const coreIssues = (
  record: ProposedRecordCore,
  optionIds: ReadonlySet<string>,
  path: string,
): ValidationIssue[] => [...originIssues(record, optionIds, path), ...envelopeIssues(record, path)];

const nodeIssues = (
  node: ProposedNode,
  context: ProposedStructureContext,
  path: string,
): ValidationIssue[] => {
  const issues = [
    ...blankIdIssue(node.id, `${path}.id`),
    ...coreIssues(node, context.optionIds, path),
  ];
  if (node.name.trim().length === 0) {
    issues.push(validationIssue('blank-field', `${path}.name`, 'name must not be blank'));
  }
  if (!isNodeCategory(node.category)) {
    issues.push(validationIssue('unknown-node-category', `${path}.category`, 'unknown category'));
  } else if (!isNodeTypeInCategory(node.category, node.type)) {
    issues.push(
      validationIssue('type-category-mismatch', `${path}.type`, 'type not in category (§12.1)'),
    );
  }
  if (context.existingNodeIds?.has(node.id) === true) {
    issues.push(
      validationIssue(
        'duplicate-id',
        `${path}.id`,
        `proposed node '${node.id}' already exists in the deterministic graph — a proposal may never shadow a real node`,
      ),
    );
  }
  return issues;
};

const endpointIssues = (
  endpoint: { readonly id: string; readonly kind: ProposedEndpointKind },
  known: {
    readonly existing?: ReadonlySet<string> | undefined;
    readonly proposed: ReadonlySet<string>;
  },
  path: string,
): ValidationIssue[] => {
  const issues = blankIdIssue(endpoint.id, path);
  if (!(PROPOSED_ENDPOINT_KINDS as readonly string[]).includes(endpoint.kind)) {
    issues.push(validationIssue('invalid-type', `${path}Kind`, 'unknown endpoint kind'));
    return issues;
  }
  const resolved = endpoint.kind === 'proposed' ? known.proposed : known.existing;
  if (resolved !== undefined && !resolved.has(endpoint.id)) {
    issues.push(
      validationIssue(
        'unknown-node-reference',
        path,
        `proposed relationship references ${endpoint.kind} node '${endpoint.id}', which does not exist`,
      ),
    );
  }
  return issues;
};

const relationshipIssues = (
  relationship: ProposedRelationship,
  context: ProposedStructureContext,
  proposedIds: ReadonlySet<string>,
  path: string,
): ValidationIssue[] => {
  const known = { existing: context.existingNodeIds, proposed: proposedIds };
  const issues = [
    ...blankIdIssue(relationship.id, `${path}.id`),
    ...coreIssues(relationship, context.optionIds, path),
    ...endpointIssues(
      { id: relationship.sourceId, kind: relationship.sourceKind },
      known,
      `${path}.sourceId`,
    ),
    ...endpointIssues(
      { id: relationship.targetId, kind: relationship.targetKind },
      known,
      `${path}.targetId`,
    ),
  ];
  if (!isEdgeType(relationship.type)) {
    issues.push(validationIssue('unknown-edge-type', `${path}.type`, 'unknown edge type (§12.2)'));
  }
  if (relationship.status !== 'proposed') {
    issues.push(
      validationIssue(
        'invalid-type',
        `${path}.status`,
        "proposed relationships must carry status 'proposed' — they are never current structure",
      ),
    );
  }
  if (relationship.sourceId === relationship.targetId) {
    issues.push(validationIssue('invalid-type', `${path}.targetId`, 'endpoints must differ'));
  }
  return issues;
};

/** Structural gate for the proposed half of an analysis (§34: nothing unverified is stored). */
export const collectProposedStructureIssues = (
  structure: ProposedStructure,
  context: ProposedStructureContext,
  path: string,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const proposedIds = new Set(structure.nodes.map((node) => node.id));
  structure.nodes.forEach((node, index) => {
    issues.push(...nodeIssues(node, context, `${path}.nodes[${String(index)}]`));
  });
  structure.relationships.forEach((relationship, index) => {
    issues.push(
      ...relationshipIssues(
        relationship,
        context,
        proposedIds,
        `${path}.relationships[${String(index)}]`,
      ),
    );
  });
  return issues;
};
