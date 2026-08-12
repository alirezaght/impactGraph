import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assignEvidenceProvenance,
  checkRuntime,
  configuredNamesByProcess,
  resolveRuntimePaths,
  runPreflight,
} from '@impactgraph/application';
import { stableContentId } from '@impactgraph/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadCurrentGraph, withIndexStore } from './graphs.js';
import { performIndexRun } from './indexing.js';
import { loadConstraints } from './preflight-guards.js';
import { initializeWorkspace } from './workspace.js';

import type { PreflightRequirement } from '@impactgraph/application';
import type { KnowledgeGraph, RepositoryConstraint } from '@impactgraph/domain';

/**
 * The four expensive failures, reproduced against a real indexed repository rather than a
 * hand-built graph.
 *
 * This is the acceptance test for the whole change. Each case is a thing ImpactGraph used to miss
 * entirely, and each one was discoverable from the repository the whole time.
 */

const FIXTURE = fileURLToPath(new URL('../../test-kit/fixtures/guarded-services', import.meta.url));

let repoDir: string;
let graph: KnowledgeGraph;
let constraints: readonly RepositoryConstraint[];

const nextId = (seed: string): string => stableContentId('finding', seed);

const signals = (overrides: Partial<PreflightRequirement['signals']> = {}) => ({
  hasInvalidSymbolAssumption: false,
  touchesUnindexedRepository: false,
  touchesIndexingGap: false,
  usesCreationLanguage: false,
  referencesExternalBoundary: false,
  hasAmbiguousConcept: false,
  siblingSurfaceIndexed: false,
  ...overrides,
});

const nodeByPath = (suffix: string): { nodeId: string; path: string } => {
  const node = [...graph.nodes.values()].find(
    (entry) => entry.path?.endsWith(suffix) === true && entry.type === 'file',
  );
  if (node === undefined) {
    throw new Error(`fixture node not indexed: ${suffix}`);
  }
  return { nodeId: String(node.id), path: node.path ?? '' };
};

beforeAll(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-guarded-'));
  cpSync(FIXTURE, repoDir, { recursive: true });
  // The indexer binds every fact to a git snapshot, so the fixture needs to be a repository.
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'guarded@test.dev'],
    ['config', 'user.name', 'Guarded Test'],
    ['config', 'commit.gpgsign', 'false'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ]) {
    execFileSync('git', args, { cwd: repoDir });
  }
  initializeWorkspace(repoDir);
  const indexed = await performIndexRun(repoDir);
  if (!indexed.ok) {
    throw new Error('fixture index failed');
  }
  const loaded = await withIndexStore(repoDir, async (store) => loadCurrentGraph(store));
  if (!loaded.ok) {
    throw new Error('fixture graph failed to load');
  }
  graph = loaded.value.graph;
  constraints = loadConstraints(
    repoDir,
    graph,
    loaded.value.snapshotId,
    '2026-08-12T00:00:00.000Z',
  ).constraints;
}, 60_000);

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('constraint extraction against a real repository', () => {
  it('indexes the peer-HTTP guard as a blocking rule with its allowlist', () => {
    const peerHttp = constraints.find(
      (entry) =>
        entry.kind === 'forbidden-runtime-call' &&
        entry.source.filePath.endsWith('check-service-peer-http.py'),
    );
    expect(peerHttp).toBeDefined();
    expect(peerHttp?.severity).toBe('blocking');
    expect(peerHttp?.extraction).toBe('recognized');
    expect(peerHttp?.scope.pathGlobs).toContain('services/**');
    expect(peerHttp?.exemptions.map((entry) => entry.subject)).toContain(
      'services/newsletter-service/jobs/send.py',
    );
  });

  it('records that CI actually runs the guard', () => {
    expect(
      constraints.some(
        (entry) =>
          entry.kind === 'must-pass-check' && entry.name.includes('check-service-peer-http.py'),
      ),
    ).toBe(true);
  });
});

