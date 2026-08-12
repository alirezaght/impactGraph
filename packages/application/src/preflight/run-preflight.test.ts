import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { extractConstraints } from '../extract-constraints/extract-constraints.js';

import { runPreflight } from './run-preflight.js';

import type { PreflightRequirement, RunPreflightInput } from './run-preflight.js';
import type { GraphNode, KnowledgeGraph, NodeCategory } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-12T00:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (
  id: string,
  category: NodeCategory,
  type: string,
  name: string,
  path?: string,
): GraphNode => {
  const result = createGraphNode({
    id,
    category,
    type,
    name,
    knowledge,
    ...(path === undefined ? {} : { path }),
  });
  if (!result.ok) {
    throw new Error(`node ${id}: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const graph = (): KnowledgeGraph => {
  const nodes = [
    node(
      'file:services/newsletter-service/api/routes.py',
      'repository',
      'file',
      'routes.py',
      'services/newsletter-service/api/routes.py',
    ),
    node(
      'file:services/user-profile-service/app.py',
      'repository',
      'file',
      'app.py',
      'services/user-profile-service/app.py',
    ),
    node('sym:ItemType', 'application', 'enum', 'ItemType', 'services/shared/item_type.py'),
    node('sym:ItemType.GESUCH', 'application', 'enum-member', 'GESUCH'),
    node('locale:de', 'asset', 'locale-bundle', 'de.json', 'apps/web/locales/de.json'),
  ];
  const edges = [
    (() => {
      const result = createGraphEdge({
        id: 'e-member',
        type: 'DECLARES_MEMBER',
        sourceId: 'sym:ItemType',
        targetId: 'sym:ItemType.GESUCH',
        knowledge,
      });
      if (!result.ok) {
        throw new Error('edge');
      }
      return result.value;
    })(),
  ];
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error(`graph: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const PEER_HTTP_GUARD = `import re, sys
from pathlib import Path
SERVICE_DIRS = "services"
ALLOWLIST = ["services/newsletter-service/jobs/send.py"]
PEER_HTTP = re.compile(r"https?://[a-z0-9-]+-service")
sys.exit(1)
`;

const constraints = () =>
  extractConstraints({
    files: [{ path: 'ci/scripts/check-service-peer-http.py', content: PEER_HTTP_GUARD }],
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-12T00:00:00.000Z',
    nextId: (seed) => `constraint-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}`,
    nextEvidenceId: (seed) => `ev-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}`,
  }).constraints;

const signals = (overrides = {}) => ({
  hasInvalidSymbolAssumption: false,
  touchesUnindexedRepository: false,
  touchesIndexingGap: false,
  usesCreationLanguage: false,
  referencesExternalBoundary: false,
  hasAmbiguousConcept: false,
  siblingSurfaceIndexed: false,
  ...overrides,
});

const requirements = (): readonly PreflightRequirement[] => [
  {
    id: 'req-6',
    label: 'R6',
    statement:
      'The newsletter service fetches subscriber preferences from the user-profile service over HTTP when rendering an issue.',
    concepts: [
      {
        ref: 'newsletter service',
        nodeId: 'file:services/newsletter-service/api/routes.py',
        path: 'services/newsletter-service/api/routes.py',
      },
      {
        ref: 'user-profile service',
        nodeId: 'file:services/user-profile-service/app.py',
        path: 'services/user-profile-service/app.py',
      },
    ],
    hasStructuralImpact: true,
    signals: signals(),
  },
  {
    id: 'req-4',
    label: 'R4',
    statement: 'The search filter uses ItemType.ANGEBOT when the listing is an offer.',
    concepts: [],
    hasStructuralImpact: false,
    signals: signals(),
  },
  {
    id: 'req-9',
    label: 'R9',
    statement: 'Add a new localization key for the unsubscribe confirmation banner.',
    concepts: [],
    hasStructuralImpact: false,
    signals: signals({ usesCreationLanguage: true, siblingSurfaceIndexed: true }),
  },
  {
    id: 'req-10',
    label: 'R10',
    statement: 'The issue payload conforms to the shared newsletter contract schema.',
    concepts: [],
    hasStructuralImpact: false,
    signals: signals({ touchesUnindexedRepository: true }),
  },
];

const input = (overrides: Partial<RunPreflightInput> = {}): RunPreflightInput => ({
  requirements: requirements(),
  graph: graph(),
  constraints: constraints(),
  configRequirements: [],
  configDeclarations: [],
  planConfiguredNodeIds: new Set(),
  blockingQuestions: 0,
  coverageInsufficient: false,
  score: 87,
  nextId: (seed) => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
  ...overrides,
});

describe('runPreflight — every check runs without being asked for', () => {
  it('returns BLOCKED on the constraint violation, not a readiness number', () => {
    const result = runPreflight(input());
    expect(result.assessment.feasibility).toBe('BLOCKED');
    expect(result.assessment.decision).toContain('Do not implement yet');
    expect(result.assessment.counts.blockingViolations).toBeGreaterThanOrEqual(1);
    expect(result.assessment.score).toBe(87);
  });

  it('separates new surface from coverage gap for two requirements that both matched nothing', () => {
    const result = runPreflight(input());
    const byRequirement = new Map(
      result.classifications.map((entry) => [entry.requirementId, entry.classification]),
    );
    expect(byRequirement.get('R9')).toBe('NEW_SURFACE');
    expect(byRequirement.get('R10')).toBe('COVERAGE_GAP');
    expect(result.assessment.counts.newSurfaces).toBe(1);
  });

  it('finds the invalid enum assumption in the same pass', () => {
    const result = runPreflight(input());
    const invalid = result.findings.find(
      (finding) => finding.subject.assumedSymbol === 'ItemType.ANGEBOT',
    );
    expect(invalid).toBeDefined();
    expect(invalid?.kind).toBe('invalid-assumption');
    expect(
      result.classifications.find((entry) => entry.requirementId === 'R4')?.classification,
    ).toBe('INVALID_ASSUMPTION');
  });

  it('orders findings so the deciding ones come first', () => {
    const result = runPreflight(input());
    expect(result.findings[0]?.severity).toBe('blocking');
  });

  it('withholds the score when coverage is insufficient, and still reports the violation', () => {
    const result = runPreflight(input({ coverageInsufficient: true }));
    expect(result.assessment.feasibility).toBe('BLOCKED');
    expect(result.assessment.counts.blockingViolations).toBeGreaterThanOrEqual(1);
  });

  it('drops to READY_WITH_WARNINGS once the relationship moves to the allowlisted job', () => {
    const exempt = requirements().map((requirement) =>
      requirement.label === 'R6'
        ? {
            ...requirement,
            concepts: [
              {
                ref: 'newsletter service',
                nodeId: 'n1',
                path: 'services/newsletter-service/jobs/send.py',
              },
              {
                ref: 'user-profile service',
                nodeId: 'n2',
                path: 'services/user-profile-service/app.py',
              },
            ],
          }
        : requirement,
    );
    const result = runPreflight(input({ requirements: exempt }));
    expect(result.assessment.counts.blockingViolations).toBe(0);
    // The plan is still BLOCKED — by R4's invalid assumption, which the exemption says nothing
    // about. Checking that the REMAINING blocker changed is the point: a verdict that survived for
    // a different reason would otherwise look like the exemption having no effect.
    expect(
      result.findings
        .filter((finding) => finding.severity === 'blocking')
        .map((finding) => finding.kind),
    ).toEqual(['invalid-assumption']);
  });

  it('is READY_WITH_WARNINGS when neither the violation nor the assumption remains', () => {
    const clean = requirements()
      .filter((requirement) => requirement.label !== 'R4')
      .map((requirement) =>
        requirement.label === 'R6'
          ? {
              ...requirement,
              concepts: [
                {
                  ref: 'newsletter service',
                  nodeId: 'n1',
                  path: 'services/newsletter-service/jobs/send.py',
                },
                {
                  ref: 'user-profile service',
                  nodeId: 'n2',
                  path: 'services/user-profile-service/app.py',
                },
              ],
            }
          : requirement,
      );
    const result = runPreflight(input({ requirements: clean }));
    expect(result.assessment.feasibility).toBe('READY_WITH_WARNINGS');
    expect(result.assessment.decision).toContain('none of them blocks on its own');
  });
});
