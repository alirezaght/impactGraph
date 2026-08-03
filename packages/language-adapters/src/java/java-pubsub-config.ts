import { addPubSubConfigNameFact } from '../pubsub-facts.js';

import { callSiteEvidence } from './java-context.js';

import type { JavaParseState } from './java-context.js';
import type { HandleKind } from './java-pubsub-resources.js';
import type { Node } from 'web-tree-sitter';

// `pubSubTemplate.publish(configuredTopic, payload)` — the call proves a relationship, and this
// compilation unit does not state the topic's name. There are two very different reasons for that,
// and conflating them was the mistake this module exists to correct:
//
// * `configuredTopic` is a FIELD CARRYING `@Value("${deals.topic}")`. The repository states the
//   value — in `application.yml`, a committed file in the same module. Nothing here can read it
//   (one file at a time), so the identifier travels out on the `pubsub:config-name` channel and
//   `framework-adapters/spring/spring-value-topics.ts` joins it to the configuration entry.
// * `configuredTopic` is a parameter, a computed string, or a field with no `@Value`. The
//   repository states the value NOWHERE. Nothing is recorded and nothing resolves (PRD §35).
//
// This module cannot tell the two apart — whether the field carries `@Value` is a question about
// the class, and the annotation is already on the `DecoratorFact` channel — so it records the
// identifier for both and lets the resolver find no annotation in the second case. Recording an
// identifier is not claiming a topic: no node and no edge is created here, ever.

/** A field or local this file names but cannot value. */
const IDENTIFIER = 'identifier';

export interface UnresolvedNameInput {
  readonly call: Node;
  readonly kind: HandleKind;
  /** The argument that should have named the resource. */
  readonly argument: Node | undefined;
  /** What was called, for the warning text. */
  readonly description: string;
  /** The graph node that would publish/consume, were the name resolvable. */
  readonly sourceId: string;
}

/**
 * Report a resource name this file does not state, and record the identifier it used when there
 * is one. Always warns: a reader must see that a publish/consume relationship exists whose target
 * this file cannot name, whether or not the configuration turns out to supply it.
 */
export const noteUnresolvedName = (state: JavaParseState, input: UnresolvedNameInput): void => {
  const identifier = input.argument?.type === IDENTIFIER ? input.argument.text : undefined;
  state.builder.warn(
    state.filePath,
    `${input.description} was given a ${input.kind} name this file does not state literally` +
      (identifier === undefined
        ? ' — no node was created (PRD §35)'
        : ` — '${identifier}' is resolved only if it carries a @Value placeholder this module's ` +
          'Spring configuration states (PRD §35)'),
  );
  if (identifier === undefined) {
    return;
  }
  const evidenceId = callSiteEvidence(state, input.call, identifier);
  if (evidenceId === undefined) {
    return;
  }
  addPubSubConfigNameFact(state.builder, {
    filePath: state.filePath,
    kind: input.kind,
    reference: identifier,
    sourceId: input.sourceId,
    evidenceId,
  });
};
