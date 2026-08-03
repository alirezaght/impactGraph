import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { assignmentFor, staleAssignments } from './assignments.js';
import { evaluateChangeRules, evaluateDependencyRules } from './evaluate-rules.js';
import { matchesGlob } from './glob.js';

import type { ArchitectureModel, ArchitectureRule } from './types.js';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@impactgraph/domain';

const knowledge = {
  provenance: 'static-analysis',
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-01T10:00:00.000Z',
  repositorySnapshotId: 'snap-1',
  analysisRunId: 'run-1',
};

const node = (id: string, path: string): GraphNode => {
  const result = createGraphNode({
    id,
    category: 'repository',
    type: 'file',
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    knowledge,
  });
  if (!result.ok) {
    throw new Error(`node ${id}`);
  }
  return result.value;
};

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}`);
  }
  return result.value;
};

const graph = (nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph => {
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error('graph invalid');
  }
  return result.value;
};

const model: ArchitectureModel = {
  contexts: [{ name: 'deals', paths: ['src/deals/**'] }],
  components: [
    { path: 'src/domain/**', role: 'domain' },
    { path: 'src/adapters/**', role: 'infrastructure' },
  ],
};

const noDomainToInfra: ArchitectureRule = {
  id: 'no-domain-to-infra',
  type: 'dependency-direction',
  sourceRole: 'domain',
  forbiddenTargetRole: 'infrastructure',
};

describe('glob matching (Story 8.1/8.4)', () => {
  it('handles **, *, and literal patterns over repo-relative paths', () => {
    expect(matchesGlob('src/deals/policy.ts', 'src/deals/**')).toBe(true);
    expect(matchesGlob('src/deals/a/b.ts', 'src/deals/**')).toBe(true);
    expect(matchesGlob('src/other/policy.ts', 'src/deals/**')).toBe(false);
    expect(matchesGlob('src/a.test.ts', 'src/*.test.ts')).toBe(true);
    expect(matchesGlob('src/nested/a.test.ts', 'src/*.test.ts')).toBe(false);
    expect(matchesGlob('prisma/schema.prisma', 'prisma/schema.prisma')).toBe(true);
    // regex specials in the pattern are literal, not interpreted
    expect(matchesGlob('srcXdeals', 'src.deals')).toBe(false);
  });
});

describe('assignments (Stories 8.2/8.3, PRD §16, §Z5)', () => {
  it('resolves role and context; later entries and component context win', () => {
    expect(assignmentFor('src/domain/policy.ts', model)).toEqual({
      role: 'domain',
      context: undefined,
    });
    expect(assignmentFor('src/deals/query.ts', model)).toEqual({
      role: undefined,
      context: 'deals',
    });
    const overridden: ArchitectureModel = {
      contexts: model.contexts,
      components: [{ path: 'src/deals/legacy/**', role: 'generated', context: 'legacy' }],
    };
    expect(assignmentFor('src/deals/legacy/old.ts', overridden)).toEqual({
      role: 'generated',
      context: 'legacy',
    });
  });

  it('flags mappings whose globs match no files — kept for review, never deleted', () => {
    const existing = new Set(['src/deals/policy.ts']);
    const messages = staleAssignments(model, existing);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('src/domain/**');
    expect(messages.every((message) => message.includes('kept, not deleted'))).toBe(true);
    expect(
      staleAssignments(model, new Set(['src/deals/a.ts', 'src/domain/b.ts', 'src/adapters/c.ts'])),
    ).toEqual([]);
  });
});

describe('dependency-direction rules (Story 8.4, PRD §27)', () => {
  const nodes = [
    node('f:domain', 'src/domain/policy.ts'),
    node('f:infra', 'src/adapters/db.ts'),
    node('f:app', 'src/app/service.ts'),
  ];

  it('reports a forbidden dependency with edge and file evidence', () => {
    const violations = evaluateDependencyRules({
      graph: graph(nodes, [edge('e1', 'IMPORTS', 'f:domain', 'f:infra')]),
      model,
      rules: [noDomainToInfra],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleId).toBe('no-domain-to-infra');
    expect(violations[0]?.evidence).toMatchObject({
      edgeId: 'e1',
      sourceNodeId: 'f:domain',
      targetNodeId: 'f:infra',
      filePaths: ['src/domain/policy.ts', 'src/adapters/db.ts'],
    });
  });

  it('ignores allowed directions, non-dependency edges, and unassigned paths', () => {
    const violations = evaluateDependencyRules({
      graph: graph(nodes, [
        edge('e1', 'IMPORTS', 'f:infra', 'f:domain'), // allowed direction
        edge('e2', 'CONTAINS', 'f:domain', 'f:infra'), // not a dependency edge
        edge('e3', 'IMPORTS', 'f:app', 'f:infra'), // source has no role assigned
      ]),
      model,
      rules: [noDomainToInfra],
    });
    expect(violations).toEqual([]);
  });

  it('restricts evaluation to the given paths (review scope)', () => {
    const withEdge = graph(nodes, [edge('e1', 'IMPORTS', 'f:domain', 'f:infra')]);
    const outOfScope = evaluateDependencyRules({
      graph: withEdge,
      model,
      rules: [noDomainToInfra],
      restrictToPaths: new Set(['src/app/service.ts']),
    });
    expect(outOfScope).toEqual([]);
    const inScope = evaluateDependencyRules({
      graph: withEdge,
      model,
      rules: [noDomainToInfra],
      restrictToPaths: new Set(['src/domain/policy.ts']),
    });
    expect(inScope).toHaveLength(1);
  });
});

describe('accompanying-change rules (Story 8.4, PRD §27)', () => {
  const schemaNeedsMigration: ArchitectureRule = {
    id: 'schema-needs-migration',
    type: 'accompanying-change',
    whenChanged: 'prisma/schema.prisma',
    requireChanged: 'prisma/migrations/**',
  };

  it('reports a schema change without a migration, citing the triggering files', () => {
    const violations = evaluateChangeRules(
      ['prisma/schema.prisma', 'src/a.ts'],
      [schemaNeedsMigration],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.evidence.filePaths).toEqual(['prisma/schema.prisma']);
  });

  it('is satisfied when a matching accompanying change exists, and silent when not triggered', () => {
    expect(
      evaluateChangeRules(
        ['prisma/schema.prisma', 'prisma/migrations/20260801/migration.sql'],
        [schemaNeedsMigration],
      ),
    ).toEqual([]);
    expect(evaluateChangeRules(['src/a.ts'], [schemaNeedsMigration])).toEqual([]);
  });
});
