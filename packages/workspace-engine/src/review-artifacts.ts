import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { reviewArtifactSchema } from '@impactgraph/contracts';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { CliReviewOutput, ReviewArtifactDto } from '@impactgraph/contracts';

// Story 11.2 — persisted review artifacts (§24.1, §28). The review document is frozen at
// write time; accepted-deviation decisions APPEND. A re-run review is a NEW artifact and
// never inherits prior acceptance — each review binds its own decisions.

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const reviewArtifactsDir = (rootDir: string): string =>
  join(rootDir, '.impactgraph', 'artifacts', 'reviews');

const readArtifact = (rootDir: string, id: string): Failable<ReviewArtifactDto | undefined> => {
  const file = join(reviewArtifactsDir(rootDir), `${id}.json`);
  if (!existsSync(file)) {
    return { ok: true, value: undefined };
  }
  try {
    const parsed = reviewArtifactSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      return failWith('configurationError', `stored review '${id}' failed contract validation`);
    }
    return { ok: true, value: parsed.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot read review '${id}': ${message}`);
  }
};

const appendOnlyIssue = (
  previous: ReviewArtifactDto,
  next: ReviewArtifactDto,
): string | undefined => {
  if (JSON.stringify(previous.document) !== JSON.stringify(next.document)) {
    return 'the review document is immutable — only accepted deviations may be appended';
  }
  const prefixIntact = previous.acceptedDeviations.every(
    (decision, index) =>
      JSON.stringify(decision) === JSON.stringify(next.acceptedDeviations[index]),
  );
  return previous.acceptedDeviations.length <= next.acceptedDeviations.length && prefixIntact
    ? undefined
    : 'accepted deviations are append-only';
};

export const saveReviewArtifact = (
  rootDir: string,
  artifact: ReviewArtifactDto,
): Failable<void> => {
  const validated = reviewArtifactSchema.safeParse(artifact);
  if (!validated.success || !SAFE_ID.test(artifact.id)) {
    return failWith('internalError', 'review artifact failed contract validation');
  }
  const existing = readArtifact(rootDir, artifact.id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value !== undefined) {
    const issue = appendOnlyIssue(existing.value, validated.data);
    if (issue !== undefined) {
      return failWith('configurationError', issue);
    }
  }
  try {
    mkdirSync(reviewArtifactsDir(rootDir), { recursive: true });
    const target = join(reviewArtifactsDir(rootDir), `${artifact.id}.json`);
    writeFileSync(`${target}.tmp`, JSON.stringify(validated.data, null, 2), 'utf8');
    renameSync(`${target}.tmp`, target);
    return { ok: true, value: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot persist review artifact: ${message}`);
  }
};

/** Persist a freshly produced review document as a new artifact (empty decision list). */
export const persistReviewDocument = (
  rootDir: string,
  document: CliReviewOutput,
): Failable<void> => {
  if (document.reviewId === undefined) {
    return failWith('internalError', 'review document has no reviewId to persist under');
  }
  return saveReviewArtifact(rootDir, {
    schemaVersion: 1,
    id: document.reviewId,
    createdAt: new Date().toISOString(),
    document,
    acceptedDeviations: [],
  });
};

const loadById = (rootDir: string, reviewId: string): Failable<ReviewArtifactDto> => {
  if (!SAFE_ID.test(reviewId)) {
    return failWith('configurationError', `unsafe review id '${reviewId}'`);
  }
  const loaded = readArtifact(rootDir, reviewId);
  if (!loaded.ok) {
    return loaded;
  }
  return loaded.value === undefined
    ? failWith('configurationError', `review not found: ${reviewId}`)
    : { ok: true, value: loaded.value };
};

const loadLatest = (rootDir: string): Failable<ReviewArtifactDto> => {
  const dir = reviewArtifactsDir(rootDir);
  const names = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
  let latest: ReviewArtifactDto | undefined;
  for (const name of names) {
    const loaded = readArtifact(rootDir, name.slice(0, -'.json'.length));
    const candidate = loaded.ok ? loaded.value : undefined;
    if (
      candidate !== undefined &&
      (latest === undefined || candidate.createdAt > latest.createdAt)
    ) {
      latest = candidate;
    }
  }
  return latest === undefined
    ? failWith('configurationError', 'no stored review — run `impactgraph review` first')
    : { ok: true, value: latest };
};

/** Load a stored review by id, or the most recently created one when id is omitted. */
export const loadReviewArtifact = (
  rootDir: string,
  reviewId?: string,
): Failable<ReviewArtifactDto> =>
  reviewId === undefined ? loadLatest(rootDir) : loadById(rootDir, reviewId);
