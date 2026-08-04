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
import { createActualImpact, err, ok } from '@impactgraph/domain';

import type { StorageError } from '@impactgraph/application';
import type { ActualImpact, EvaluationMetrics, Result } from '@impactgraph/domain';

/**
 * Recorded outcomes and their measured accuracy (item 12).
 *
 * STRICTLY append-only, with no update path at all — not even a status transition. An outcome is a
 * historical observation: "on this date, this change touched these files". Allowing it to be edited
 * would let a later opinion rewrite a measurement, and the whole value of these records is that they
 * cannot be. Correcting one means recording a new one.
 */

export const ACTUAL_IMPACT_SCHEMA_VERSION = 1;

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface ActualImpactRecord {
  readonly actual: ActualImpact;
  /** Measured at record time against the analysis as it stood. Never recomputed in place. */
  readonly metrics: EvaluationMetrics;
}

export interface ActualImpactStore {
  save(record: ActualImpactRecord): Result<ActualImpactRecord, StorageError>;
  get(id: string): Result<ActualImpactRecord | undefined, StorageError>;
  listAll(): Result<readonly ActualImpactRecord[], StorageError>;
  /** Every outcome recorded against one analysis, oldest first. */
  listForAnalysis(analysisId: string): Result<readonly ActualImpactRecord[], StorageError>;
}

interface StoredDocument extends ActualImpactRecord {
  readonly schemaVersion: number;
}

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseDocument = (raw: string, file: string): Result<ActualImpactRecord, StorageError> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(storageError('corruption', `${file} is not valid JSON`));
  }
  if (!isRecordLike(parsed) || parsed['schemaVersion'] !== ACTUAL_IMPACT_SCHEMA_VERSION) {
    return err(storageError('corruption', `${file} has an unsupported schemaVersion — expected 1`));
  }
  const actual = createActualImpact(parsed['actual'] as ActualImpact);
  if (!actual.ok) {
    return err(
      storageError('corruption', `${file}: ${actual.error.issues[0]?.message ?? 'invalid record'}`),
    );
  }
  return ok({ actual: actual.value, metrics: parsed['metrics'] as EvaluationMetrics });
};

class FileActualImpactStore implements ActualImpactStore {
  private readonly dir: string;

  public constructor(baseDir: string) {
    this.dir = join(baseDir, 'outcomes');
  }

  public save(record: ActualImpactRecord): Result<ActualImpactRecord, StorageError> {
    const id = record.actual.id;
    if (!SAFE_ID.test(id)) {
      return err(storageError('validation', `unsafe outcome id '${id}'`));
    }
    const file = join(this.dir, `${id}.json`);
    if (existsSync(file)) {
      // Not an error the caller can work around by retrying: recorded outcomes are immutable, and a
      // duplicate id means the caller is trying to change history rather than add to it.
      return err(
        storageError(
          'validation',
          `outcome '${id}' is already recorded — outcomes are append-only, record a new one instead`,
        ),
      );
    }
    const document: StoredDocument = { schemaVersion: ACTUAL_IMPACT_SCHEMA_VERSION, ...record };
    try {
      mkdirSync(this.dir, { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(document, undefined, 2)}\n`, 'utf8');
      renameSync(temporary, file);
    } catch (error) {
      return err(storageError('io', `could not write ${file}: ${String(error)}`));
    }
    return ok(record);
  }

  public get(id: string): Result<ActualImpactRecord | undefined, StorageError> {
    if (!SAFE_ID.test(id)) {
      return err(storageError('validation', `unsafe outcome id '${id}'`));
    }
    const file = join(this.dir, `${id}.json`);
    if (!existsSync(file)) {
      return ok(undefined);
    }
    return parseDocument(readFileSync(file, 'utf8'), file);
  }

  public listAll(): Result<readonly ActualImpactRecord[], StorageError> {
    if (!existsSync(this.dir)) {
      return ok([]);
    }
    const records: ActualImpactRecord[] = [];
    for (const entry of readdirSync(this.dir).sort()) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const parsed = parseDocument(readFileSync(join(this.dir, entry), 'utf8'), entry);
      if (!parsed.ok) {
        return parsed;
      }
      records.push(parsed.value);
    }
    return ok(records.sort((a, b) => a.actual.recordedAt.localeCompare(b.actual.recordedAt)));
  }

  public listForAnalysis(analysisId: string): Result<readonly ActualImpactRecord[], StorageError> {
    const all = this.listAll();
    if (!all.ok) {
      return all;
    }
    return ok(all.value.filter((record) => record.actual.analysisId === analysisId));
  }
}

export const createActualImpactStore = (baseDir: string): ActualImpactStore =>
  new FileActualImpactStore(baseDir);
