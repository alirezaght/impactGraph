import { err } from '../errors/result.js';
import { validationError, validationIssue } from '../errors/validation.js';
import { createGraphEdge } from '../repository/graph-edge.js';
import { createGraphNode } from '../repository/graph-node.js';

import { readKnowledgeEnvelopeInput, serializeKnowledgeEnvelope } from './knowledge-json.js';
import {
  checkSchemaVersion,
  isRawObject,
  readObject,
  readOptionalString,
  readString,
} from './parse-helpers.js';

import type { KnowledgeEnvelopeJson } from './knowledge-json.js';
import type { Result } from '../errors/result.js';
import type { ValidationError, ValidationIssue } from '../errors/validation.js';
import type { GraphEdge } from '../repository/graph-edge.js';
import type { GraphNode } from '../repository/graph-node.js';

export const GRAPH_NODE_SCHEMA_VERSION = 1;
export const GRAPH_EDGE_SCHEMA_VERSION = 1;

export interface GraphNodeJson {
  readonly schemaVersion: number;
  readonly id: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly path?: string;
  readonly knowledge: KnowledgeEnvelopeJson;
}

export interface GraphEdgeJson {
  readonly schemaVersion: number;
  readonly id: string;
  readonly type: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly knowledge: KnowledgeEnvelopeJson;
}

export const serializeGraphNode = (node: GraphNode): GraphNodeJson => {
  const base = {
    schemaVersion: GRAPH_NODE_SCHEMA_VERSION,
    id: node.id,
    category: node.category,
    type: node.type,
    name: node.name,
    knowledge: serializeKnowledgeEnvelope(node.knowledge),
  };
  return node.path === undefined ? base : { ...base, path: node.path };
};

export const serializeGraphEdge = (edge: GraphEdge): GraphEdgeJson => ({
  schemaVersion: GRAPH_EDGE_SCHEMA_VERSION,
  id: edge.id,
  type: edge.type,
  sourceId: edge.sourceId,
  targetId: edge.targetId,
  knowledge: serializeKnowledgeEnvelope(edge.knowledge),
});

const notAnObject = (what: string): ValidationError =>
  validationError([validationIssue('invalid-type', '', `${what} JSON must be an object`)]);

export const parseGraphNode = (value: unknown): Result<GraphNode, ValidationError> => {
  if (!isRawObject(value)) {
    return err(notAnObject('graph node'));
  }
  const issues: ValidationIssue[] = [];
  checkSchemaVersion(value, GRAPH_NODE_SCHEMA_VERSION, issues);
  const path = readOptionalString(value, 'path', 'path', issues);
  const base = {
    id: readString(value, 'id', 'id', issues),
    category: readString(value, 'category', 'category', issues),
    type: readString(value, 'type', 'type', issues),
    name: readString(value, 'name', 'name', issues),
    knowledge: readKnowledgeEnvelopeInput(
      readObject(value, 'knowledge', 'knowledge', issues),
      'knowledge',
      issues,
    ),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createGraphNode(path === undefined ? base : { ...base, path });
};

export const parseGraphEdge = (value: unknown): Result<GraphEdge, ValidationError> => {
  if (!isRawObject(value)) {
    return err(notAnObject('graph edge'));
  }
  const issues: ValidationIssue[] = [];
  checkSchemaVersion(value, GRAPH_EDGE_SCHEMA_VERSION, issues);
  const input = {
    id: readString(value, 'id', 'id', issues),
    type: readString(value, 'type', 'type', issues),
    sourceId: readString(value, 'sourceId', 'sourceId', issues),
    targetId: readString(value, 'targetId', 'targetId', issues),
    knowledge: readKnowledgeEnvelopeInput(
      readObject(value, 'knowledge', 'knowledge', issues),
      'knowledge',
      issues,
    ),
  };
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createGraphEdge(input);
};
