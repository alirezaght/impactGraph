import { assignmentFor } from './assignments.js';
import { matchesGlob } from './glob.js';

import type { PathAssignment } from './assignments.js';
import type {
  ArchitectureModel,
  ArchitectureRule,
  DependencyDirectionRule,
  RuleViolation,
} from './types.js';
import type { GraphEdge, KnowledgeGraph } from '@impactgraph/domain';

// Story 8.4 — deterministic rule evaluation (PRD §27). No AI anywhere in this path; every
// violation carries the evidence that proves it. Violations are inputs to human judgment.

/** Edge types that constitute an architectural dependency for §27 direction rules. */
const DEPENDENCY_EDGE_TYPES = new Set(['IMPORTS', 'CALLS', 'USES']);

const sideMatches = (
  assignment: PathAssignment,
  role: string | undefined,
  context: string | undefined,
): boolean =>
  (role === undefined || assignment.role === role) &&
  (context === undefined || assignment.context === context) &&
  (role !== undefined || context !== undefined);

const describeSide = (role: string | undefined, context: string | undefined): string =>
  role ?? context ?? 'unassigned';

const dependencyViolation = (
  rule: DependencyDirectionRule,
  edge: GraphEdge,
  graph: KnowledgeGraph,
): RuleViolation | undefined => {
  const source = graph.nodes.get(edge.sourceId);
  const target = graph.nodes.get(edge.targetId);
  if (source?.path === undefined || target?.path === undefined) {
    return undefined;
  }
  return {
    ruleId: rule.id,
    message:
      rule.description ??
      `'${describeSide(rule.sourceRole, rule.sourceContext)}' must not depend on '${describeSide(rule.forbiddenTargetRole, rule.forbiddenTargetContext)}': ${source.path} → ${target.path}`,
    evidence: {
      filePaths: [source.path, target.path],
      edgeId: edge.id,
      sourceNodeId: source.id,
      targetNodeId: target.id,
    },
  };
};

export interface DependencyRuleRequest {
  readonly graph: KnowledgeGraph;
  readonly model: ArchitectureModel;
  readonly rules: readonly ArchitectureRule[];
  /** When set, only edges touching one of these paths are evaluated (review scope). */
  readonly restrictToPaths?: ReadonlySet<string> | undefined;
}

const edgeInScope = (request: DependencyRuleRequest, edge: GraphEdge): boolean => {
  if (!DEPENDENCY_EDGE_TYPES.has(edge.type)) {
    return false;
  }
  const sourcePath = request.graph.nodes.get(edge.sourceId)?.path;
  const targetPath = request.graph.nodes.get(edge.targetId)?.path;
  if (sourcePath === undefined || targetPath === undefined || sourcePath === targetPath) {
    return false;
  }
  return (
    request.restrictToPaths === undefined ||
    request.restrictToPaths.has(sourcePath) ||
    request.restrictToPaths.has(targetPath)
  );
};

const violationsForEdge = (
  request: DependencyRuleRequest,
  edge: GraphEdge,
  rules: readonly DependencyDirectionRule[],
): RuleViolation[] => {
  const sourcePath = request.graph.nodes.get(edge.sourceId)?.path ?? '';
  const targetPath = request.graph.nodes.get(edge.targetId)?.path ?? '';
  const sourceAssignment = assignmentFor(sourcePath, request.model);
  const targetAssignment = assignmentFor(targetPath, request.model);
  return rules
    .filter(
      (rule) =>
        sideMatches(sourceAssignment, rule.sourceRole, rule.sourceContext) &&
        sideMatches(targetAssignment, rule.forbiddenTargetRole, rule.forbiddenTargetContext),
    )
    .map((rule) => dependencyViolation(rule, edge, request.graph))
    .filter((violation): violation is RuleViolation => violation !== undefined);
};

export const evaluateDependencyRules = (request: DependencyRuleRequest): RuleViolation[] => {
  const rules = request.rules.filter(
    (rule): rule is DependencyDirectionRule => rule.type === 'dependency-direction',
  );
  if (rules.length === 0) {
    return [];
  }
  const violations: RuleViolation[] = [];
  for (const edge of request.graph.edges.values()) {
    if (edgeInScope(request, edge)) {
      violations.push(...violationsForEdge(request, edge, rules));
    }
  }
  return violations;
};

/** §27 "a change here demands a change there" — evaluated on a review's changed files. */
export const evaluateChangeRules = (
  changedFiles: readonly string[],
  rules: readonly ArchitectureRule[],
): RuleViolation[] => {
  const violations: RuleViolation[] = [];
  for (const rule of rules) {
    if (rule.type !== 'accompanying-change') {
      continue;
    }
    const triggering = changedFiles.filter((path) => matchesGlob(path, rule.whenChanged));
    if (triggering.length === 0) {
      continue;
    }
    if (changedFiles.some((path) => matchesGlob(path, rule.requireChanged))) {
      continue;
    }
    violations.push({
      ruleId: rule.id,
      message:
        rule.description ??
        `changes matching '${rule.whenChanged}' require an accompanying change matching '${rule.requireChanged}', but none was found`,
      evidence: { filePaths: triggering },
    });
  }
  return violations;
};
