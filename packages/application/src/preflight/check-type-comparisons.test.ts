import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { checkTypeComparisons, sqlComparisonPatterns } from './check-type-comparisons.js';

import type { GraphEdge, GraphNode, KnowledgeGraph, NodeCategory } from '@impactgraph/domain';

// ADR-0020 §4 — the UUID/SQL near-miss: a plan proposed `listing.id = ANY(:ids)` with
// string-bound ids against a UUID column. Every fact needed to question it was indexable; this
// analyzer puts them side by side and warns — it never blocks.

const knowledge = {
  provenance: 'static-analysis' as const,
  evidenceIds: ['ev-1'],
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: '2026-08-14T00:00:00.000Z',
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

const node = (spec: NodeSpec): GraphNode => {
  const result = createGraphNode({ ...spec, knowledge });
  if (!result.ok) {
    throw new Error(`node ${spec.id}: ${JSON.stringify(result.error.issues)}`);
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

const modelGraph = (fields: readonly NodeSpec[]): KnowledgeGraph => {
  const owner = node({
    id: 'sym:Listing',
    category: 'application',
    type: 'class',
    name: 'Listing',
    path: 'app/listings.py',
  });
  const fieldNodes = fields.map(node);
  const edges = fieldNodes.map((field, index) =>
    edge(`e${String(index)}`, 'DECLARES_MEMBER', 'sym:Listing', String(field.id)),
  );
  const result = createKnowledgeGraph([owner, ...fieldNodes], edges);
  if (!result.ok) {
    throw new Error('graph');
  }
  return result.value;
};

const uuidIdField: NodeSpec = {
  id: 'sym:Listing.id',
  category: 'data',
  type: 'field',
  name: 'Listing.id',
  path: 'app/listings.py',
  declaredType: 'UUID',
};

const nextId = (seed: string): string => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 60)}`;

const check = (
  statement: string,
  fields: readonly NodeSpec[] = [uuidIdField],
  analogous?: readonly { pattern: string; filePath: string; line?: number }[],
) =>
  checkTypeComparisons({
    specificationText: statement,
    graph: modelGraph(fields),
    requirementIds: ['R2'],
    ...(analogous === undefined ? {} : { analogousLiterals: analogous }),
    nextId,
  });

describe('checkTypeComparisons — the listing.id = ANY(:ids) scenario', () => {
  it('warns when SQL compares a UUID column against bound parameters', () => {
    const findings = check('Filter with SELECT * FROM listings WHERE listing.id = ANY(:ids).');
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('type-sensitive-comparison');
    expect(finding?.severity).toBe('warning');
    expect(finding?.statement).toContain('Listing.id');
    expect(finding?.statement).toContain("'UUID'");
    expect(finding?.statement).toContain('app/listings.py');
    expect(finding?.subject.nodeIds).toEqual(['sym:Listing.id']);
    expect(finding?.subject.filePaths).toEqual(['app/listings.py']);
    expect(finding?.analyzer).toBe('check-type-comparisons');
  });

  it('points at analogous literals for the same operator when the caller supplied them', () => {
    const findings = check(
      'Run UPDATE listings SET x = 1 WHERE listing.id = ANY(:ids).',
      [uuidIdField],
      [{ pattern: '= ANY(', filePath: 'app/queries.py', line: 10 }],
    );
    expect(findings[0]?.recommendation).toContain('app/queries.py:10');
    expect(findings[0]?.recommendation).toContain('compare the binding');
  });

  it('omits the analogous clause entirely when none were supplied', () => {
    const findings = check('SELECT 1 WHERE listing.id = ANY(:ids)');
    expect(findings[0]?.recommendation).not.toContain('Similar SQL');
  });

  it('reads fenced SQL blocks', () => {
    const spec = [
      'Apply the following:',
      '```sql',
      'DELETE FROM listings',
      'WHERE listing.id = ANY(:listing_ids)',
      '```',
    ].join('\n');
    expect(check(spec)).toHaveLength(1);
  });

  it('resolves plural table tokens against the singular owner', () => {
    expect(check('DELETE FROM listings WHERE listings.id = ANY(:ids)')).toHaveLength(1);
  });

  it('covers = :param and IN (:param) comparisons and date/numeric/boolean families', () => {
    const fields: NodeSpec[] = [
      {
        id: 'sym:Listing.closed_on',
        category: 'data',
        type: 'field',
        name: 'Listing.closed_on',
        path: 'app/listings.py',
        declaredType: 'Date',
      },
      {
        id: 'sym:Listing.active',
        category: 'data',
        type: 'field',
        name: 'Listing.active',
        path: 'app/listings.py',
        declaredType: 'Boolean',
      },
    ];
    const findings = check(
      'SELECT * FROM listings WHERE listing.closed_on IN (:dates) AND listing.active = :active',
      fields,
    );
    expect(findings.map((finding) => finding.subject.assumedSymbol).sort()).toEqual([
      'listing.active',
      'listing.closed_on',
    ]);
  });

  it('stays silent for string-ish columns — nothing type-sensitive to compare', () => {
    const stringField: NodeSpec = { ...uuidIdField, declaredType: 'String(64)' };
    expect(check('SELECT 1 WHERE listing.id = ANY(:ids)', [stringField])).toEqual([]);
  });

  it('stays silent for a column the index does not know', () => {
    expect(check('SELECT 1 WHERE listing.slug = ANY(:slugs)')).toEqual([]);
  });

  it('stays silent for creation language describing a NEW column', () => {
    expect(check('Add a new listing.id column populated where listing.id = :id.')).toEqual([]);
  });

  it('stays silent on lines with no SQL shape at all', () => {
    expect(check('The listing.id = ANY(:ids) idea was discussed.')).toEqual([]);
  });

  it('resolves a bare column only when exactly one indexed field carries the name', () => {
    const twoIds: NodeSpec[] = [
      uuidIdField,
      { ...uuidIdField, id: 'sym:Deal.id', name: 'Deal.id' },
    ];
    expect(check('SELECT 1 FROM listings WHERE id = ANY(:ids)', twoIds)).toEqual([]);
    expect(check('SELECT 1 FROM listings WHERE id = ANY(:ids)', [uuidIdField])).toHaveLength(1);
  });

  it('emits one finding per column even when the comparison repeats', () => {
    const spec = 'SELECT 1 WHERE listing.id = ANY(:a); DELETE FROM x WHERE listing.id = ANY(:b)';
    expect(check(spec)).toHaveLength(1);
  });
});

describe('sqlComparisonPatterns — the operator vocabulary the caller searches literals for', () => {
  it('reports the distinct operators the specification used, SQL-shaped lines only', () => {
    expect(
      sqlComparisonPatterns('SELECT 1 WHERE a.b = ANY(:ids) AND c.d IN (:xs) AND e = :y'),
    ).toEqual(['= ANY(', 'IN (:', '= :']);
  });

  it('reports nothing for prose without SQL shapes', () => {
    expect(sqlComparisonPatterns('The importer assigns ids to listings.')).toEqual([]);
  });
});
