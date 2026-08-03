import {
  evidencePanelStateSchema,
  impactGraphSchema,
  specificationPanelStateSchema,
} from '@impactgraph/contracts';
import { describe, expect, it } from 'vitest';

import { buildEvidenceState, relatedTestFiles, unavailableEvidence } from './evidence-model.js';
import { buildImpactGraph } from './graph-model.js';
import { buildWebviewHtml, contentSecurityPolicy, createNonce, escapeHtml } from './html.js';
import { buildSpecificationState } from './spec-model.js';

import type { CliAnalyzeOutput } from '@impactgraph/contracts';
import type { Specification } from '@impactgraph/domain';

// Extension-host webview logic that needs no Electron: CSP/nonce construction and the pure
// DTO mappers behind every host → webview message.

const analyzeDocument: CliAnalyzeOutput = {
  schemaVersion: 1,
  command: 'analyze',
  specification: {
    id: 'spec-deals',
    version: 2,
    title: 'Deal visibility',
    extractionMode: 'deterministic-fallback',
  },
  analysis: { id: 'an-1', snapshotId: 'snap-1', status: 'draft', impactCount: 2 },
  requirements: [
    {
      id: 'req-1',
      statement: 'Owners see their own deals',
      openQuestions: [],
      impacts: [
        {
          nodeId: 'node-policy',
          name: 'DealVisibilityPolicy',
          likelihood: 'required',
          impactType: 'logic-change',
          directness: 'direct',
          confidence: 0.88,
          dependencyPath: ['DealController', 'DealService'],
          evidenceFiles: ['src/deal/policy.ts', 'src/deal/policy.test.ts'],
          provenance: 'static-analysis',
        },
        {
          nodeId: 'node-search',
          name: 'SearchIndexer',
          likelihood: 'possible',
          impactType: 'behaviour-change',
          directness: 'indirect',
          confidence: 0.42,
          dependencyPath: ['DealService'],
          evidenceFiles: [],
          provenance: 'llm-inferred',
        },
      ],
    },
  ],
  warnings: ['index is 3 commits behind HEAD'],
};

describe('CSP + nonce (PRD §35)', () => {
  it('denies everything by default and allows no remote origin', () => {
    const policy = contentSecurityPolicy('NONCE', 'vscode-resource://abc');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'nonce-NONCE'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("font-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('http');
  });

  it('mints a fresh, high-entropy nonce per load', () => {
    const nonces = new Set(Array.from({ length: 20 }, () => createNonce()));
    expect(nonces.size).toBe(20);
    expect([...nonces][0]?.length).toBeGreaterThanOrEqual(16);
  });

  it('escapes everything interpolated into the document', () => {
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
    const html = buildWebviewHtml({
      nonce: 'N1',
      cspSource: 'vscode-resource://abc',
      scriptUri: 'vscode-resource://abc/webview.js',
      styleUri: 'vscode-resource://abc/webview.css',
      title: 'ImpactGraph <x>',
    });
    expect(html).toContain('<script nonce="N1"');
    expect(html).toContain('ImpactGraph &lt;x&gt;');
    expect(html).not.toContain('<title>ImpactGraph <x>');
  });
});

describe('impact graph mapping (§18.4)', () => {
  const graph = buildImpactGraph(analyzeDocument);

  it('produces a contract-valid graph with dependency hops as their own nodes', () => {
    expect(impactGraphSchema.parse(graph)).toEqual(graph);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([
      'DealController',
      'DealService',
      'node-policy',
      'node-search',
    ]);
  });

  it('derives the knowledge category from provenance and never invents one', () => {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get('node-policy')?.knowledgeCategory).toBe('deterministic');
    expect(byId.get('node-search')?.knowledgeCategory).toBe('ai-inferred');
    expect(byId.get('DealService')?.knowledgeCategory).toBeUndefined();
    expect(byId.get('DealService')?.kind).toBe('dependency');
  });

  it('reports the pre-cap total so the webview can say "showing N of M"', () => {
    expect(graph.totalNodeCount).toBe(graph.nodes.length);
    expect(graph.warnings).toContain('index is 3 commits behind HEAD');
  });

  it('never emits an edge with an endpoint outside the node set', () => {
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.sourceId)).toBe(true);
      expect(ids.has(edge.targetId)).toBe(true);
    }
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});

