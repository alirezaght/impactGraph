/**
 * Loader for `scripts/quality/loc-exceptions.json` — the reviewed, expiring
 * LOC-exception file (ADR-0012). Every entry names an owner, a reason, an
 * expiry date, and the raised limit. Expired or invalid entries fail the run;
 * exceptions are never silently carried forward.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

export type LocExceptionsErrorKind =
  'io' | 'parse' | 'schema' | 'duplicate-path' | 'expired' | 'missing-file';

export class LocExceptionsError extends Error {
  readonly kind: LocExceptionsErrorKind;
  readonly details: readonly string[];

  constructor(kind: LocExceptionsErrorKind, message: string, details: readonly string[] = []) {
    super(details.length > 0 ? `${message}\n  - ${details.join('\n  - ')}` : message);
    this.name = 'LocExceptionsError';
    this.kind = kind;
    this.details = details;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealCalendarDate(value: string): boolean {
  const parts = value.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const locExceptionSchema = z
  .object({
    path: z.string().min(1),
    reason: z.string().min(1),
    owner: z.string().min(1),
    reviewBy: z
      .string()
      .regex(DATE_PATTERN, 'must be a YYYY-MM-DD date')
      .refine(isRealCalendarDate, 'must be a real calendar date'),
    maxLines: z.number().int().min(1),
  })
  .strict();

export const locExceptionsFileSchema = z
  .object({
    $schema: z.string().optional(),
    exceptions: z.array(locExceptionSchema),
  })
  .strict();

export type LocException = z.infer<typeof locExceptionSchema>;

export interface LoadLocExceptionsOptions {
  /** Absolute path of the exceptions JSON file. */
  filePath: string;
  /** Repo root against which exception `path`s are resolved. */
  rootDir: string;
  /** Today as YYYY-MM-DD; defaults to the local date. Injected in tests. */
  today?: string;
  /** File-existence probe; injected in tests. */
  fileExists?: (absolutePath: string) => boolean;
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Loads and fully validates the exceptions file. A missing file is treated as
 * "no exceptions" (the committed file exists in this repo; day-one green).
 * Throws `LocExceptionsError` on malformed JSON, schema violations, duplicate
 * paths, expired entries, or entries referencing files that do not exist.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads the exceptions file; `undefined` means "file does not exist". */
function readExceptionsFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new LocExceptionsError('io', `cannot read ${filePath}: ${errorMessage(error)}`);
  }
}

function parseExceptionsJson(filePath: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new LocExceptionsError('parse', `${filePath} is not valid JSON: ${errorMessage(error)}`);
  }
}

function validateExceptionsSchema(filePath: string, parsed: unknown): LocException[] {
  const result = locExceptionsFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new LocExceptionsError(
      'schema',
      `${filePath} does not match the exceptions schema`,
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data.exceptions;
}

function assertNoDuplicatePaths(filePath: string, entries: readonly LocException[]): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of entries) {
    const key = toPosix(entry.path);
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  if (duplicates.length > 0) {
    throw new LocExceptionsError(
      'duplicate-path',
      `${filePath} contains duplicate exception paths`,
      duplicates,
    );
  }
}

function assertNoneExpired(entries: readonly LocException[], today: string): void {
  const expired = entries.filter((entry) => entry.reviewBy < today);
  if (expired.length > 0) {
    throw new LocExceptionsError(
      'expired',
      `expired LOC exceptions (re-review or remove them; see .claude/templates/loc-exception.md)`,
      expired.map((entry) => `${entry.path} (reviewBy ${entry.reviewBy}, owner ${entry.owner})`),
    );
  }
}

function assertReferencedFilesExist(
  entries: readonly LocException[],
  rootDir: string,
  fileExists: (absolutePath: string) => boolean,
): void {
  const missing = entries.filter((entry) => !fileExists(path.resolve(rootDir, entry.path)));
  if (missing.length > 0) {
    throw new LocExceptionsError(
      'missing-file',
      'LOC exceptions reference files that do not exist',
      missing.map((entry) => entry.path),
    );
  }
}

export function loadLocExceptions(options: LoadLocExceptionsOptions): Map<string, LocException> {
  const raw = readExceptionsFile(options.filePath);
  if (raw === undefined) return new Map();

  const parsed = parseExceptionsJson(options.filePath, raw);
  const entries = validateExceptionsSchema(options.filePath, parsed);
  assertNoDuplicatePaths(options.filePath, entries);
  assertNoneExpired(entries, options.today ?? localToday());
  assertReferencedFilesExist(entries, options.rootDir, options.fileExists ?? existsSync);

  return new Map(entries.map((entry) => [toPosix(entry.path), entry]));
}
