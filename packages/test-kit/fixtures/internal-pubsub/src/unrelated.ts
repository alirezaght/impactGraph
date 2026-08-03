// Same decorator name from a DIFFERENT module — the rule must NOT match this file.
import { Subscribe } from './local-decorators';

export class NotAMessagingConsumer {
  @Subscribe('not-a-topic')
  handle(): void {}
}
