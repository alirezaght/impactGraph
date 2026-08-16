import { canBlock, createPreflightFinding } from '@impactgraph/domain';

import { matchesAnyGlob } from '../evaluate-rules/glob.js';

import type { ProposedEdge, ProposedMechanism } from './proposed-edges.js';
import type { ConstraintKind, PreflightFinding, RepositoryConstraint } from '@impactgraph/domain';

/**
 * Hold every relationship the plan proposes against every rule the repository enforces.
 *
 * This is the analyzer the whole redesign exists for. The expensive failure was not that the design
 * was subtle — the guard and the requirement said the same thing in different files, and nobody put
 * them side by side until CI did, several commits later.
 */

/** Which constraint kinds can be violated by which mechanism. Closed table, no fallback. */
const MECHANISM_APPLIES_TO: Readonly<Record<ProposedMechanism, readonly ConstraintKind[]>> = {
  http: ['forbidden-runtime-call', 'boundary-restriction'],
  event: ['forbidden-runtime-call'],
  import: ['forbidden-dependency', 'boundary-restriction'],
  'direct-data-access': ['forbidden-runtime-call', 'boundary-restriction'],
  configuration: ['required-config'],
};

export interface CheckConstraintsInput {
  readonly proposedEdges: readonly ProposedEdge[];
  readonly constraints: readonly RepositoryConstraint[];
  readonly nextId: (seed: string) => string;
}

/**
 * A proposed endpoint falls inside a constraint's scope when its resolved path matches, or — when
 * the endpoint did not resolve — when its name matches a scope segment.
 *
 * The unresolved case is deliberately permitted but recorded: the peer-HTTP failure involved two
 * services that both existed, but a plan naming a service that is not yet indexed is exactly when a
 * constraint check is most valuable. Confidence carries the difference, and the finding says so.
 */
const inScope = (
  endpoint: ProposedEdge['source'],
  scope: RepositoryConstraint['scope'],
): { readonly matched: boolean; readonly byPath: boolean } => {
  if (scope.pathGlobs.length === 0 || scope.pathGlobs.includes('**')) {
    return { matched: true, byPath: endpoint.path !== undefined };
  }
  if (endpoint.path !== undefined && matchesAnyGlob(endpoint.path, scope.pathGlobs)) {
    return { matched: true, byPath: true };
  }
  const segments = scope.pathGlobs
    .map((glob) => glob.replace(/\/?\*+$/, '').toLowerCase())
    .flatMap((segment) => (segment.endsWith('s') ? [segment, segment.slice(0, -1)] : [segment]));
  const ref = endpoint.ref.toLowerCase();
  const matched = segments.some((segment) => segment.length > 2 && ref.includes(segment));
  return { matched, byPath: false };
};

/**
 * An exemption applies when it names the SOURCE endpoint — the allowlisted location the call is
 * made from — by exact path, glob, or exact reference. Substring matching is deliberately absent:
 * an allowlist entry for one file inside a service must not exempt every relationship that merely
 * mentions that service's name.
 */
const exemptionFor = (
  constraint: RepositoryConstraint,
  edge: ProposedEdge,
): RepositoryConstraint['exemptions'][number] | undefined =>
  constraint.exemptions.find((exemption) => {
    const subject = exemption.subject;
    const candidates = [edge.source.path, edge.source.ref].filter(
      (value): value is string => value !== undefined,
    );
    return candidates.some(
      (candidate) => candidate === subject || matchesAnyGlob(candidate, [subject]),
    );
  });

/**
 * The caveat is not decoration. When the endpoint never resolved to indexed code, the reader must
 * be able to tell that the scope match rests on a name, not on a path — otherwise a warning reads
 * with the same authority as a violation proved line by line.
 */
const statementFor = (
  edge: ProposedEdge,
  constraint: RepositoryConstraint,
  byPath: boolean,
): string => {
  const mechanism =
    edge.mechanism === 'http'
      ? 'peer-service HTTP communication'
      : `a ${edge.mechanism} relationship`;
  const caveat = byPath
    ? ''
    : ` Scope match is by name only — neither endpoint resolved to indexed code, so this is not confirmed.`;
  return `Requirement ${edge.requirementId} introduces ${mechanism} from ${edge.source.ref} to ${edge.target.ref}. Repository invariant ${constraint.source.filePath} ${constraint.rule.statement}.${caveat}`;
};

const recommendationFor = (constraint: RepositoryConstraint): string =>
  constraint.exemptions.length > 0
    ? `Route the relationship through one of the allowlisted locations (${constraint.exemptions
        .map((exemption) => exemption.subject)
        .slice(0, 3)
        .join(', ')}), or revise the design.`
    : `Revise the design, or change ${constraint.source.filePath} deliberately and record why.`;

/** Whether an endpoint sits in one of the named element roles, by path or by its written name. */
const matchesRole = (endpoint: ProposedEdge['source'], roles: readonly string[]): boolean =>
  roles.some((role) => {
    const needle = role.toLowerCase();
    return (
      endpoint.path?.toLowerCase().includes(needle) === true ||
      endpoint.ref.toLowerCase().includes(needle)
    );
  });

/**
 * A boundary restriction states what IS allowed among the repository's own elements, so it is
 * violated only when the target is internal and not among the permitted scopes. An external
 * library is not an element — "application may only depend on domain" says nothing about lodash.
 * An empty allow-list permits nothing internal; it must never read as "everything allowed".
 */
