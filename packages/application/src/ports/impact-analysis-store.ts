import type { StorageError } from './index-store.js';
import type { ImpactAnalysis, Result } from '@impactgraph/domain';

/**
 * Append-only analysis artifact store (PRD §40.3). Re-saving an analysis id is legal only for
 * forward status transitions (draft → reviewed → approved → superseded) and decision appends
 * on unapproved analyses; any other content change is rejected.
 */
export interface ImpactAnalysisStorePort {
  save(analysis: ImpactAnalysis): Promise<Result<void, StorageError>>;
  get(id: string): Promise<Result<ImpactAnalysis | undefined, StorageError>>;
  listBySpecification(
    specificationId: string,
  ): Promise<Result<readonly ImpactAnalysis[], StorageError>>;
  listAll(): Promise<Result<readonly ImpactAnalysis[], StorageError>>;
}
