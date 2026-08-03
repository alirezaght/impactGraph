import { err, ok } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { deepFreeze } from '../freeze.js';
import { blankIdIssue } from '../provenance/evidence.js';
import { buildKnowledgeEnvelope, collectEnvelopeIssues } from '../provenance/knowledge-envelope.js';

import { isNodeCategory, isNodeTypeInCategory } from './node-types.js';

import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { NodeId } from '../ids.js';
import type { NodeCategory, NodeType } from './node-types.js';
import type {
  KnowledgeEnvelope,
  KnowledgeEnvelopeInput,
} from '../provenance/knowledge-envelope.js';

/** A component of the analyzed system (PRD §12.1) with its mandatory provenance envelope. */
export interface GraphNode {
  readonly id: NodeId;
  readonly category: NodeCategory;
  readonly type: NodeType;
  readonly name: string;
  readonly path?: string;
  readonly knowledge: KnowledgeEnvelope;
}

export interface CreateGraphNodeInput {
  readonly id: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly path?: string;
  readonly knowledge: KnowledgeEnvelopeInput;
}

const vocabularyIssues = (input: CreateGraphNodeInput): ValidationIssue[] => {
  if (!isNodeCategory(input.category)) {
    return [
      validationIssue(
        'unknown-node-category',
        'category',
        `unknown node category '${input.category}' (PRD §12.1)`,
      ),
    ];
  }
  if (!isNodeTypeInCategory(input.category, input.type)) {
    return [
      validationIssue(
        'type-category-mismatch',
        'type',
        `node type '${input.type}' does not belong to category '${input.category}' (PRD §12.1)`,
      ),
    ];
  }
  return [];
};

const nodeFieldIssues = (input: CreateGraphNodeInput): ValidationIssue[] => {
  const issues = [...blankIdIssue(input.id, 'id'), ...vocabularyIssues(input)];
  if (input.name.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'name', 'name must not be blank'));
  }
  if (input.path !== undefined && input.path.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'path', 'path, when present, must not be blank'));
  }
  return issues;
};

export const createGraphNode = (
  input: CreateGraphNodeInput,
): Result<GraphNode, ValidationError> => {
  const issues = [
    ...nodeFieldIssues(input),
    ...collectEnvelopeIssues(input.knowledge, 'knowledge'),
  ];
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  const base = {
    id: input.id as NodeId,
    category: input.category as NodeCategory,
    type: input.type as NodeType,
    name: input.name,
    knowledge: buildKnowledgeEnvelope(input.knowledge),
  };
  return ok(deepFreeze(input.path === undefined ? base : { ...base, path: input.path }));
};
