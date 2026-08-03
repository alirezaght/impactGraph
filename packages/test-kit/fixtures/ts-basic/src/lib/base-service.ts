export interface Searchable {
  search(term: string): string[];
}

export class BaseService {
  protected name = 'base';
}
