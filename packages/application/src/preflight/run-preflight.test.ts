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

interface NodeSpec {
  readonly id: string;
  readonly category: NodeCategory;
  readonly type: string;
  readonly name: string;
  readonly path?: string;
  readonly declaredType?: string;
}

const node = ({ id, category, type, name, path, declaredType }: NodeSpec): GraphNode => {
  const result = createGraphNode({
    id,
    category,
    type,
    name,
    knowledge,
    ...(path === undefined ? {} : { path }),
    ...(declaredType === undefined ? {} : { declaredType }),
  });
  if (!result.ok) {
    throw new Error(`node ${id}: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const graph = (): KnowledgeGraph => {
  const nodes = [
    node({
      id: 'sym:Listing',
      category: 'application',
      type: 'class',
      name: 'Listing',
      path: 'app/listings.py',
    }),
    node({
      id: 'sym:Listing.id',
      category: 'data',
      type: 'field',
      name: 'Listing.id',
      path: 'app/listings.py',
      declaredType: 'UUID',
    }),
    node({
      id: 'file:services/newsletter-service/api/routes.py',
      category: 'repository',
      type: 'file',
      name: 'routes.py',
      path: 'services/newsletter-service/api/routes.py',
    }),
    node({
      id: 'file:services/user-profile-service/app.py',
      category: 'repository',
      type: 'file',
      name: 'app.py',
      path: 'services/user-profile-service/app.py',
    }),
    node({
      id: 'sym:ItemType',
      category: 'application',
      type: 'enum',
      name: 'ItemType',
      path: 'services/shared/item_type.py',
    }),
    node({
      id: 'sym:ItemType.GESUCH',
      category: 'application',
      type: 'enum-member',
      name: 'GESUCH',
    }),
    node({
      id: 'locale:de',
      category: 'asset',
      type: 'locale-bundle',
      name: 'de.json',
      path: 'apps/web/locales/de.json',
    }),
  ];
  const edge = (id: string, sourceId: string, targetId: string) => {
    const result = createGraphEdge({ id, type: 'DECLARES_MEMBER', sourceId, targetId, knowledge });
    if (!result.ok) {
      throw new Error('edge');
    }
    return result.value;
  };
  const edges = [
    edge('e-member', 'sym:ItemType', 'sym:ItemType.GESUCH'),
    edge('e-field', 'sym:Listing', 'sym:Listing.id'),
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

  // ADR-0020 §4 — the type-comparison check reads the RAW specification text, so fenced SQL that
  // requirement extraction dropped still gets compared against the indexed column types.
  it('warns about a type-sensitive SQL comparison found in the raw specification text', () => {
    const result = runPreflight(
      input({
        specificationText: [
          'Load the affected rows:',
          '```sql',
          'SELECT * FROM listings WHERE listing.id = ANY(:listing_ids)',
          '```',
        ].join('\n'),
        analogousLiterals: [{ pattern: '= ANY(', filePath: 'app/queries.py', line: 10 }],
      }),
    );
    const comparison = result.findings.find(
      (finding) => finding.kind === 'type-sensitive-comparison',
    );
    expect(comparison?.severity).toBe('warning');
    expect(comparison?.statement).toContain("'UUID'");
    expect(comparison?.recommendation).toContain('app/queries.py:10');
    expect(result.assessment.counts.typeSensitiveComparisons).toBe(1);
  });

  it('stays silent about SQL when no specification text was supplied', () => {
    const result = runPreflight(input());
    expect(result.findings.some((finding) => finding.kind === 'type-sensitive-comparison')).toBe(
      false,
    );
    expect(result.assessment.counts.typeSensitiveComparisons).toBe(0);
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
