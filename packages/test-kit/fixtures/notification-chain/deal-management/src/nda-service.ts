import { recordOutboxEvent } from './outbox.js';

// The producer side of the observed trial case: a seller requests an NDA signature, and the buyer
// must be notified. Nothing here publishes anything — the write goes to the outbox inside the same
// transaction, and a separate relay turns it into a Pub/Sub message. That indirection is exactly
// why the chain used to be invisible: there is no publish call in the file the specification names.
export interface NdaSignatureRequest {
  readonly dealId: string;
  readonly buyerId: string;
  readonly sellerName: string;
  /** Optional: a seller may request a signature without a deadline. */
  readonly deadline?: string;
}

export class NdaService {
  public requestSignature(request: NdaSignatureRequest): void {
    recordOutboxEvent('notification.nda_signature_request', {
      dealId: request.dealId,
      buyerId: request.buyerId,
      sellerName: request.sellerName,
      deadline: request.deadline,
    });
  }
}