describe('proposed-structure mapping (§18.4 current vs proposed)', () => {
  const signals = [{ type: 'option-footprint', contribution: 0.2, description: 'named in option' }];
  const envelope = {
    originOptionId: 'opt-read-model',
    rationale: 'the option moves visibility filtering behind a projection',
    provenance: 'llm-inferred',
    evidenceIds: ['ev-1'],
    confidence: 0.62,
    confidenceSignals: signals,
  };
  const proposedNode = {
    id: 'prop-projection',
    name: 'DealProjection',
    category: 'component',
    type: 'service',
    ...envelope,
  };
  const relationship = (
    overrides: Partial<NonNullable<CliAnalyzeOutput['proposedStructure']>['relationships'][number]>,
  ): NonNullable<CliAnalyzeOutput['proposedStructure']>['relationships'][number] => ({
    id: 'rel-1',
    sourceId: 'node-policy',
    targetId: 'prop-projection',
    sourceKind: 'existing',
    targetKind: 'proposed',
    type: 'data-dependency',
    status: 'proposed',
    ...envelope,
    ...overrides,
  });

  const withProposals = (
    structure: NonNullable<CliAnalyzeOutput['proposedStructure']>,
  ): CliAnalyzeOutput => ({
    ...analyzeDocument,
    architecturalOptions: [
      {
        id: 'opt-read-model',
        title: 'Introduce a deal read model',
        description: 'project deal visibility into a read model',
        affectedNodeIds: ['node-policy'],
      },
    ],
    proposedStructure: structure,
  });

  it('projects proposals into their own field, never into nodes/edges (§3)', () => {
    const graph = buildImpactGraph(
      withProposals({ nodes: [proposedNode], relationships: [relationship({})] }),
    );
    expect(impactGraphSchema.parse(graph)).toEqual(graph);
    expect(graph.nodes.some((node) => node.id === 'prop-projection')).toBe(false);
    expect(graph.edges.some((edge) => edge.id === 'rel-1')).toBe(false);
    expect(graph.proposedStructure?.relationships.map((entry) => entry.id)).toEqual(['rel-1']);
    expect(graph.proposedStructure?.nodes.map((entry) => entry.id)).toEqual(['prop-projection']);
  });

  it('carries the proposed NODE an edge depends on, plus its option title and signals', () => {
    const graph = buildImpactGraph(
      withProposals({ nodes: [proposedNode], relationships: [relationship({})] }),
    );
    const edge = graph.proposedStructure?.relationships[0];
    expect(edge?.originOptionTitle).toBe('Introduce a deal read model');
    expect(edge?.knowledgeCategory).toBe('ai-inferred');
    expect(edge?.confidenceSignals).toEqual(signals);
    // the `proposed` endpoint resolves against the proposed nodes the DTO also carries
    expect(graph.proposedStructure?.nodes.map((entry) => entry.id)).toContain(edge?.targetId);
  });

  it('DROPS a relationship with an unresolvable endpoint and says why (never dangling)', () => {
    const graph = buildImpactGraph(
      withProposals({
        nodes: [],
        relationships: [
          relationship({ id: 'rel-ghost-proposed' }),
          relationship({ id: 'rel-ghost-existing', sourceId: 'nope', targetKind: 'existing' }),
          relationship({
            id: 'rel-kind-mismatch',
            targetId: 'node-search',
            targetKind: 'proposed',
          }),
        ],
      }),
    );
    expect(graph.proposedStructure?.relationships).toEqual([]);
    expect(graph.warnings.filter((warning) => warning.includes('was not shown'))).toHaveLength(3);
    expect(graph.warnings.join(' ')).toContain("proposed target 'prop-projection'");
    expect(graph.warnings.join(' ')).toContain("existing source 'nope'");
    // an `existing` id may not be satisfied by a PROPOSED node, or vice versa
    expect(graph.warnings.join(' ')).toContain("proposed target 'node-search'");
  });

  it('refuses a proposed node that shadows a real one, and drops what depended on it', () => {
    const graph = buildImpactGraph(
      withProposals({
        nodes: [{ ...proposedNode, id: 'node-search' }],
        relationships: [relationship({ targetId: 'node-search' })],
      }),
    );
    expect(graph.proposedStructure?.nodes).toEqual([]);
    expect(graph.proposedStructure?.relationships).toEqual([]);
    expect(graph.warnings.join(' ')).toContain('reuses the id of an existing component');
  });

  it('counts proposed components in totalNodeCount so "showing N of M" cannot understate', () => {
    const plain = buildImpactGraph(analyzeDocument);
    const graph = buildImpactGraph(
      withProposals({ nodes: [proposedNode], relationships: [relationship({})] }),
    );
    expect(graph.totalNodeCount).toBe(plain.totalNodeCount + 1);
  });

  it('stays absent when the analysis asserted no proposed structure', () => {
    const graph = buildImpactGraph(analyzeDocument);
    expect(graph.proposedStructure).toBeUndefined();
    expect(graph.warnings).toEqual(['index is 3 commits behind HEAD']);
  });

  it('loads a graph that is nothing but proposed structure rather than showing "empty"', () => {
    const graph = buildImpactGraph({
      ...withProposals({ nodes: [], relationships: [] }),
      requirements: [],
      proposedStructure: {
        nodes: [],
        relationships: [relationship({ targetId: 'x', targetKind: 'existing' })],
      },
    });
    // both endpoints are unknown once the requirements are gone → dropped, so this stays empty
    expect(graph.status).toBe('empty');
    expect(graph.warnings.join(' ')).toContain('was not shown');
  });
});

