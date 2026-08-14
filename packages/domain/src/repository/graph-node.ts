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

/**
 * Whether a route parameter must be supplied — as OBSERVED, never as assumed.
 *
 * `unknown` is a first-class state and the common one. A brace placeholder (`{id}`, Spring and
 * FastAPI) states that a segment is dynamic and says nothing about whether it may be omitted;
 * optionality there lives in a handler signature the route producer does not read. Recording
 * `required` for those would be an assumption dressed as a fact, and a propagation rule would then
 * treat a guess as evidence.
 */
export type Requiredness = 'required' | 'optional' | 'unknown';

const REQUIREDNESS: ReadonlySet<string> = new Set(['required', 'optional', 'unknown']);

/** One path or query parameter of a route contract. */
export interface RouteParameter {
  readonly name: string;
  readonly requiredness: Requiredness;
}

/**
 * A route's contract as structured data (PRD §12.1.1).
 *
 * Verb and path used to exist only inside the node's display name, which meant every consumer
 * recovered them by splitting a string — `cross-stack/route-index.ts` did exactly that. A route
 * contract is an intrinsic property of one architectural component, not a set of components: making
 * nodes for a verb, a path and each parameter would invent traversal paths and require edge types
 * just to reassemble a single declaration. So it is typed data on the node it describes.
 *
 * The display name becomes presentation derived from this, never the source of truth.
 */
export interface RouteContract {
  readonly path: string;
  /** Absent when the framework declares a path without constraining the verb. */
  readonly method?: string;
  readonly pathParameters: readonly RouteParameter[];
  readonly queryParameters: readonly RouteParameter[];
}

/** A component of the analyzed system (PRD §12.1) with its mandatory provenance envelope. */
export interface GraphNode {
  readonly id: NodeId;
  readonly category: NodeCategory;
  readonly type: NodeType;
  readonly name: string;
  readonly path?: string;
  /** Present on route nodes (`api-endpoint`, page routes). Absent on everything else. */
  readonly route?: RouteContract;
  /**
   * The declared type of a member, exactly as the source states it (ADR-0020 §3):
   * `Mapped[uuid.UUID]`, `UUID`, `string | null`. A fact with a source location, not a type
   * system — never inferred, never normalized beyond the producer's trimming, and absent
   * whenever the declaration states none.
   */
  readonly declaredType?: string;
  readonly knowledge: KnowledgeEnvelope;
}

/** `GET /api/deals` — presentation only. Nothing may parse this back into verb and path. */
export const routeDisplayName = (route: RouteContract): string =>
  `${route.method ?? 'ANY'} ${route.path}`;

export interface CreateGraphNodeInput {
  readonly id: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly path?: string;
  readonly route?: RouteContract;
  readonly declaredType?: string;
  readonly knowledge: KnowledgeEnvelopeInput;
}

const routeIssues = (route: RouteContract | undefined): ValidationIssue[] => {
  if (route === undefined) {
    return [];
  }
  const issues: ValidationIssue[] = [];
  if (!route.path.startsWith('/')) {
    issues.push(validationIssue('invalid-route', 'route.path', 'a route path must start with "/"'));
  }
  if (route.method !== undefined && route.method !== route.method.toUpperCase()) {
    issues.push(
      validationIssue('invalid-route', 'route.method', 'a route method must be upper case'),
    );
  }
  for (const parameter of [...route.pathParameters, ...route.queryParameters]) {
    if (!REQUIREDNESS.has(parameter.requiredness)) {
      issues.push(
        validationIssue(
          'invalid-route',
          'route',
          `unknown requiredness '${parameter.requiredness}'`,
        ),
      );
    }
    if (parameter.name.trim().length === 0) {
      issues.push(validationIssue('invalid-route', 'route', 'a route parameter must have a name'));
    }
  }
  return issues;
};

const copyRoute = (route: RouteContract): RouteContract => ({
  path: route.path,
  ...(route.method === undefined ? {} : { method: route.method }),
  pathParameters: route.pathParameters.map((parameter) => ({ ...parameter })),
  queryParameters: route.queryParameters.map((parameter) => ({ ...parameter })),
});

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
  const issues = [
    ...blankIdIssue(input.id, 'id'),
    ...vocabularyIssues(input),
    ...routeIssues(input.route),
  ];
  if (input.name.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'name', 'name must not be blank'));
  }
  if (input.path !== undefined && input.path.trim().length === 0) {
    issues.push(validationIssue('blank-field', 'path', 'path, when present, must not be blank'));
  }
  if (input.declaredType !== undefined && input.declaredType.trim().length === 0) {
    issues.push(
      validationIssue(
        'blank-field',
        'declaredType',
        'declaredType, when present, must not be blank — absence is the honest value',
      ),
    );
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
  return ok(
    deepFreeze({
      ...base,
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.route === undefined ? {} : { route: copyRoute(input.route) }),
      ...(input.declaredType === undefined ? {} : { declaredType: input.declaredType }),
    }),
  );
};
