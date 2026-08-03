import { PubSub } from '@google-cloud/pubsub';

// The publisher half of Story 16.3. `deal-events` is the topic ../../infra/main.tf declares;
// nothing here names Terraform and nothing in Terraform names this file — the topic name is the
// only thing they share, which is exactly what the cross-stack correspondence rests on.
//
// `deal-event` below is one character off ON PURPOSE. It must produce a topic node (the code
// really does publish to it) and must NEVER correlate with the Terraform resource.
const pubsub = new PubSub();

export async function publishDealCreated(deal: unknown): Promise<void> {
  await pubsub.topic('deal-events').publishMessage({ json: deal });
}

export async function publishLegacyEvent(deal: unknown): Promise<void> {
  await pubsub.topic('deal-event').publishMessage({ json: deal });
}

// This file states an ENVIRONMENT VARIABLE NAME, never a topic name. ../../infra/main.tf sets
// DEAL_EVENTS_TOPIC on the Cloud Run job this package deploys as, to a reference to a topic it
// declares literally — so the two halves join and this publishes to `deal-events`.
export async function publishConfiguredEvent(deal: unknown): Promise<void> {
  await pubsub.topic(process.env.DEAL_EVENTS_TOPIC!).publishMessage({ json: deal });
}

// LEGACY_TOPIC is set by the same job, to a LITERAL string rather than to a resource reference.
// Nothing joins, and no topic node is produced for this function — on purpose.
export async function publishViaLiteralEnv(deal: unknown): Promise<void> {
  await pubsub.topic(process.env.LEGACY_TOPIC!).publishMessage({ json: deal });
}
