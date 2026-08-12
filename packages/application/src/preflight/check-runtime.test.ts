import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import {
  configuredNamesByProcess,
  resolveRuntimePaths,
} from '../build-runtime-topology/resolve-runtime-paths.js';

import { checkRuntime } from './check-runtime.js';

import type { GraphEdge, GraphNode, KnowledgeGraph, NodeCategory } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-12T00:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, category: NodeCategory, type: string, name: string): GraphNode => {
  const result = createGraphNode({ id, category, type, name, knowledge });
  if (!result.ok) {
    throw new Error(`node ${id}: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

/**
 * The aggregator topology, exactly as it bit:
 *
 *   admin → NEWSLETTER_SERVICE_URL → frontend_service_urls.newsletter → _agg.newsletter
 *         → aggregator container → aggregator handler
 *
 * The plan configures `newsletter-service`. The aggregator container is what actually serves the
 * request, and it receives none of the new variables.
 */
const aggregatorGraph = (aggregatorEnv: readonly string[]): KnowledgeGraph => {
  const nodes: GraphNode[] = [
    node('url:NEWSLETTER_SERVICE_URL', 'infrastructure', 'service-url', 'NEWSLETTER_SERVICE_URL'),
    node(
      'local:frontend_service_urls.newsletter',
      'infrastructure',
      'terraform-local',
      'frontend_service_urls.newsletter',
    ),
    node('local:_agg.newsletter', 'infrastructure', 'terraform-local', '_agg.newsletter'),
    node('run:aggregator', 'infrastructure', 'cloud-run-service', 'aggregator'),
    node('container:aggregator', 'infrastructure', 'container', 'aggregator container'),
    node('svc:aggregator-handler', 'application', 'handler', 'aggregatorNewsletterHandler'),
    node('run:newsletter-service', 'infrastructure', 'cloud-run-service', 'newsletter-service'),
    ...aggregatorEnv.map((name) =>
      node(`env:agg:${name}`, 'infrastructure', 'environment-variable', name),
    ),
  ];
  const edges: GraphEdge[] = [
    edge(
      'e1',
      'RESOLVES_TO',
      'url:NEWSLETTER_SERVICE_URL',
      'local:frontend_service_urls.newsletter',
    ),
    edge('e2', 'RESOLVES_TO', 'local:frontend_service_urls.newsletter', 'local:_agg.newsletter'),
    edge('e3', 'ROUTES_TO', 'local:_agg.newsletter', 'run:aggregator'),
    edge('e4', 'CONTAINS', 'run:aggregator', 'container:aggregator'),
    edge('e5', 'RUNS_IN', 'container:aggregator', 'svc:aggregator-handler'),
    ...aggregatorEnv.map((name, index) =>
      edge(`e-env-${String(index)}`, 'RECEIVES_ENV', 'container:aggregator', `env:agg:${name}`),
    ),
  ];
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error(`graph: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const nextId = (seed: string): string => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 60)}`;

const requirements = [
  {
    name: 'SENDGRID_TEMPLATE_IDS_JSON',
    requiredByNodeId: 'svc:aggregator-handler',
    evidenceIds: ['ev-1'],
  },
];

describe('resolveRuntimePaths', () => {
  it('follows a URL through Terraform locals to the process that actually serves it', () => {
    const paths = resolveRuntimePaths({ graph: aggregatorGraph([]) });
    expect(paths).toHaveLength(1);
    const path = paths[0];
    expect(path?.hops.map((hop) => hop.name)).toEqual([
      'NEWSLETTER_SERVICE_URL',
      'frontend_service_urls.newsletter',
      '_agg.newsletter',
      'aggregator',
      'aggregator container',
      'aggregatorNewsletterHandler',
    ]);
    expect(path?.incompleteReason).toBeUndefined();
  });
});

describe('checkRuntime — the aggregator scenario', () => {
  it('reports the gap when the serving process lacks the configuration the plan adds', () => {
    const graph = aggregatorGraph([]);
    const findings = checkRuntime({
      paths: resolveRuntimePaths({ graph }),
      requirements,
      configuredByProcess: configuredNamesByProcess(graph),
      planConfiguredNodeIds: new Set(['run:newsletter-service']),
      requirementIds: ['R3'],
      nextId,
    });
    const gap = findings.find((finding) => finding.statement.includes('does not receive'));
    expect(gap).toBeDefined();
    expect(gap?.kind).toBe('runtime-topology-gap');
    expect(gap?.severity).toBe('blocking');
    expect(gap?.statement).toContain('aggregator container');
    expect(gap?.statement).toContain('SENDGRID_TEMPLATE_IDS_JSON');
    expect(gap?.recommendation).toContain('Propagate');
  });

  it('also reports that the plan never mentions the serving process', () => {
    const graph = aggregatorGraph([]);
    const findings = checkRuntime({
      paths: resolveRuntimePaths({ graph }),
      requirements,
      configuredByProcess: configuredNamesByProcess(graph),
      planConfiguredNodeIds: new Set(['run:newsletter-service']),
      requirementIds: ['R3'],
      nextId,
    });
    expect(
      findings.some((finding) => finding.statement.includes('which the plan does not mention')),
    ).toBe(true);
  });

  it('stays quiet once the serving container receives the configuration', () => {
    const graph = aggregatorGraph(['SENDGRID_TEMPLATE_IDS_JSON']);
    const findings = checkRuntime({
      paths: resolveRuntimePaths({ graph }),
      requirements,
      configuredByProcess: configuredNamesByProcess(graph),
      planConfiguredNodeIds: new Set(['run:aggregator', 'container:aggregator']),
      requirementIds: ['R3'],
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('warns instead of blocking when the path could not be fully resolved', () => {
    const graph = aggregatorGraph([]);
    const partial = resolveRuntimePaths({ graph }).map((path) => ({
      ...path,
      incompleteReason: 'the chain stops before reaching a handler',
    }));
    const findings = checkRuntime({
      paths: partial,
      requirements,
      configuredByProcess: configuredNamesByProcess(graph),
      planConfiguredNodeIds: new Set(['run:newsletter-service']),
      requirementIds: ['R3'],
      nextId,
    });
    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(findings.some((finding) => finding.statement.includes('could not be resolved'))).toBe(
      true,
    );
  });
});
