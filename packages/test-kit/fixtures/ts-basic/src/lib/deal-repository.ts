export class DealRepository {
  findAll(): string[] {
    return [];
  }
}

export function createRepository(): DealRepository {
  return new DealRepository();
}
