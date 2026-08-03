import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class DealsService {
  findAll(): string[] {
    return [];
  }

  create(): void {}

  @Cron('0 * * * *')
  refreshExpired(): void {}

  @OnEvent('deal.updated')
  onDealUpdated(): void {}
}
