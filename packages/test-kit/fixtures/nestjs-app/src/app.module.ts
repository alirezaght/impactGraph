import { Module } from '@nestjs/common';

import { DealsModule } from './deals/deals.module';

@Module({
  imports: [DealsModule],
})
export class AppModule {}