const permittedByBoundary = (constraint: RepositoryConstraint, edge: ProposedEdge): boolean => {
  if (constraint.kind !== 'boundary-restriction') {
    return false;
  }
  const allowed = constraint.rule.targetScope;
  if (allowed === undefined) {
    return false;
  }
  if (edge.target.path === undefined) {
    return true;
  }
  const byPath =
    allowed.pathGlobs.length > 0 && matchesAnyGlob(edge.target.path, allowed.pathGlobs);
  return byPath || matchesRole(edge.target, allowed.roles ?? []);
};

/**
 * A role-scoped rule ("from: 'application'") governs exactly that layer. When the config declared
 * element patterns, scope.pathGlobs already carry them and the path check decides; a config
 * without patterns falls back to role-name matching. Without this, every layer's rule matched
 * every source, and the only thing hiding the false positives was a second bug that permitted
 * every target — two wrongs making the whole layer silently dead.
 */
const sourceInScope = (
  edge: ProposedEdge,
  constraint: RepositoryConstraint,
): { readonly matched: boolean; readonly byPath: boolean } => {
  const roles = constraint.scope.roles ?? [];
  if (
    constraint.kind === 'boundary-restriction' &&
    roles.length > 0 &&
    (constraint.scope.pathGlobs.length === 0 || constraint.scope.pathGlobs.includes('**'))
  ) {
    return { matched: matchesRole(edge.source, roles), byPath: false };
  }
  return inScope(edge.source, constraint.scope);
};

interface Candidate {
  readonly edge: ProposedEdge;
  readonly constraint: RepositoryConstraint;
  readonly byPath: boolean;
}

const candidates = (input: CheckConstraintsInput): readonly Candidate[] => {
  const found: Candidate[] = [];
  for (const edge of input.proposedEdges) {
    const applicable = MECHANISM_APPLIES_TO[edge.mechanism];
    const perEdge: Candidate[] = [];
    for (const constraint of input.constraints) {
      if (!applicable.includes(constraint.kind)) {
        continue;
      }
      const scoped = sourceInScope(edge, constraint);
      if (!scoped.matched) {
        continue;
      }
      if (permittedByBoundary(constraint, edge)) {
        continue;
      }
      perEdge.push({ edge, constraint, byPath: scoped.byPath });
    }
    // Element rosters are order-dependent ("specific packages first, then the catch-all"), which a
    // flat constraint list cannot express — so when a layer rule matched the source by PATH, a
    // second layer rule that only matched by name is the catch-all misfiring, not a second rule.
    const pathConfirmedBoundary = perEdge.some(
      (candidate) => candidate.constraint.kind === 'boundary-restriction' && candidate.byPath,
    );
    found.push(
      ...perEdge.filter(
        (candidate) =>
          candidate.constraint.kind !== 'boundary-restriction' ||
          !pathConfirmedBoundary ||
          candidate.byPath,
      ),
    );
  }
  return found;
};

/**
 * Confidence, and therefore severity, follow how much was READ.
 *
 * A violation whose endpoints resolved to indexed paths inside the guard's own scope is a
 * statement a reviewer can check line by line, and it blocks. One resting on a name resemblance
 * warns instead — the finding is still worth making, but it must not stop work on its own.
 */
const gradeOf = (
  candidate: Candidate,
): { readonly severity: 'blocking' | 'warning'; readonly confidence: number } => {
  const authoritative = canBlock(candidate.constraint.extraction);
  const strong = candidate.byPath && candidate.edge.confidence >= 0.8;
  if (authoritative && candidate.constraint.severity === 'blocking' && strong) {
    return { severity: 'blocking', confidence: 0.9 };
  }
  return { severity: 'warning', confidence: candidate.byPath ? 0.7 : 0.5 };
};

export const checkConstraints = (input: CheckConstraintsInput): readonly PreflightFinding[] => {
  const findings: PreflightFinding[] = [];
  for (const candidate of candidates(input)) {
    const { edge, constraint } = candidate;
    const exemption = exemptionFor(constraint, edge);
    if (exemption !== undefined) {
      // The relationship is allowed here. Reporting it anyway is the false positive that makes a
      // constraint checker untrustworthy, so nothing is emitted at all.
      continue;
    }
    const grade = gradeOf(candidate);
    const result = createPreflightFinding({
      id: input.nextId(`${edge.requirementId}:${constraint.id}`),
      kind: grade.severity === 'blocking' ? 'blocking-constraint-violation' : 'constraint-warning',
      severity: grade.severity,
      requirementIds: [edge.requirementId],
      statement: statementFor(edge, constraint, candidate.byPath),
      recommendation: recommendationFor(constraint),
      subject: {
        constraintId: constraint.id,
        proposedRelationship: {
          sourceRef: edge.source.ref,
          relation: edge.relation,
          targetRef: edge.target.ref,
        },
        nodeIds: [edge.source.nodeId, edge.target.nodeId].filter(
          (id): id is string => id !== undefined,
        ),
        filePaths: [constraint.source.filePath],
      },
      evidenceIds: [...constraint.evidenceIds],
      confidence: grade.confidence,
      provenance: constraint.provenance,
      analyzer: 'check-constraints',
    });
    if (result.ok) {
      findings.push(result.value);
    }
  }
  return findings;
};
