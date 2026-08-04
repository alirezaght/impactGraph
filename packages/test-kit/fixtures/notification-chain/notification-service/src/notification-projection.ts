import { renderMessage } from './message-renderer.js';

// The projection: consumed events become rendered messages in the read model.
interface Envelope {
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

const inbox: string[] = [];

export const projectNotification = (envelope: Envelope): void => {
  if (envelope.eventType !== 'notification.nda_signature_request') {
    return;
  }
  inbox.push(renderMessage(envelope.payload));
};

export const readInbox = (): readonly string[] => inbox;
