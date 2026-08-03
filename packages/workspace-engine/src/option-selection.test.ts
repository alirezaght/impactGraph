import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  artifactsPath,
  createImpactAnalysisArtifactStore,
  createSpecificationArtifactStore,
} from '@impactgraph/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectArchitecturalOption } from './option-selection.js';
import { initializeWorkspace } from './workspace.js';

import type { ImpactAnalysis, Specification } from '@impactgraph/domain';

// Story 6.6/15.4 — selecting a §C8/§26 option records a human-confirmed
// ArchitecturalDecision on specification version N+1. The analysis (even approved)
// is never touched. Artifacts are written directly — options need no live interpreter here.

const SPEC: Specification = {
  id: 'spec-visibility',
  title: 'Deal visibility',
  sourceType: 'markdown',
  rawText: '# Deal visibility\nExpired deals become invisible after 90 days.',
  version: 1,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:00:00.000Z',
  requirements: [],
  actors: [],
  constraints: [],
  openQuestions: [
    {
      id: 'question:visibility',
      question: "'Query-time filter' or 'Materialized flag'?",
      reason: 'competing interpretations produce materially different impact footprints',
      affectedRequirementIds: [],
      severity: 'blocking',
      status: 'open',
    },
  ],
  decisions: [],
};

const ANALYSIS: ImpactAnalysis = {
  id: 'analysis-spec-visibility-v1-test',
  specificationId: 'spec-visibility',
  specificationVersion: 1,
  repositorySnapshotId: 'snap-1',
  createdAt: '2026-08-01T08:10:00.000Z',
  status: 'approved',
  requirementImpacts: [],
  architecturalOptions: [
    {
      id: 'option:querytime',
      title: 'Query-time filter',
      description:
        'Filter expired deals at read time. Affects DealQueryService. (AI-assisted interpretation — selecting it answers the linked question.)',
      affectedNodeIds: [],
      linkedQuestionId: 'question:visibility',
    },
    {
      id: 'option:unlinked',
      title: 'Legacy option without a question link',
      description: 'Options generated before §C8 linking carry no question id.',
      affectedNodeIds: [],
    },
  ],
  warnings: [],
  userDecisions: [],
};

/** §C8: selecting an option also resolves the question it was generated to answer. */
const expectQuestionResolved = (outcome: {
  answeredQuestionId?: string | undefined;
  specification: Specification;
}): void => {
  expect(outcome.answeredQuestionId).toBe('question:visibility');
  const question = outcome.specification.openQuestions[0];
  expect(question?.status).toBe('answered');
  expect(question?.answer).toContain('Query-time filter');
  // the question record survives — answered, never deleted (§40.2)
  expect(question?.question).toContain('Materialized flag');
};

describe('selectArchitecturalOption (Story 6.6/15.4, PRD §26/§C8)', () => {
  let rootDir: string;

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'impactgraph-select-'));
    const initialized = initializeWorkspace(rootDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    const specSaved = await createSpecificationArtifactStore(artifactsPath(rootDir)).saveVersion(
      SPEC,
    );
    const analysisSaved = await createImpactAnalysisArtifactStore(artifactsPath(rootDir)).save(
      ANALYSIS,
    );
    if (!specSaved.ok || !analysisSaved.ok) {
      throw new Error('fixture artifacts failed to persist');
    }
  });

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('unknown option and unknown analysis fail typed, never throw', async () => {
    const ghostOption = await selectArchitecturalOption({
      rootDir,
      analysisId: ANALYSIS.id,
      optionId: 'option:ghost',
    });
    expect(ghostOption.ok).toBe(false);
    if (!ghostOption.ok) {
      expect(ghostOption.error.category).toBe('configurationError');
      expect(ghostOption.error.message).toContain('option');
    }
    const ghostAnalysis = await selectArchitecturalOption({
      rootDir,
      analysisId: 'analysis-ghost',
      optionId: 'option:querytime',
    });
    expect(ghostAnalysis.ok).toBe(false);
  });

  it('appends spec vN+1 with a human-confirmed decision referencing the option id', async () => {
    const selected = await selectArchitecturalOption({
      rootDir,
      analysisId: ANALYSIS.id,
      optionId: 'option:querytime',
      modifiedDescription: 'Filter at query time, but keep expired deals on the detail page.',
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) {
      return;
    }
    expect(selected.value.specification.version).toBe(2);
    const decision = selected.value.specification.decisions[0];
    expect(decision?.id).toBe(selected.value.decisionId);
    expect(decision?.optionId).toBe('option:querytime');
    // the decision records the user-modified form and the human-confirmed selection semantics
    expect(decision?.decision).toContain('Query-time filter');
    expect(decision?.decision).toContain('keep expired deals on the detail page');
    expect(decision?.reason).toContain('user selected');
    expect(decision?.reason).toContain('AI-assisted');

    expectQuestionResolved(selected.value);
  });

  it('re-selecting does not re-answer an already-resolved question (§40.2)', async () => {
    const again = await selectArchitecturalOption({
      rootDir,
      analysisId: ANALYSIS.id,
      optionId: 'option:querytime',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) {
      return;
    }
    // the decision is appended again (every selection is history), but the question was
    // already answered by the first selection — its recorded answer is not overwritten
    expect(again.value.answeredQuestionId).toBeUndefined();
    expect(again.value.specification.openQuestions[0]?.status).toBe('answered');
    expect(again.value.specification.decisions.length).toBeGreaterThan(1);
  });

  it('an option without a link records the decision and leaves questions untouched', async () => {
    const selected = await selectArchitecturalOption({
      rootDir,
      analysisId: ANALYSIS.id,
      optionId: 'option:unlinked',
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) {
      return;
    }
    expect(selected.value.answeredQuestionId).toBeUndefined();
    expect(selected.value.decisionId.length).toBeGreaterThan(0);
  });

  it('never mutates the analysis — the approved artifact is byte-identical history (§40.3)', async () => {
    const store = createImpactAnalysisArtifactStore(artifactsPath(rootDir));
    const reloaded = await store.get(ANALYSIS.id);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value).toEqual(ANALYSIS);
    }
    // and the original specification version is untouched (append-only, §40.2)
    const v1 = await createSpecificationArtifactStore(artifactsPath(rootDir)).getVersion(
      SPEC.id,
      1,
    );
    expect(v1.ok && v1.value?.decisions).toEqual([]);
  });
});
