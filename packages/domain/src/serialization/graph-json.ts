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
import type { RouteContract, RouteParameter } from '../repository/graph-node.js';
import type { GraphNode } from '../repository/graph-node.js';

/** 2 since §12.1.1: a node may carry a structured route contract. */
export const GRAPH_NODE_SCHEMA_VERSION = 3;
export const GRAPH_EDGE_SCHEMA_VERSION = 1;

export interface RouteParameterJson {
  readonly name: string;
  readonly requiredness: string;
}

export interface RouteContractJson {
  readonly path: string;
  readonly method?: string;
  readonly pathParameters: readonly RouteParameterJson[];
  readonly queryParameters: readonly RouteParameterJson[];
}

export interface GraphNodeJson {
  readonly schemaVersion: number;
  readonly id: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly path?: string;
  readonly route?: RouteContractJson;
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
  const withPath = node.path === undefined ? base : { ...base, path: node.path };
  return node.route === undefined ? withPath : { ...withPath, route: node.route };
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

const readParameters = (
  raw: unknown,
  field: string,
  issues: ValidationIssue[],
): RouteParameter[] => {
  if (!Array.isArray(raw)) {
    issues.push(validationIssue('invalid-route', `route.${field}`, `${field} must be an array`));
    return [];
  }
  return raw.map((entry) => {
    if (!isRawObject(entry) || typeof entry['name'] !== 'string') {
      issues.push(validationIssue('invalid-route', `route.${field}`, 'a parameter needs a name'));
      return { name: '', requiredness: 'unknown' as const };
    }
    const requiredness = entry['requiredness'];
    if (requiredness !== 'required' && requiredness !== 'optional' && requiredness !== 'unknown') {
      issues.push(
        validationIssue('invalid-route', `route.${field}`, 'a parameter needs a requiredness'),
      );
      return { name: entry['name'], requiredness: 'unknown' as const };
    }
    return { name: entry['name'], requiredness };
  });
};

/** Reads the §12.1.1 contract. Absent is legitimate — most nodes are not routes. */
const readRouteContract = (
  value: Record<string, unknown>,
  issues: ValidationIssue[],
): RouteContract | undefined => {
  const raw = value['route'];
  if (raw === undefined) {
    return undefined;
  }
  if (!isRawObject(raw) || typeof raw['path'] !== 'string') {
    issues.push(validationIssue('invalid-route', 'route', 'a route contract needs a path'));
    return undefined;
  }
  const method = raw['method'];
  return {
    path: raw['path'],
    ...(typeof method === 'string' ? { method } : {}),
    pathParameters: readParameters(raw['pathParameters'], 'pathParameters', issues),
    queryParameters: readParameters(raw['queryParameters'], 'queryParameters', issues),
  };
};

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
  const route = readRouteContract(value, issues);
  if (issues.length > 0) {
    return err(validationError(issues));
  }
  return createGraphNode({
    ...base,
    ...(path === undefined ? {} : { path }),
    ...(route === undefined ? {} : { route }),
  });
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
