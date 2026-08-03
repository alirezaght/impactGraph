import type { StorageError } from './index-store.js';
import type { Result, Specification } from '@impactgraph/domain';

/**
 * Append-only specification artifact store (ADR-0006: versioned JSON artifacts are the system
 * of record). Saving an existing (id, version) pair is an error — versions are immutable.
 */
export interface SpecificationStorePort {
  saveVersion(specification: Specification): Promise<Result<void, StorageError>>;
  getVersion(id: string, version: number): Promise<Result<Specification | undefined, StorageError>>;
  getLatest(id: string): Promise<Result<Specification | undefined, StorageError>>;
  listVersions(id: string): Promise<Result<readonly number[], StorageError>>;
}
