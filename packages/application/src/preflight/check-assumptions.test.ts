import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { checkAssumptions } from './check-assumptions.js';
import { checkConfigSemantics, classifyConfig } from './check-config-semantics.js';

import type { GraphEdge, GraphNode, KnowledgeGraph, NodeCategory } from '@impactgraph/domain';

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
}

const node = ({ id, category, type, name, path }: NodeSpec): GraphNode => {
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

const edge = (id: string, type: string, from: string, to: string): GraphEdge => {
  const result = createGraphEdge({ id, type, sourceId: from, targetId: to, knowledge });
  if (!result.ok) {
    throw new Error(`edge ${id}: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

/** An `ItemType` enum declaring three members, none of them ANGEBOT. */
const enumGraph = (members: readonly string[]): KnowledgeGraph => {
  const nodes = [
    node({
      id: 'sym:ItemType',
      category: 'application',
      type: 'enum',
      name: 'ItemType',
      path: 'src/domain/item_type.py',
    }),
    ...members.map((member) =>
      node({
        id: `sym:ItemType.${member}`,
        category: 'application',
        type: 'enum-member',
        name: member,
      }),
    ),
  ];
  const edges = members.map((member, index) =>
    edge(`e${String(index)}`, 'DECLARES_MEMBER', 'sym:ItemType', `sym:ItemType.${member}`),
  );
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error(`graph: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

const nextId = (seed: string): string => `finding-${seed.replace(/[^a-z0-9]/gi, '-').slice(0, 60)}`;

describe('checkAssumptions — the ItemType.ANGEBOT scenario', () => {
  it('reports an invalid assumption when the member does not exist', () => {
    const findings = checkAssumptions({
      requirementId: 'R4',
      statement: 'The search filter uses ItemType.ANGEBOT when the listing is an offer.',
      graph: enumGraph(['GESUCH', 'IMMOBILIE', 'BETEILIGUNG']),
      nextId,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('invalid-assumption');
    expect(finding?.severity).toBe('blocking');
    expect(finding?.statement).toContain('ItemType.ANGEBOT');
    expect(finding?.statement).toContain('not a enum member of ItemType');
    expect(finding?.recommendation).toContain('GESUCH');
    expect(finding?.subject.assumedSymbol).toBe('ItemType.ANGEBOT');
  });

  it('stays quiet when the member exists', () => {
    const findings = checkAssumptions({
      requirementId: 'R4',
      statement: 'The search filter uses ItemType.GESUCH when the listing is a request.',
      graph: enumGraph(['GESUCH', 'IMMOBILIE']),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('does not call a requirement that CREATES the member an invalid assumption', () => {
    const findings = checkAssumptions({
      requirementId: 'R4',
      statement: 'Add ItemType.ANGEBOT to the listing type enum.',
      graph: enumGraph(['GESUCH', 'IMMOBILIE']),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('says nothing when the container is indexed but its members were never extracted', () => {
    const bare = createKnowledgeGraph(
      [node({ id: 'sym:ItemType', category: 'application', type: 'enum', name: 'ItemType' })],
      [],
    );
    expect(bare.ok).toBe(true);
    if (!bare.ok) {
      return;
    }
    const findings = checkAssumptions({
      requirementId: 'R4',
      statement: 'The search filter uses ItemType.ANGEBOT.',
      graph: bare.value,
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('says nothing when the container itself is not indexed', () => {
    const findings = checkAssumptions({
      requirementId: 'R4',
      statement: 'The search filter uses ListingKind.ANGEBOT.',
      graph: enumGraph(['GESUCH']),
      nextId,
    });
    expect(findings).toEqual([]);
  });
});

describe('classifyConfig — the SENDGRID_TEMPLATE_IDS_JSON scenario', () => {
  const declaration = {
    name: 'SENDGRID_TEMPLATE_IDS_JSON',
    filePath: 'services/newsletter-service/settings.py',
    evidenceIds: ['ev-1'],
  };

  it('recognises a truthy default that means "not configured"', () => {
    expect(classifyConfig({ ...declaration, defaultLiteral: '"{}"' })).toBe(
      'empty-but-truthy-default',
    );
    expect(classifyConfig({ ...declaration, defaultLiteral: '[]' })).toBe(
      'empty-but-truthy-default',
    );
    expect(classifyConfig({ ...declaration, defaultLiteral: '""' })).toBe(
      'empty-but-truthy-default',
    );
  });

  it('separates a real default from a missing one', () => {
    expect(classifyConfig({ ...declaration, defaultLiteral: '"d-12345"' })).toBe('defaulted');
    expect(classifyConfig(declaration)).toBe('required');
    expect(classifyConfig({ ...declaration, toleratesAbsence: true })).toBe('fail-open-default');
  });

  it('warns about the truthy-empty default without blocking', () => {
    const findings = checkConfigSemantics({
      declarations: [{ ...declaration, defaultLiteral: '"{}"' }],
      requirementIds: ['R5'],
      nextId,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.statement).toContain('present and truthy but represents missing');
  });

  it('says nothing about a configuration value with a real default', () => {
    expect(
      checkConfigSemantics({
        declarations: [{ ...declaration, defaultLiteral: '"d-12345"' }],
        requirementIds: ['R5'],
        nextId,
      }),
    ).toEqual([]);
  });
});
