import { DealRepository } from '../lib';
import { BaseService, Searchable } from '../lib/base-service';

export const DEFAULT_LIMIT = 25;

export class DealService extends BaseService implements Searchable {
  private readonly repository: DealRepository;

  constructor(repository: DealRepository) {
    super();
    this.repository = repository;
  }

  search(term: string): string[] {
    return this.repository.findAll().filter((deal) => deal.includes(term));
  }
}

export function buildDealService(): DealService {
  return new DealService(new DealRepository());
}
