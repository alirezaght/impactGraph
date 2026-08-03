import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { storageError } from '@impactgraph/application';
import { err, ok, parseClarification, serializeClarification } from '@impactgraph/domain';

import type { ClarificationStorePort, StorageError } from '@impactgraph/application';
import type { ClarificationRecord, Result } from '@impactgraph/domain';

// Story 15.5 — clarification ADRs as append-only JSON artifacts under
// `.impactgraph/artifacts/clarifications/` (ADR-0006). Atomic writes; never overwritten.

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

class ClarificationArtifactStore implements ClarificationStorePort {
  private readonly dir: string;

  public constructor(baseDir: string) {
    this.dir = join(baseDir, 'clarifications');
  }

  public save(record: ClarificationRecord): Promise<Result<void, StorageError>> {
    if (!SAFE_ID.test(record.id)) {
      return Promise.resolve(
        err(storageError('validation', `unsafe clarification id: ${record.id}`)),
      );
    }
    const target = join(this.dir, `${record.id}.json`);
    if (existsSync(target)) {
      return Promise.resolve(
        err(
          storageError(
            'validation',
            `clarification ${record.id} already exists — records are immutable`,
          ),
        ),
      );
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      const temp = `${target}.tmp`;
      writeFileSync(temp, JSON.stringify(serializeClarification(record), null, 2), 'utf8');
      renameSync(temp, target);
      return Promise.resolve(ok(undefined));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(storageError('io', `cannot write clarification: ${message}`)));
    }
  }

  public listAll(): Promise<Result<readonly ClarificationRecord[], StorageError>> {
    if (!existsSync(this.dir)) {
      return Promise.resolve(ok([]));
    }
    try {
      const records: ClarificationRecord[] = [];
      for (const name of readdirSync(this.dir).sort()) {
        if (!name.endsWith('.json')) {
          continue;
        }
        const parsed = parseClarification(
          JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as unknown,
        );
        if (!parsed.ok) {
          return Promise.resolve(
            err(storageError('validation', `corrupt clarification artifact: ${name}`)),
          );
        }
        records.push(parsed.value);
      }
      return Promise.resolve(ok(records));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.resolve(err(storageError('io', `cannot read clarifications: ${message}`)));
    }
  }
}

export const createClarificationArtifactStore = (baseDir: string): ClarificationStorePort =>
  new ClarificationArtifactStore(baseDir);
