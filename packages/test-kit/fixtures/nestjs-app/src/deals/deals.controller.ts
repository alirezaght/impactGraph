import { Controller, Get, Post } from '@nestjs/common';

import { DealsService } from './deals.service';

@Controller('deals')
export class DealsController {
  constructor(private readonly service: DealsService) {}

  @Get()
  findAll(): string[] {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(): string {
    return 'one';
  }

  @Post()
  create(): void {
    this.service.create();
  }
}
