import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue } from '../provenance/evidence.js';
import { buildKnowledgeEnvelope, collectEnvelopeIssues } from '../provenance/knowledge-envelope.js';

import { isEdgeType } from './edge-types.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { EdgeId, NodeId } from '../ids.js';
import type { EdgeType } from './edge-types.js';
import type {
  KnowledgeEnvelope,
  KnowledgeEnvelopeInput,
} from '../provenance/knowledge-envelope.js';

/** A typed relationship between two graph nodes (PRD §12.2) with its provenance envelope. */
export interface GraphEdge {
  readonly id: EdgeId;
  readonly type: EdgeType;
  readonly sourceId: NodeId;
  readonly targetId: NodeId;
  readonly knowledge: KnowledgeEnvelope;
}

export interface CreateGraphEdgeInput {
  readonly id: string;
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly knowledge: KnowledgeEnvelopeInput;
}

const edgeFieldIssues = (input: CreateGraphEdgeInput): ValidationIssue[] => {
  const issues = [
    ...blankIdIssue(input.id, 'id'),
    ...blankIdIssue(input.sourceId, 'sourceId'),
    ...blankIdIssue(input.targetId, 'targetId'),
  ];
  if (!isEdgeType(input.type)) {
    issues.push(
      validationIssue('unknown-edge-type', 'type', `unknown edge type '${input.type}' (PRD §12.2)`),
    );
  }
  return issues;
};

export const createGraphEdge = (
  input: CreateGraphEdgeInput,
): Result<GraphEdge, ValidationError> => {
  const issues = [
    ...edgeFieldIssues(input),
    ...collectEnvelopeIssues(input.knowledge, 'knowledge'),
  ];
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return ok(
    deepFreeze({
      id: input.id as EdgeId,
      type: input.type as EdgeType,
      sourceId: input.sourceId as NodeId,
      targetId: input.targetId as NodeId,
      knowledge: buildKnowledgeEnvelope(input.knowledge),
    }),
  );
};
