import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cliAcceptDeviationOutputSchema,
  cliSelectOptionOutputSchema,
  EXIT_CODES,
} from '@impactgraph/contracts';
import {
  artifactsPath,
  createImpactAnalysisArtifactStore,
  createSpecificationArtifactStore,
} from '@impactgraph/persistence';
import { saveReviewArtifact } from '@impactgraph/workspace-engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

import type { CliReviewOutput } from '@impactgraph/contracts';
import type { ImpactAnalysis, Specification } from '@impactgraph/domain';

// Stories 6.6/15.4 + 11.2 on the CLI surface. Artifacts are written directly — these commands
// operate purely on stored artifacts, no git or index required.

interface CliRun {
  readonly code: number;
  readonly lines: string[];
  readonly json: () => unknown;
}

const SPEC: Specification = {
  id: 'spec-vis',
  title: 'Deal visibility',
  sourceType: 'markdown',
  rawText: '# Deal visibility\nExpired deals become invisible.',
  version: 1,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:00:00.000Z',
  requirements: [],
  actors: [],
  constraints: [],
  openQuestions: [],
  decisions: [],
};

const ANALYSIS: ImpactAnalysis = {
  id: 'analysis-vis-1',
  specificationId: 'spec-vis',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-01T08:10:00.000Z',
  status: 'draft',
  requirementImpacts: [],
  architecturalOptions: [
    {
      id: 'option:querytime',
      title: 'Query-time filter',
      description: 'Filter expired deals at read time. (AI-assisted interpretation.)',
      affectedNodeIds: [],
    },
  ],
  warnings: [],
  userDecisions: [],
};

const REVIEW_DOCUMENT: CliReviewOutput = {
  schemaVersion: 1,
  command: 'review',
  reviewId: 'review-analysis-vis-1-a',
  analysis: {
    id: 'analysis-vis-1',
    specificationId: 'spec-vis',
    specificationVersion: 1,
    approvedSnapshotId: 'snap-1',
  },
  target: 'working-tree',
  reviewSnapshotId: 'snap-2',
  changedFiles: ['src/rogue.ts', 'src/gone.ts'],
  findings: [
    {
      category: 'unexpected',
      nodeId: 'sym:rogue',
      nodeName: 'rogue',
      explanation: 'changed but not in the approved analysis',
      filePaths: ['src/rogue.ts'],
    },
    {
      category: 'missing',
      nodeId: 'sym:gone',
      nodeName: 'gone',
      explanation: 'required impact unchanged',
      filePaths: ['src/gone.ts'],
    },
  ],
  coverage: [],
  edgeChanges: { added: [], removed: [] },
  ruleViolations: [],
  discrepanciesFound: true,
};

describe('decision commands (Stories 6.6/15.4/11.2, PRD §26/§C8/§24.1)', () => {
  let repoDir: string;

  const cli = async (...args: string[]): Promise<CliRun> => {
    const lines: string[] = [];
    const code = await runCli([...args, '--root', repoDir], {
      defaultRoot: repoDir,
      write: (line) => lines.push(line),
    });
    return { code, lines, json: () => JSON.parse(lines.join('\n')) as unknown };
  };

  beforeEach(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-decisions-'));
    await cli('init');
    const specSaved = await createSpecificationArtifactStore(artifactsPath(repoDir)).saveVersion(
      SPEC,
    );
    const analysisSaved = await createImpactAnalysisArtifactStore(artifactsPath(repoDir)).save(
      ANALYSIS,
    );
    const reviewSaved = saveReviewArtifact(repoDir, {
      schemaVersion: 1,
      id: 'review-analysis-vis-1-a',
      createdAt: '2026-08-01T09:00:00.000Z',
      document: REVIEW_DOCUMENT,
      acceptedDeviations: [],
    });
    if (!specSaved.ok || !analysisSaved.ok || !reviewSaved.ok) {
      throw new Error('fixture artifacts failed to persist');
    }
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('select-option records the decision on spec vN+1 and validates its JSON output', async () => {
    const run = await cli(
      'select-option',
      'analysis-vis-1',
      'option:querytime',
      '--format',
      'json',
    );
    expect(run.code).toBe(EXIT_CODES.success);
    const output = cliSelectOptionOutputSchema.parse(run.json());
    expect(output.specificationVersion).toBe(2);
    expect(output.optionId).toBe('option:querytime');

    const v2 = await createSpecificationArtifactStore(artifactsPath(repoDir)).getVersion(
      'spec-vis',
      2,
    );
    expect(v2.ok && v2.value?.decisions[0]?.optionId).toBe('option:querytime');
  });

  it('select-option fails typed on unknown options and missing arguments', async () => {
    const ghost = await cli('select-option', 'analysis-vis-1', 'option:ghost');
    expect(ghost.code).toBe(EXIT_CODES.configurationError);
    const noArgs = await cli('select-option');
    expect(noArgs.code).toBe(EXIT_CODES.configurationError);
  });

  it('review accept appends the §24.1 decision to the latest review', async () => {
    const run = await cli(
      'review',
      'accept',
      'sym:rogue',
      'intentional helper',
      '--format',
      'json',
    );
    expect(run.code).toBe(EXIT_CODES.success);
    const output = cliAcceptDeviationOutputSchema.parse(run.json());
    expect(output.reviewId).toBe('review-analysis-vis-1-a');
    expect(output.category).toBe('unexpected');
    expect(output.acceptedDeviationCount).toBe(1);

    // markdown after a second acceptance renders the filled §38.2 section
    const markdown = await cli(
      'review',
      'accept',
      'sym:gone',
      'descoped for this release',
      'missing',
      '--format',
      'markdown',
    );
    expect(markdown.code).toBe(EXIT_CODES.success);
    const report = markdown.lines.join('\n');
    expect(report).toContain('## Accepted Deviations');
    expect(report).toContain('accepted (unexpected): intentional helper');
    expect(report).toContain('accepted (missing): descoped for this release');
  });

  it('review accept rejects unknown findings, bad categories, and double acceptance', async () => {
    const ghost = await cli('review', 'accept', 'sym:ghost', 'x');
    expect(ghost.code).toBe(EXIT_CODES.configurationError);
    const badCategory = await cli('review', 'accept', 'sym:rogue', 'x', 'matched');
    expect(badCategory.code).toBe(EXIT_CODES.configurationError);
    await cli('review', 'accept', 'sym:rogue', 'once');
    const twice = await cli('review', 'accept', 'sym:rogue', 'twice');
    expect(twice.code).toBe(EXIT_CODES.configurationError);
  });
});
