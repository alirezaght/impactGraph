import { buildDealService } from './deal-service';

export function testBuildDealService(): void {
  const service = buildDealService();
  service.search('deal');
}
