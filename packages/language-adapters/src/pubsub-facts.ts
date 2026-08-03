import type { FragmentBuilder } from './fragment-builder.js';

// Facts for the two Pub/Sub names a single file CANNOT resolve but the repository states somewhere
// else (epic-16). Both travel on the language-neutral `CallFact` channel — the same bus the
// Terraform adapter uses for cross-file references — because resolving them needs a second file
// that the per-file parse never sees, and joining two files is a framework adapter's job (PRD §31).
//
// The distinction these channels exist to preserve:
//
// * `process.env.TOPIC` / `os.environ["TOPIC"]` — the file states an ENVIRONMENT VARIABLE NAME.
//   That is a fact. It is not a topic name, and nothing here pretends otherwise; whether any topic
//   name is knowable depends on whether the deployment configuration states one, which only
//   `cross-stack/cloud-run-env.ts` can see.
// * `@Value("${deals.topic}")` — the file states a CONFIGURATION KEY. Also a fact, also not a topic
//   name. `spring/spring-value-topics.ts` resolves it against the module's own `application.yml`.
//
// A name the repository states NOWHERE — a function parameter, a runtime-computed string — has no
// channel here on purpose. There is nothing to record, so nothing is (PRD §35).

/** A publisher/consumer whose resource name is read from an environment variable at runtime. */
export const PUBSUB_ENV_RECEIVER = 'pubsub:env-name';

/** A publisher/consumer whose resource name comes from a framework configuration key. */
export const PUBSUB_CONFIG_NAME_RECEIVER = 'pubsub:config-name';

/** Which side of a Pub/Sub relationship the unresolved name belongs to. */
export type PubSubResourceKind = 'topic' | 'subscription';

export interface UnresolvedPubSubName {
  readonly filePath: string;
  readonly kind: PubSubResourceKind;
  /** The environment variable name, or the configuration key holder — never a resource name. */
  readonly reference: string;
  /** The graph node that would publish/consume, were the name resolvable. */
  readonly sourceId: string;
  readonly evidenceId: string;
}

const addFact = (
  builder: FragmentBuilder,
  receiverName: string,
  fact: UnresolvedPubSubName,
): void => {
  builder.addCallFact({
    filePath: fact.filePath,
    receiverName,
    calleeName: fact.reference,
    stringArguments: [fact.kind],
    identifierArguments: [],
    enclosingSymbolNodeId: fact.sourceId,
    evidenceId: fact.evidenceId,
  });
};

/** `pubsub.topic(process.env.DEAL_EVENTS_TOPIC)` — the env var name is what the file states. */
export const addPubSubEnvFact = (builder: FragmentBuilder, fact: UnresolvedPubSubName): void => {
  addFact(builder, PUBSUB_ENV_RECEIVER, fact);
};

/** `pubSubTemplate.publish(configuredTopic, …)` — `configuredTopic` may carry a `@Value` key. */
export const addPubSubConfigNameFact = (
  builder: FragmentBuilder,
  fact: UnresolvedPubSubName,
): void => {
  addFact(builder, PUBSUB_CONFIG_NAME_RECEIVER, fact);
};

/** Read one of these facts back, with the kind validated rather than trusted. */
export const unresolvedNameKind = (
  stringArguments: readonly string[],
): PubSubResourceKind | undefined => {
  const [kind] = stringArguments;
  return kind === 'topic' || kind === 'subscription' ? kind : undefined;
};
