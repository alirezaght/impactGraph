import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { learningProposalSchema } from '@impactgraph/contracts';

import { failWith } from './failure.js';

import type { Failable } from './failure.js';
import type { ArchitectureRule } from '@impactgraph/application';
import type { ConfigOperationDto, LearningProposalDto } from '@impactgraph/contracts';

// §Z9/§Z16 — the self-improving project model, deterministic half. Corrections and review
// outcomes become PROPOSALS in an append-only queue; applying one goes through the governed
// operation path (§Z6 ownership mode decides). Nothing here changes configuration itself.

export const learningProposalsPath = (rootDir: string): string =>
  join(rootDir, '.impactgraph', 'artifacts', 'learning-proposals.jsonl');

export const appendLearningProposal = (
  rootDir: string,
  proposal: LearningProposalDto,
): Failable<void> => {
  const validated = learningProposalSchema.safeParse(proposal);
  if (!validated.success) {
    return failWith('internalError', 'learning proposal failed contract validation');
  }
  try {
    const path = learningProposalsPath(rootDir);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(validated.data)}\n`, 'utf8');
    return { ok: true, value: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot write learning proposal: ${message}`);
  }
};

export const listLearningProposals = (rootDir: string): Failable<LearningProposalDto[]> => {
  const path = learningProposalsPath(rootDir);
  if (!existsSync(path)) {
    return { ok: true, value: [] };
  }
  try {
    const proposals: LearningProposalDto[] = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      const parsed = learningProposalSchema.safeParse(JSON.parse(line) as unknown);
      if (parsed.success) {
        proposals.push(parsed.data);
      }
    }
    return { ok: true, value: proposals };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failWith('configurationError', `cannot read learning proposals: ${message}`);
  }
};

const SCHEMA_PATTERN = /(^|\/)schema\.prisma$/;
const MIGRATION_PATTERN = /(^|\/)migrations\//;

export interface CoChangeStats {
  /** Commits that touched the trigger pattern. */
  readonly triggerCommits: number;
  /** Of those, how many also touched the companion pattern. */
  readonly togetherCommits: number;
}

/** Deterministic history mining: how often did two patterns change in the same commit? */
export const coChangeStats = (
  commits: readonly (readonly string[])[],
  trigger: RegExp,
  companion: RegExp,
): CoChangeStats => {
  let triggerCommits = 0;
  let togetherCommits = 0;
  for (const files of commits) {
    if (!files.some((file) => trigger.test(file))) {
      continue;
    }
    triggerCommits += 1;
    if (files.some((file) => companion.test(file))) {
      togetherCommits += 1;
    }
  }
  return { triggerCommits, togetherCommits };
};

/**
 * §C7/§Z9 — the historical version of the migration rule: cite REPOSITORY history, not a
 * hunch. Requires at least 3 schema-touching commits with ≥80% accompanied by a migration.
 */
export const historicalCoChangeProposal = (
  commits: readonly (readonly string[])[],
  existingRules: readonly ArchitectureRule[],
): ConfigOperationDto | undefined => {
  const covered = existingRules.some(
    (rule) => rule.type === 'accompanying-change' && SCHEMA_PATTERN.test(rule.whenChanged),
  );
  if (covered) {
    return undefined;
  }
  const stats = coChangeStats(commits, SCHEMA_PATTERN, MIGRATION_PATTERN);
  if (stats.triggerCommits < 3 || stats.togetherCommits / stats.triggerCommits < 0.8) {
    return undefined;
  }
  const schemaFile = commits.flat().find((file) => SCHEMA_PATTERN.test(file));
  const migrationFile = commits.flat().find((file) => MIGRATION_PATTERN.test(file));
  if (schemaFile === undefined || migrationFile === undefined) {
    return undefined;
  }
  return {
    kind: 'add-rule',
    rule: {
      id: 'schema-needs-migration',
      type: 'accompanying-change',
      description: `learned from history: ${String(stats.togetherCommits)} of the last ${String(stats.triggerCommits)} schema changes introduced a migration`,
      whenChanged: schemaFile,
      requireChanged: `${migrationFile.slice(0, migrationFile.indexOf('migrations/'))}migrations/**`,
    },
    reason: `${String(stats.togetherCommits)} of the last ${String(stats.triggerCommits)} commits touching the schema also introduced a migration (§C7)`,
    confidence: Math.min(0.95, stats.togetherCommits / stats.triggerCommits),
  };
};

/**
 * The §Z9 review-outcome case: "migration files always accompany schema changes." When a
 * review's diff contains BOTH a schema change and a migration and no accompanying-change
 * rule covers it yet, propose that rule — evidence-based, never guessed from a single file.
 */
export const reviewCoChangeProposal = (
  changedFiles: readonly string[],
  existingRules: readonly ArchitectureRule[],
): ConfigOperationDto | undefined => {
  const schemaFile = changedFiles.find((path) => SCHEMA_PATTERN.test(path));
  const migrationFile = changedFiles.find((path) => MIGRATION_PATTERN.test(path));
  if (schemaFile === undefined || migrationFile === undefined) {
    return undefined;
  }
  const covered = existingRules.some(
    (rule) => rule.type === 'accompanying-change' && SCHEMA_PATTERN.test(rule.whenChanged),
  );
  if (covered) {
    return undefined;
  }
  const migrationsGlob = `${migrationFile.slice(0, migrationFile.indexOf('migrations/'))}migrations/**`;
  return {
    kind: 'add-rule',
    rule: {
      id: 'schema-needs-migration',
      type: 'accompanying-change',
      description: 'learned from review: schema changes ship with a migration',
      whenChanged: schemaFile,
      requireChanged: migrationsGlob,
    },
    reason: `review observed '${schemaFile}' and '${migrationFile}' changing together (§Z9)`,
    confidence: 0.7,
  };
};