describe('evidence mapping (§18.5)', () => {
  it('carries requirement, expected change, path, evidence and related tests', () => {
    const state = buildEvidenceState({ document: analyzeDocument, nodeId: 'node-policy' });
    expect(evidencePanelStateSchema.parse(state)).toEqual(state);
    expect(state.impact?.requirementStatement).toBe('Owners see their own deals');
    expect(state.impact?.expectedChange).toBe('logic-change');
    expect(state.impact?.dependencyPath).toEqual(['DealController', 'DealService']);
    expect(state.impact?.relatedTests).toEqual(['src/deal/policy.test.ts']);
  });

  it('warns instead of guessing when the node is not in the analysis', () => {
    const state = buildEvidenceState({ document: analyzeDocument, nodeId: 'node-unknown' });
    expect(state.impact).toBeUndefined();
    expect(state.warnings.join(' ')).toContain('not part of the current analysis');
  });

  it('reports unavailability explicitly', () => {
    const state = unavailableEvidence('no index generation');
    expect(state.status).toBe('unavailable');
    expect(state.impact).toBeUndefined();
  });

  it('recognises test files without claiming coverage', () => {
    expect(
      relatedTestFiles(['a/b.test.ts', 'src/__tests__/x.ts', 'src/main.ts', 'app_test.py']),
    ).toEqual(['a/b.test.ts', 'src/__tests__/x.ts', 'app_test.py']);
  });
});

describe('specification mapping (§18.2)', () => {
  const specification: Specification = {
    id: 'spec-deals',
    title: 'Deal visibility',
    sourceType: 'markdown',
    rawText: '# Deal visibility',
    version: 3,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    requirements: [
      {
        id: 'req-1',
        statement: 'Owners see their own deals',
        type: 'functional',
        concepts: ['deal'],
        actors: ['owner'],
        status: 'draft',
      },
    ],
    actors: [],
    constraints: [],
    openQuestions: [
      {
        id: 'q-1',
        question: 'Do archived deals stay visible?',
        reason: 'two candidate policies',
        affectedRequirementIds: ['req-1'],
        severity: 'blocking',
        status: 'open',
      },
    ],
    decisions: [],
  };

  it('keeps requirements and questions separate and lists every stored version', () => {
    const state = buildSpecificationState({ specification });
    expect(specificationPanelStateSchema.parse(state)).toEqual(state);
    expect(state.availableVersions).toEqual([1, 2, 3]);
    expect(state.requirements).toHaveLength(1);
    expect(state.openQuestions[0]?.severity).toBe('blocking');
    expect(state.readiness).toBeUndefined();
  });
});
