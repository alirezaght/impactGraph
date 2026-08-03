import type { StorageError } from './index-store.js';
import type { ClarificationRecord, Result } from '@impactgraph/domain';

/**
 * Append-only clarification-ADR store (PRD §C9, §C11): decisions of the ANALYZED project,
 * persisted as versioned artifacts. Records are immutable — a changed decision is a new record.
 */
export interface ClarificationStorePort {
  save(record: ClarificationRecord): Promise<Result<void, StorageError>>;
  listAll(): Promise<Result<readonly ClarificationRecord[], StorageError>>;
}