describe('BLOCKING architectural violation', () => {
  const run = (sourceSuffix: string) => {
    const source = nodeByPath(sourceSuffix);
    const target = nodeByPath('services/user-profile-service/app.py');
    return runPreflight({
      requirements: [
        {
          id: 'req-6',
          label: 'R6',
          statement:
            'The newsletter service fetches subscriber preferences from the user-profile service over HTTP while rendering an issue.',
          concepts: [
            { ref: 'newsletter service', nodeId: source.nodeId, path: source.path },
            { ref: 'user-profile service', nodeId: target.nodeId, path: target.path },
          ],
          hasStructuralImpact: true,
          signals: signals(),
        },
      ],
      graph,
      constraints,
      configRequirements: [],
      configDeclarations: [],
      planConfiguredNodeIds: new Set(),
      blockingQuestions: 0,
      coverageInsufficient: false,
      score: 92,
      nextId,
    });
  };

  it('blocks the design proposed from an ordinary route module', () => {
    const result = run('services/newsletter-service/api/issue_routes.py');
    expect(result.assessment.feasibility).toBe('BLOCKED');
    const blocking = result.findings.find(
      (finding) => finding.kind === 'blocking-constraint-violation',
    );
    expect(blocking?.statement).toContain('R6');
    expect(blocking?.statement).toContain('peer-service HTTP communication');
    expect(blocking?.statement).toContain('check-service-peer-http.py');
    expect(blocking?.evidenceIds.length).toBeGreaterThan(0);
    // Coverage was excellent and it is still BLOCKED — the point of the precedence rule.
    expect(result.assessment.counts.expectedChangeSurfaces).toBe(1);
  });

  it('raises no violation from the allowlisted send job', () => {
    const result = run('services/newsletter-service/jobs/send.py');
    expect(result.assessment.counts.blockingViolations).toBe(0);
    expect(result.findings.filter((finding) => finding.severity === 'blocking')).toEqual([]);
  });
});

describe('INVALID ASSUMPTION', () => {
  it('contradicts a specification that assumes an enum member that does not exist', () => {
    const result = runPreflight({
      requirements: [
        {
          id: 'req-4',
          label: 'R4',
          statement: 'The issue filter uses ItemType.ANGEBOT when the listing is an offer.',
          concepts: [],
          hasStructuralImpact: false,
          signals: signals(),
        },
      ],
      graph,
      constraints,
      configRequirements: [],
      configDeclarations: [],
      planConfiguredNodeIds: new Set(),
      blockingQuestions: 0,
      coverageInsufficient: false,
      nextId,
    });
    const invalid = result.findings.find(
      (finding) => finding.subject.assumedSymbol === 'ItemType.ANGEBOT',
    );
    expect(invalid).toBeDefined();
    expect(invalid?.kind).toBe('invalid-assumption');
    expect(invalid?.recommendation).toContain('GESUCH');
    expect(
      result.classifications.find((entry) => entry.requirementId === 'R4')?.classification,
    ).toBe('INVALID_ASSUMPTION');
  });
});

describe('EVIDENCE PROVENANCE', () => {
  it('marks a file the specification named as confirmation, not discovery', () => {
    const named = nodeByPath('services/newsletter-service/api/issue_routes.py');
    const unnamed = nodeByPath('services/user-profile-service/app.py');
    const impact = (nodeId: string) => ({
      requirementId: 'R6',
      nodeId,
      likelihood: 'required' as const,
      impactType: 'domain-model' as const,
      directness: 'direct' as const,
      confidence: 0.9,
      confidenceSignals: [{ type: 'direct-observation' as const, contribution: 0.9 }],
      explanation: 'matched',
      expectedChanges: [],
      evidenceIds: ['ev-1'],
      dependencyPath: [],
      provenance: 'static-analysis' as const,
      evidenceTypes: ['direct-structural' as const],
    });
    const assigned = assignEvidenceProvenance({
      analysis: {
        id: 'analysis-1',
        specificationId: 'spec-1',
        specificationVersion: 1,
        repositorySnapshotId: 'snap-1',
        createdAt: '2026-08-12T00:00:00.000Z',
        status: 'draft',
        requirementImpacts: [impact(named.nodeId), impact(unnamed.nodeId)],
        architecturalOptions: [],
        warnings: [],
        userDecisions: [],
      },
      graph,
      specificationText: 'Modify issue_routes.py so the digest renders subscriber preferences.',
    });
    const byNode = new Map(
      assigned.analysis.requirementImpacts.map((entry) => [entry.nodeId, entry.evidenceProvenance]),
    );
    expect(byNode.get(named.nodeId)).toBe('USER_SUPPLIED');
    expect(byNode.get(unnamed.nodeId)).toBe('INDEPENDENTLY_DISCOVERED');
    expect(assigned.independence.independentCount).toBe(1);
    expect(assigned.independence.confirmationCount).toBe(1);
  });
});

