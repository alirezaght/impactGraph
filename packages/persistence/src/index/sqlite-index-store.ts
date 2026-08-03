import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

import { storageError } from '@impactgraph/application';
import { err, ok } from '@impactgraph/domain';
import Database from 'better-sqlite3';

import { runMigrations } from './migrations.js';
import { SqliteIndexStore } from './store.js';

import type { IndexStorePort, StorageError } from '@impactgraph/application';
import type { Result } from '@impactgraph/domain';
import type { Database as DatabaseHandle } from 'better-sqlite3';

const openVerified = (dbPath: string): DatabaseHandle => {
  const db = new Database(dbPath);
  try {
    db.pragma('quick_check', { simple: true });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

/** Rename the unreadable file out of the way — quarantined, never deleted (PRD §34). */
const quarantine = (dbPath: string): void => {
  renameSync(dbPath, `${dbPath}.corrupt-${String(Date.now())}`);
};

const openWithRecovery = (dbPath: string): DatabaseHandle => {
  try {
    return openVerified(dbPath);
  } catch (error) {
    // Only an EXISTING file can be corrupt. Every other failure — the native module not
    // loading, permissions, a full disk — must surface AS ITSELF: quarantining would rename a
    // file that may not exist, and the resulting ENOENT would replace the real cause with a
    // false corruption report. Found by the §42.4 electron suite, where a missing
    // better-sqlite3 binding was reported as index corruption.
    if (!existsSync(dbPath)) {
      throw error;
    }
    quarantine(dbPath);
    return openVerified(dbPath);
  }
};

/**
 * Open (or create) the SQLite repository index at dbPath. A corrupt existing file is
 * quarantined and a fresh index is created — the index is a disposable cache (ADR-0006);
 * artifacts and config are never touched by index recovery.
 */
export const openSqliteIndexStore = (dbPath: string): Result<IndexStorePort, StorageError> => {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = openWithRecovery(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return ok(new SqliteIndexStore(db));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(storageError('io', `failed to open index store: ${message}`));
  }
};
