import { describe, expect, it } from 'vitest';

import { createImpactAnalysis } from '../impact/impact-analysis.js';

import { createActualImpact } from './actual-impact.js';
import { measureAnalysis } from './measure.js';

import type { ActualImpact } from './actual-impact.js';
import type { ImpactEvidenceType } from '../impact/evidence-basis.js';
import type { ImpactAnalysis, ImpactLikelihood } from '../impact/impact-analysis.js';

// Item 12: precision, recall and ranking quality of one prediction against one recorded outcome.

const impact = (
  nodeId: string,
  likelihood: ImpactLikelihood,
  evidenceTypes: readonly ImpactEvidenceType[] = ['direct-structural'],
  confidence = 0.8,
) => ({
  requirementId: 'req-1',
  nodeId,
  likelihood,
  impactType: 'domain-model' as const,
  directness: 'direct' as const,
  confidence,
  confidenceSignals: [{ type: 'direct-observation' as const, contribution: 1 }],
  explanation: `predicted ${nodeId}`,
  expectedChanges: ['review it'],
  evidenceIds: ['ev-1'],
  dependencyPath: [nodeId],
  provenance: 'static-analysis' as const,
  evidenceTypes,
});

const analysisWith = (impacts: readonly ReturnType<typeof impact>[]): ImpactAnalysis => {
  const created = createImpactAnalysis({
    id: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-04T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: impacts,
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const outcomeWith = (overrides: Partial<ActualImpact>): ActualImpact => {
  const created = createActualImpact({
    id: 'outcome-1',
    analysisId: 'analysis-1',
    specificationId: 'spec-1',
    specificationVersion: 1,
    recordedAt: '2026-08-05T10:00:00.000Z',
    changedFiles: [],
    addedFiles: [],
    removedFiles: [],
    changedSymbols: [],
    relationshipChanges: [],
    contractsChanged: [],
    migrationsChanged: [],
    manualFindings: [],
    ...overrides,
  });
  if (!created.ok) {
    throw new Error(created.error.issues.map((issue) => issue.message).join('; '));
  }
  return created.value;
};

const paths = new Map([
  ['n:a', 'src/a.ts'],
  ['n:b', 'src/b.ts'],
  ['n:c', 'src/c.ts'],
]);

describe('measureAnalysis — precision and recall', () => {
  it('scores a perfect prediction 1.0 on both', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([impact('n:a', 'required'), impact('n:b', 'likely')]),
      actual: outcomeWith({ changedFiles: ['src/a.ts', 'src/b.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.falsePositives).toEqual([]);
    expect(metrics.falseNegatives).toEqual([]);
  });

  it('names the false positives and the basis that produced them', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([
        impact('n:a', 'required'),
        impact('n:b', 'likely', ['transitive-structural']),
      ]),
      actual: outcomeWith({ changedFiles: ['src/a.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.precision).toBe(0.5);
    expect(metrics.recall).toBe(1);
    expect(metrics.falsePositives).toEqual(['src/b.ts']);
    // The actionable half: which rule produced the noise.
    expect(metrics.falsePositiveBases).toEqual(['transitive-structural']);
  });

  it('names the false negatives', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([impact('n:a', 'required')]),
      actual: outcomeWith({ changedFiles: ['src/a.ts', 'src/unpredicted.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.recall).toBe(0.5);
    expect(metrics.falseNegatives).toEqual(['src/unpredicted.ts']);
  });

  it('does not judge lexical-only predictions — they are not predictions', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([
        impact('n:a', 'required'),
        impact('n:b', 'lexical-only', ['lexical-only']),
      ]),
      actual: outcomeWith({ changedFiles: ['src/a.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.precision).toBe(1);
    expect(metrics.judgedTiers).toEqual(['required', 'likely']);
  });

  it('omits precision rather than reporting 0 when there was nothing to judge', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([impact('n:a', 'possible')]),
      actual: outcomeWith({ changedFiles: ['src/a.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.precision).toBeUndefined();
    expect(metrics.recall).toBe(0);
  });
});

describe('measureAnalysis — ranking quality', () => {
  it('rewards putting the changed file first', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([
        impact('n:a', 'required', ['direct-structural'], 0.9),
        impact('n:b', 'likely', ['direct-structural'], 0.5),
      ]),
      actual: outcomeWith({ changedFiles: ['src/a.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.rankingQuality).toBe(1);
  });

  it('penalizes burying it below a stronger-looking prediction', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([
        impact('n:a', 'required', ['direct-structural'], 0.9),
        impact('n:b', 'likely', ['direct-structural'], 0.5),
      ]),
      actual: outcomeWith({ changedFiles: ['src/b.ts'] }),
      pathByNodeId: paths,
    });
    expect(metrics.rankingQuality).toBe(0.5);
  });
});

describe('measureAnalysis — missed categories and relationship types', () => {
  it('reports an added locale file as a missed artifact category', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([impact('n:a', 'required')]),
      actual: outcomeWith({
        changedFiles: ['src/a.ts'],
        addedFiles: ['app/locales/fr.json'],
      }),
      pathByNodeId: paths,
    });
    expect(metrics.missedArtifactCategories).toContain('new-locale-entry');
  });

  it('credits the analysis when it did predict the category', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([impact('n:a', 'required')]),
      actual: outcomeWith({
        changedFiles: ['src/a.ts'],
        addedFiles: ['app/locales/fr.json'],
      }),
      pathByNodeId: paths,
      predictedArtifactCategories: ['new-locale-entry'],
    });
    expect(metrics.missedArtifactCategories).toEqual([]);
  });

  it('reports a relationship type the prediction never crossed', () => {
    const metrics = measureAnalysis({
      analysis: analysisWith([impact('n:a', 'required')]),
      actual: outcomeWith({
        changedFiles: ['src/a.ts'],
        relationshipChanges: [
          { type: 'PUBLISHES', sourceId: 'n:a', targetId: 'topic:x', kind: 'added' },
          { type: 'CALLS', sourceId: 'n:a', targetId: 'n:b', kind: 'added' },
        ],
      }),
      pathByNodeId: paths,
      predictedRelationshipTypes: new Set(['CALLS']),
    });
    expect(metrics.missedRelationshipTypes).toEqual(['PUBLISHES']);
  });
});

describe('createActualImpact', () => {
  it('refuses a record that names no change and no finding', () => {
    const created = createActualImpact({
      id: 'outcome-2',
      analysisId: 'analysis-1',
      specificationId: 'spec-1',
      specificationVersion: 1,
      recordedAt: '2026-08-05T10:00:00.000Z',
      changedFiles: [],
      addedFiles: [],
      removedFiles: [],
      changedSymbols: [],
      relationshipChanges: [],
      contractsChanged: [],
      migrationsChanged: [],
      manualFindings: [],
    });
    expect(created.ok).toBe(false);
  });

  it('accepts a record that names only a manual finding', () => {
    const created = createActualImpact({
      id: 'outcome-3',
      analysisId: 'analysis-1',
      specificationId: 'spec-1',
      specificationVersion: 1,
      recordedAt: '2026-08-05T10:00:00.000Z',
      changedFiles: [],
      addedFiles: [],
      removedFiles: [],
      changedSymbols: [],
      relationshipChanges: [],
      contractsChanged: [],
      migrationsChanged: [],
      manualFindings: [{ note: 'the null deadline crashed the renderer', kind: 'risk' }],
    });
    expect(created.ok).toBe(true);
  });
});
