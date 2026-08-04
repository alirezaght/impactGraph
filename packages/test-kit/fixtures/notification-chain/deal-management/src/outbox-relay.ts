import { PubSub } from '@google-cloud/pubsub';

import { drainOutbox } from './outbox.js';

// The relay: outbox rows become Pub/Sub messages on `notification-events`. This is the hop that
// makes the producer and the consumer one system, and it is a different file from both of them.
const pubsub = new PubSub();

export async function relayOutbox(): Promise<void> {
  for (const record of drainOutbox()) {
    await pubsub.topic('notification-events').publishMessage({ json: record });
  }
}