describe('NEW SURFACE versus COVERAGE GAP', () => {
  it('tells apart a requirement that creates surface from one whose code is not indexed', () => {
    const result = runPreflight({
      requirements: [
        {
          id: 'req-9',
          label: 'R9',
          statement: 'Add a new localization key for the unsubscribe confirmation banner.',
          concepts: [],
          hasStructuralImpact: false,
          signals: signals({ usesCreationLanguage: true }),
        },
        {
          id: 'req-10',
          label: 'R10',
          statement: 'The issue payload conforms to the shared billing contract schema.',
          concepts: [],
          hasStructuralImpact: false,
          signals: signals({ touchesUnindexedRepository: true }),
        },
      ],
      graph,
      constraints,
      configRequirements: [],
      configDeclarations: [],
      planConfiguredNodeIds: new Set(),
      blockingQuestions: 0,
      coverageInsufficient: false,
      nextId,
    });
    const byRequirement = new Map(
      result.classifications.map((entry) => [entry.requirementId, entry.classification]),
    );
    expect(byRequirement.get('R9')).toBe('NEW_SURFACE');
    expect(byRequirement.get('R10')).toBe('COVERAGE_GAP');
    // NEW_SURFACE is a planning fact, not a defect — it must not read as a warning.
    expect(
      result.findings.find(
        (finding) => finding.kind === 'new-surface' && finding.requirementIds.includes('R9'),
      )?.severity,
    ).toBe('informational');
  });
});

describe('RUNTIME TOPOLOGY', () => {
  it('resolves the configured URL to the aggregator that actually serves it', () => {
    const paths = resolveRuntimePaths({ graph });
    const names = paths.map((path) => path.hops.map((hop) => hop.name));
    // NEWSLETTER_SERVICE_URL is what admin is configured with; the aggregator is what runs.
    const viaAggregator = names.find((hops) =>
      hops.some((name) => name.toLowerCase().includes('aggregator')),
    );
    expect(viaAggregator).toBeDefined();
  });

  it('reports the gap when the plan configures the service and the aggregator serves the request', () => {
    const paths = resolveRuntimePaths({ graph }).filter((path) =>
      path.hops.some((hop) => hop.name.toLowerCase().includes('aggregator')),
    );
    const configured = configuredNamesByProcess(graph);
    const findings = checkRuntime({
      paths,
      requirements: [
        {
          name: 'SENDGRID_TEMPLATE_IDS_JSON',
          requiredByNodeId: 'plan',
          evidenceIds: ['ev-1'],
        },
      ],
      configuredByProcess: configured,
      planConfiguredNodeIds: new Set(),
      requirementIds: ['R3'],
      nextId,
    });
    const gap = findings.find((finding) => finding.statement.includes('does not receive'));
    expect(gap).toBeDefined();
    expect(gap?.kind).toBe('runtime-topology-gap');
    expect(gap?.statement).toContain('SENDGRID_TEMPLATE_IDS_JSON');
    expect(gap?.statement.toLowerCase()).toContain('aggregator');
  });
});
