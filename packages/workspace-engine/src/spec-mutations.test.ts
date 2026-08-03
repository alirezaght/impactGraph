import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listAnalyses } from './analyses.js';
import { performIndexRun } from './indexing.js';
import {
  confirmRequirement,
  dismissQuestion,
  editRequirement,
  rejectRequirement,
} from './spec-mutations.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { Specification } from '@impactgraph/domain';

// Story 5.4 — end-to-end staleness derivation: submit spec → analyze → mutate spec →
// listAnalyses flags the analysis stale. The stored analysis artifact itself is untouched
// (append-only, §40.2); `stale` is derived at read time from the current spec version.

const SPEC_TEXT = [
  '# Order visibility',
  'Expired orders must be hidden from search.',
  'Advisors must still see expired orders on the detail page.',
].join('\n');

describe('specification mutations mark analyses stale (Story 5.4)', () => {
  let repoDir: string;
  let specification: Specification;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-spec-mut-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'spec@test.dev');
    git('config', 'user.name', 'Spec');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    git('add', '.');
    git('commit', '-m', 'init impactgraph');
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    const submitted = await submitSpecification({
      rootDir: repoDir,
      specName: 'order-visibility.md',
      rawText: SPEC_TEXT,
    });
    if (!submitted.ok) {
      throw new Error(submitted.error.message);
    }
    specification = submitted.value.specification;
    const built = await buildAnalysisForSpecification(repoDir, specification);
    if (!built.ok) {
      throw new Error(built.error.message);
    }
  }, 120_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('an analysis built from the current spec version is not stale', async () => {
    const listed = await listAnalyses(repoDir);
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.specificationVersion).toBe(specification.version);
    expect(listed.value[0]?.stale).toBe(false);
  });

  it('confirming a requirement appends version N+1 and flags the analysis stale', async () => {
    const requirementId = specification.requirements[0]?.id ?? '';
    const confirmed = await confirmRequirement({
      rootDir: repoDir,
      specificationId: specification.id,
      requirementId,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.value.version).toBe(specification.version + 1);
    expect(confirmed.value.requirements.find((entry) => entry.id === requirementId)?.status).toBe(
      'confirmed',
    );

    const listed = await listAnalyses(repoDir);
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    // the stored analysis is untouched (append-only): same version it was built from
    expect(listed.value[0]?.specificationVersion).toBe(specification.version);
    expect(listed.value[0]?.stale).toBe(true);
  });

  it('editing a statement keeps the original requirement id and appends another version', async () => {
    const requirementId = specification.requirements[0]?.id ?? '';
    const edited = await editRequirement({
      rootDir: repoDir,
      specificationId: specification.id,
      requirementId,
      statement: 'Expired orders must be filtered from search at query time.',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) {
      return;
    }
    expect(edited.value.version).toBe(specification.version + 2);
    const requirement = edited.value.requirements.find((entry) => entry.id === requirementId);
    expect(requirement?.statement).toBe(
      'Expired orders must be filtered from search at query time.',
    );
    expect(edited.value.rawText).toBe(SPEC_TEXT);
  });

  it('rejecting a requirement preserves the record and stays append-only', async () => {
    const requirementId = specification.requirements[0]?.id ?? '';
    const rejected = await rejectRequirement({
      rootDir: repoDir,
      specificationId: specification.id,
      requirementId,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) {
      return;
    }
    expect(rejected.value.version).toBe(specification.version + 3);
    expect(rejected.value.requirements.find((entry) => entry.id === requirementId)?.status).toBe(
      'rejected',
    );
    const listed = await listAnalyses(repoDir);
    expect(listed.ok && listed.value[0]?.stale).toBe(true);
  });

  it('mutations fail typed, never throw: unknown ids and unknown specs', async () => {
    const unknownQuestion = await dismissQuestion({
      rootDir: repoDir,
      specificationId: specification.id,
      questionId: 'ghost-question',
    });
    expect(unknownQuestion.ok).toBe(false);
    if (!unknownQuestion.ok) {
      expect(unknownQuestion.error.category).toBe('configurationError');
    }
    const unknownSpec = await confirmRequirement({
      rootDir: repoDir,
      specificationId: 'spec-ghost',
      requirementId: 'r',
    });
    expect(unknownSpec.ok).toBe(false);
  });
});
