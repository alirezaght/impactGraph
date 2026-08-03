import { createImpactAnalysis } from '@impactgraph/domain';

import type {
  ImpactAnalysis,
  RequirementImpact,
  Requirement,
  Specification,
} from '@impactgraph/domain';

// Builders for hand-constructed impact analyses, used by the impact-export renderer tests.
//
// They exist so those tests can reach the cases a real analysis cannot produce on demand — all four
// likelihoods at once, all three knowledge categories at once, proposed structure, a node the graph
// no longer contains, an analysis over the §33 budget — without every test file re-declaring the
// same twenty lines of scaffolding.
//
// Every number these builders default to is a FIXTURE INPUT, never an expectation about what the
// scoring engine would compute. Tests that assert on engine arithmetic belong elsewhere.

export const anImpact = (
  overrides: Partial<RequirementImpact> & Pick<RequirementImpact, 'nodeId'>,
): RequirementImpact => ({
  requirementId: 'req-1',
  likelihood: 'possible',
  impactType: 'domain-model',
  directness: 'indirect',
  confidence: 0.5,
  confidenceSignals: [{ type: 'exact-concept-to-symbol-match', contribution: 0.9 }],
  explanation: 'fixture impact',
  expectedChanges: ['review it'],
  evidenceIds: ['ev-1'],
  dependencyPath: [overrides.nodeId],
  provenance: 'static-analysis',
  ...overrides,
});

export const aRequirement = (id: string, statement: string): Requirement => ({
  id,
  statement,
  type: 'functional',
  concepts: [],
  actors: [],
  priority: 'must',
  status: 'draft',
});

export const aSpecification = (requirements: readonly Requirement[]): Specification => ({
  id: 'spec-fixture',
  title: 'Fixture specification',
  sourceType: 'markdown',
  sourceReference: 'specs/fixture.md',
  rawText: 'fixture',
  version: 1,
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z',
  requirements,
  actors: [],
  constraints: [],
  openQuestions: [],
  decisions: [],
});

/** Goes through the domain factory, so a fixture can never drift from the domain invariants. */
export const anAnalysis = (
  impacts: readonly RequirementImpact[],
  extras: Partial<ImpactAnalysis> = {},
): ImpactAnalysis => {
  const result = createImpactAnalysis({
    id: 'analysis-fixture',
    specificationId: 'spec-fixture',
    specificationVersion: 1,
    repositorySnapshotId: 'snap-fixture',
    createdAt: '2026-08-03T10:00:00.000Z',
    status: 'approved',
    requirementImpacts: impacts,
    architecturalOptions: [],
    warnings: [],
    userDecisions: [],
    ...extras,
  });
  if (!result.ok) {
    throw new Error(`fixture analysis invalid: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

/** Component facts as the graph would supply them for a drawn cell. */
export const aComponent = (
  name: string,
  type = 'file',
): {
  readonly name: string;
  readonly type: string;
  readonly category: string;
  readonly path: string;
  readonly provenance: string;
} => ({
  name,
  type,
  category: 'application',
  path: `src/${name}.ts`,
  provenance: 'static-analysis',
});
