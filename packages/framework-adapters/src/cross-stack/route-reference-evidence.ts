import type { RouteReference } from '@impactgraph/domain';
import type { CallFact, FragmentBuilder, IndexingContext } from '@impactgraph/language-adapters';

// §12.1.1. A cross-stack correspondence used to cite evidence from both sides and record nothing
// about how the two were matched — the literal path, the stated verb and the normalization were all
// observed here and then thrown away. This records them.
//
// The record is genuinely NEW evidence, not a copy of the reference's own: the reference evidence
// says "this file writes this attribute", produced by a language adapter that did not know it was
// looking at a route. This says "that attribute was matched to a declared route, this way",
// produced by the matcher. Both are cited on the edge, because they are different observations.

export interface RouteReferenceInput {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly fact: CallFact;
  /** The edge id, so one correspondence yields one evidence record with a traceable id. */
  readonly edgeId: string;
  /** The path as written at the reference site. */
  readonly literalPath: string;
  /** The path matching actually used, when normalization changed the literal. */
  readonly normalizedPath: string;
  /** What produced this correspondence, e.g. 'cross-stack-endpoint-match'. */
  readonly producer: string;
  readonly relationship: string;
}

/**
 * The verb a reference STATES, or absent.
 *
 * `<form method="post">` and a `fetch(url, { method })` state one; `<a href>` states none, and the
 * absence stays an absence. HTML's GET default is a browser behaviour rather than a repository
 * declaration, so filling it in would turn a convention of the web into a fact about this codebase.
 */
export const statedMethod = (fact: CallFact): string | undefined =>
  fact.keywordStringArguments?.['method']?.toUpperCase();

const routeReference = (input: RouteReferenceInput): RouteReference => {
  const method = statedMethod(input.fact);
  return {
    literalPath: input.literalPath,
    // Recorded only when it differs. Emitting it unconditionally would make every reference look
    // like it needed normalizing, which is the opposite of what a reviewer wants to see.
    ...(input.normalizedPath === input.literalPath ? {} : { normalizedPath: input.normalizedPath }),
    ...(method === undefined ? {} : { method }),
    attribute: input.fact.calleeName,
    // Every path this matcher can see came from a string literal — a reference whose path is
    // assembled at runtime produces no `stringArguments[0]` and never reaches here. `dynamic` is
    // declared in the type for the producer that will read one, and is deliberately never written
    // by this one rather than being approximated.
    resolution: 'static',
  };
};

/**
 * Record how one correspondence was established. Returns the evidence id, or `undefined` when the
 * record was rejected — the caller keeps its edge either way, since a missing diagnostic must not
 * cost a real relationship.
 */
export const addRouteReferenceEvidence = (input: RouteReferenceInput): string | undefined =>
  input.builder.addEvidence(
    {
      id: `route-ref:${input.edgeId}`,
      kind: 'call-site',
      source: { kind: 'file', filePath: input.fact.filePath },
      derivation: {
        mechanism: 'url-path-correspondence',
        relationship: input.relationship,
        producer: input.producer,
        routeReference: routeReference(input),
      },
      repositorySnapshotId: input.context.repositorySnapshotId,
      createdAt: input.context.createdAt,
    },
    input.fact.filePath,
  );
