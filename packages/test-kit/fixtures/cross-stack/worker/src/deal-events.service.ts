import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

// The import below is RENAMED on purpose (epic-16 line 140). The CALLS edge it produces exists
// ONLY because assembly translates a local alias back to the exported name; before that fix the
// assembler looked `forwardDeal` up in deal-publisher.ts's export table, found nothing, and
// silently dropped the edge.
import { publishDealCreated as forwardDeal } from './deal-publisher';

// Consumes the topic ../infra/main.tf declares as `deal-events`. Nothing here names Terraform, and
// nothing in Terraform names this class — the topic name is the only thing they share.
@Injectable()
export class DealEventsService {
  @OnEvent('deal-events')
  async onDealEvent(): Promise<void> {
    await forwardDeal({ forwarded: true });
  }
}
