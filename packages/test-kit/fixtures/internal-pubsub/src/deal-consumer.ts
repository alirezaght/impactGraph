import { Subscribe } from '@company/messaging';

export class DealEventsConsumer {
  @Subscribe('deal-events')
  onDealEvent(payload: string): void {
    void payload;
  }
}
