import {
  createGraphNode,
  createKnowledgeGraph,
  createRepositoryConstraint,
} from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { checkPlanContract } from './check-plan-contract.js';

import type { ApprovedPlan, CheckPlanContractInput } from './check-plan-contract.js';
import type { GraphNode, KnowledgeGraph, RepositoryConstraint } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-12T00:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, name: string, path: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'repository',
    type: 'file',
    name,
    path,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const graph = (): KnowledgeGraph => {
  const result = createKnowledgeGraph(
    [
      node('n:routes', 'issue_routes.py', 'services/newsletter-service/api/issue_routes.py'),
      node('n:profile', 'app.py', 'services/user-profile-service/app.py'),
      node('n:send', 'send.py', 'services/newsletter-service/jobs/send.py'),
    ],
    [],
  );
  if (!result.ok) {
    throw new Error('graph');
  }
  return result.value;
};

const peerHttp = (): RepositoryConstraint => {
  const result = createRepositoryConstraint({
    id: 'constraint-peer-http',
    name: 'service peer HTTP forbidden',
    kind: 'forbidden-runtime-call',
    severity: 'blocking',
    extraction: 'recognized',
    scope: { pathGlobs: ['services/**'] },
    rule: {
      relation: 'FORBIDS',
      statement: 'services must not call peer services over HTTP',
    },
    exemptions: [
      {
        id: 'send',
        subject: 'services/newsletter-service/jobs/send.py',
        source: { kind: 'file', filePath: 'ci/scripts/peer-http-allowlist.txt' },
      },
    ],
    source: { kind: 'file', filePath: 'ci/scripts/check-service-peer-http.py' },
    provenance: 'static-analysis',
    evidenceIds: ['ev-1'],
    repositorySnapshotId: 'snap-1',
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  if (!result.ok) {
    throw new Error('constraint');
  }
  return result.value;
};

const plan = (overrides: Partial<ApprovedPlan> = {}): ApprovedPlan => ({
  expectedNodeIds: new Set(['n:routes']),
  expectedPaths: new Set(['services/newsletter-service/api/issue_routes.py']),
  constraints: [peerHttp()],
  runtimeProcessNodeIds: new Set(),
  requiredConfigNames: [],
  ...overrides,
});

const input = (overrides: Partial<CheckPlanContractInput> = {}): CheckPlanContractInput => ({
  plan: plan(),
  actual: {
    changedPaths: ['services/newsletter-service/api/issue_routes.py'],
    changedNodeIds: new Set(['n:routes']),
    addedEdges: [],
    graph: graph(),
  },
  nextId: (seed) => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}`,
  ...overrides,
});

describe('checkPlanContract — architectural drift', () => {
  it('reports a forbidden relationship the implementation introduced', () => {
    const result = checkPlanContract(
      input({
        actual: {
          changedPaths: ['services/newsletter-service/api/issue_routes.py'],
          changedNodeIds: new Set(['n:routes']),
          addedEdges: [
            {
              type: 'CALLS_ENDPOINT',
              sourceId: 'n:routes',
              targetId: 'n:profile',
              evidenceIds: ['ev-9'],
            },
          ],
          graph: graph(),
        },
      }),
    );
    const drift = result.findings.find(
      (finding) => finding.kind === 'blocking-constraint-violation',
    );
    expect(drift).toBeDefined();
    expect(drift?.severity).toBe('blocking');
    expect(drift?.statement).toContain('issue_routes.py');
    expect(drift?.statement).toContain('check-service-peer-http.py');
    expect(drift?.evidenceIds).toContain('ev-9');
  });

  it('stays silent when the same relationship comes from the allowlisted location', () => {
    const result = checkPlanContract(
      input({
        actual: {
          changedPaths: ['services/newsletter-service/jobs/send.py'],
          changedNodeIds: new Set(['n:send']),
          addedEdges: [
            {
              type: 'CALLS_ENDPOINT',
              sourceId: 'n:send',
              targetId: 'n:profile',
              evidenceIds: ['ev-9'],
            },
          ],
          graph: graph(),
        },
      }),
    );
    expect(
      result.findings.filter((finding) => finding.kind === 'blocking-constraint-violation'),
    ).toEqual([]);
  });

  it('reports work the plan never accounted for, and plan surface never touched', () => {
    const result = checkPlanContract(
      input({
        actual: {
          changedPaths: ['services/newsletter-service/digest.py', 'README.md'],
          changedNodeIds: new Set(),
          addedEdges: [],
          graph: graph(),
        },
      }),
    );
    expect(result.unplannedPaths).toEqual(['README.md', 'services/newsletter-service/digest.py']);
    expect(result.unchangedExpectedPaths).toEqual([
      'services/newsletter-service/api/issue_routes.py',
    ]);
  });

  it('reports deployment work the plan required and the change never did', () => {
    const result = checkPlanContract(
      input({
        plan: plan({
          runtimeProcessNodeIds: new Set(['container:aggregator']),
          requiredConfigNames: ['SENDGRID_TEMPLATE_IDS_JSON'],
        }),
      }),
    );
    const missing = result.findings.find((finding) => finding.kind === 'runtime-topology-gap');
    expect(missing).toBeDefined();
    expect(missing?.statement).toContain('SENDGRID_TEMPLATE_IDS_JSON');
  });

  it('does not report missing deployment work when the change touches infrastructure', () => {
    const result = checkPlanContract(
      input({
        plan: plan({
          runtimeProcessNodeIds: new Set(['container:aggregator']),
          requiredConfigNames: ['SENDGRID_TEMPLATE_IDS_JSON'],
        }),
        actual: {
          changedPaths: ['infra/main.tf'],
          changedNodeIds: new Set(),
          addedEdges: [],
          graph: graph(),
        },
      }),
    );
    expect(result.findings.filter((finding) => finding.kind === 'runtime-topology-gap')).toEqual(
      [],
    );
  });

  it('flags a guard that governs the changed area and was not itself updated', () => {
    const result = checkPlanContract(input());
    const stale = result.findings.find((finding) => finding.kind === 'guard-not-updated');
    expect(stale).toBeDefined();
    expect(stale?.severity).toBe('warning');
    expect(stale?.statement).toContain('check-service-peer-http.py');
  });

  it('does not flag a guard the change updated alongside the code', () => {
    const result = checkPlanContract(
      input({
        actual: {
          changedPaths: [
            'services/newsletter-service/api/issue_routes.py',
            'ci/scripts/check-service-peer-http.py',
          ],
          changedNodeIds: new Set(['n:routes']),
          addedEdges: [],
          graph: graph(),
        },
      }),
    );
    expect(result.findings.filter((finding) => finding.kind === 'guard-not-updated')).toEqual([]);
  });
});
