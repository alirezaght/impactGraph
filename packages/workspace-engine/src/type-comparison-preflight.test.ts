import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSpecification } from '@impactgraph/domain';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCoveragePreflight } from './coverage-preflight.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { performIndexRun } from './indexing.js';
import { initializeWorkspace } from './workspace.js';

import type { WorkspaceRepositoryContext } from './repository-coverage.js';
import type { ImpactAnalysis, KnowledgeGraph, Specification } from '@impactgraph/domain';

// ADR-0020 §4, end to end — the field failure this whole change exists for. The fastapi-app
// fixture declares `id = Column(UUID, primary_key=True)` on `Listing` (app/listings.py) and
// handles `= ANY(` correctly elsewhere (app/queries.py). A specification proposing
// `listing.id = ANY(:listing_ids)` must produce a type-sensitive-comparison WARNING that quotes
// the declaration and points at the analogous SQL — from a real index, not a synthetic graph.

const CREATED_AT = '2026-08-14T10:00:00.000Z';

const specificationWith = (rawText: string): Specification => {
  const created = createSpecification({
    id: 'spec-sql',
    title: 'listing deactivation',
    sourceType: 'markdown',
    rawText,
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    requirements: [
      {
        id: 'req-1',
        statement: 'Deactivate the listings named by the import batch.',
        type: 'functional' as const,
        concepts: [],
        actors: [],
        status: 'draft' as const,
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [],
    decisions: [],
  });
  if (!created.ok) {
    throw new Error('bad fixture spec');
  }
  return created.value;
};

const analysisFor = (snapshotId: string): ImpactAnalysis => ({
  id: 'analysis-sql',
  specificationId: 'spec-sql',
  specificationVersion: 1,
  repositorySnapshotId: snapshotId,
  createdAt: CREATED_AT,
  status: 'draft',
  // One structural impact on the indexed model keeps the workspace-coverage verdict 'adequate' —
  // this suite is about the SQL comparison, not about coverage classification.
  requirementImpacts: [
    {
      requirementId: 'req-1',
      nodeId: 'symbol:app/listings.py#Listing',
      likelihood: 'required',
      impactType: 'domain-model',
      directness: 'direct',
      confidence: 0.9,
      confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
      explanation: 'matched',
      expectedChanges: ['review'],
      evidenceIds: ['ev-1'],
      dependencyPath: ['symbol:app/listings.py#Listing'],
      provenance: 'static-analysis',
      evidenceTypes: ['direct-structural'],
    },
  ],
  architecturalOptions: [],
  warnings: [],
  userDecisions: [],
});

const fullyIndexed: WorkspaceRepositoryContext = {
  repositories: [{ name: '(workspace root)', indexed: true, fileCount: 12 }],
  candidates: [],
  limitations: [],
};

describe('type-sensitive SQL comparisons against a real index (ADR-0020 §4)', () => {
  let repoDir: string;
  let graph: KnowledgeGraph;
  let snapshotId: string;

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-typecmp-'));
    cpSync(fixtureRepoPath('fastapi-app'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'typecmp@test.dev');
    git('config', 'user.name', 'TypeCmp');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    const current = await withIndexStore(repoDir, async (store) => loadCurrentGraph(store));
    if (!current.ok) {
      throw new Error('graph unavailable');
    }
    graph = current.value.graph;
    snapshotId = current.value.snapshotId;
  }, 60_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  const preflightFor = async (rawText: string) => {
    const specification = specificationWith(rawText);
    const run = await runCoveragePreflight(
      {
        rootDir: repoDir,
        specification,
        specificationText: rawText,
        analysis: analysisFor(snapshotId),
        graph,
        snapshotId,
      },
      fullyIndexed,
    );
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    return run.value;
  };

  it('warns, quoting the UUID declaration AND the analogous correctly-handled SQL', async () => {
    const outcome = await preflightFor(
      [
        'Deactivate the imported listings:',
        '```sql',
        'UPDATE listings SET active = false WHERE listing.id = ANY(:listing_ids)',
        '```',
      ].join('\n'),
    );
    const finding = outcome.findings.find(
      (candidate) => candidate.kind === 'type-sensitive-comparison',
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    // The declaration: name, verbatim type, and the model file that states it.
    expect(finding?.statement).toContain('Listing.id');
    expect(finding?.statement).toContain("'UUID'");
    expect(finding?.statement).toContain('app/listings.py');
    // The analogous SQL: the fixture's correctly-cast `= ANY(` literal, found via call facts.
    expect(finding?.recommendation).toContain('app/queries.py');
    expect(finding?.recommendation).toContain('compare the binding');
    expect(finding?.subject.filePaths).toContain('app/listings.py');
    expect(outcome.assessment.counts.typeSensitiveComparisons).toBe(1);
    expect(outcome.assessment.feasibility).toBe('READY_WITH_WARNINGS');
  });

  it('stays silent for a string-typed column — Listing.title is String(120)', async () => {
    const outcome = await preflightFor(
      'Rename rows using UPDATE listings SET x = 1 WHERE listing.title = :title.',
    );
    expect(
      outcome.findings.some((candidate) => candidate.kind === 'type-sensitive-comparison'),
    ).toBe(false);
  });

  it('stays silent for a column the index does not declare', async () => {
    const outcome = await preflightFor(
      'Run DELETE FROM listings WHERE listing.legacy_ref = ANY(:refs).',
    );
    expect(
      outcome.findings.some((candidate) => candidate.kind === 'type-sensitive-comparison'),
    ).toBe(false);
  });
});
