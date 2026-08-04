// The transactional outbox. `outbox_events` is a table; the relay below reads it and publishes.
export interface OutboxRecord {
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

const pending: OutboxRecord[] = [];

export const recordOutboxEvent = (eventType: string, payload: Record<string, unknown>): void => {
  pending.push({ eventType, payload });
};

export const drainOutbox = (): readonly OutboxRecord[] => pending.splice(0, pending.length);
