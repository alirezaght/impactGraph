import { createGraphEdge, createGraphNode, createKnowledgeGraph } from '@impactgraph/domain';
import { describe, expect, it } from 'vitest';

import { checkAssumptions } from './check-assumptions.js';

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

/** An `ItemType` enum declaring the given members — the ANGEBOT scenario's graph shape. */
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

/**
 * The SqlOutboundQueueRepository.list_rows field case: the class inherits `list_rows` from a
 * mixin, and the check once reported it nonexistent because membership was judged against one
 * node's outgoing member edges without ever following EXTENDS/IMPLEMENTS.
 */
interface HierarchySpec {
  /** class name → its own method names (nodes named `Class.method`, linked via CONTAINS). */
  readonly methodsByClass: Readonly<Record<string, readonly string[]>>;
  /** subclass name → base name, linked via EXTENDS. */
  readonly extendsPairs: readonly (readonly [string, string])[];
  /** class names whose base could not be resolved — an unresolved-external-boundary supertype. */
  readonly openClasses?: readonly string[];
}

const hierarchyGraph = (spec: HierarchySpec): KnowledgeGraph => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const [className, methods] of Object.entries(spec.methodsByClass)) {
    nodes.push(
      node({
        id: `sym:${className}`,
        category: 'application',
        type: 'class',
        name: className,
        path: `app/${className.toLowerCase()}.py`,
      }),
    );
    for (const method of methods) {
      nodes.push(
        node({
          id: `sym:${className}.${method}`,
          category: 'application',
          type: 'method',
          name: `${className}.${method}`,
        }),
      );
      edges.push(
        edge(
          `c:${className}.${method}`,
          'CONTAINS',
          `sym:${className}`,
          `sym:${className}.${method}`,
        ),
      );
    }
  }
  for (const [child, base] of spec.extendsPairs) {
    edges.push(edge(`x:${child}->${base}`, 'EXTENDS', `sym:${child}`, `sym:${base}`));
  }
  for (const open of spec.openClasses ?? []) {
    nodes.push(
      node({
        id: `ext:${open}`,
        category: 'integration',
        type: 'unresolved-external-boundary',
        name: `${open}ExternalBase`,
      }),
    );
    edges.push(edge(`x:${open}->ext`, 'EXTENDS', `sym:${open}`, `ext:${open}`));
  }
  const result = createKnowledgeGraph(nodes, edges);
  if (!result.ok) {
    throw new Error(`graph: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
};

describe('checkAssumptions — inherited members (the SqlOutboundQueueRepository.list_rows case)', () => {
  const mixinSpec: HierarchySpec = {
    methodsByClass: {
      SqlOutboundQueueRepository: ['save'],
      OutboundAuditReadsMixin: ['list_rows'],
    },
    extendsPairs: [['SqlOutboundQueueRepository', 'OutboundAuditReadsMixin']],
  };

  it('stays silent when the member is declared on a mixin the class EXTENDS', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.list_rows to page pending events.',
      graph: hierarchyGraph(mixinSpec),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('resolves members through multi-level inheritance chains', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.audit_source when tracing.',
      graph: hierarchyGraph({
        methodsByClass: {
          SqlOutboundQueueRepository: ['save'],
          OutboundAuditReadsMixin: ['list_rows'],
          AuditBase: ['audit_source'],
        },
        extendsPairs: [
          ['SqlOutboundQueueRepository', 'OutboundAuditReadsMixin'],
          ['OutboundAuditReadsMixin', 'AuditBase'],
        ],
      }),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('judges a subclass that declares no members of its own against its base types', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.list_rows to page pending events.',
      graph: hierarchyGraph({
        methodsByClass: { SqlOutboundQueueRepository: [], OutboundAuditReadsMixin: ['list_rows'] },
        extendsPairs: [['SqlOutboundQueueRepository', 'OutboundAuditReadsMixin']],
      }),
      nextId,
    });
    expect(findings).toEqual([]);
  });

  it('terminates and still judges correctly when the inheritance graph has a cycle', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.vanish when compacting.',
      graph: hierarchyGraph({
        methodsByClass: {
          SqlOutboundQueueRepository: ['save'],
          OutboundAuditReadsMixin: ['list_rows'],
        },
        extendsPairs: [
          ['SqlOutboundQueueRepository', 'OutboundAuditReadsMixin'],
          ['OutboundAuditReadsMixin', 'SqlOutboundQueueRepository'],
        ],
      }),
      nextId,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('blocking');
  });

  it('states what was searched when the member is absent in a closed world', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.vanish when compacting.',
      graph: hierarchyGraph(mixinSpec),
      nextId,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.kind).toBe('invalid-assumption');
    expect(finding?.severity).toBe('blocking');
    expect(finding?.statement).toContain(
      'not found on SqlOutboundQueueRepository or its 1 resolved base type(s) at the indexed revision',
    );
    expect(finding?.recommendation).toContain('list_rows');
  });

  it('says "could not be verified" — a warning, never blocking — when a base type is outside the index', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.list_rows to page pending events.',
      graph: hierarchyGraph({
        methodsByClass: { SqlOutboundQueueRepository: ['save'] },
        extendsPairs: [],
        openClasses: ['SqlOutboundQueueRepository'],
      }),
      nextId,
    });
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.severity).toBe('warning');
    // ADR-0023: the honest kind is `invalid-assumption` — it is a statement about an assumption.
    // What keeps it from stopping work is its EVIDENCE grade, not its kind.
    expect(finding?.kind).toBe('invalid-assumption');
    expect(finding?.verification).toBe('unverified-assumption');
    expect(finding?.statement).toContain('could not be verified');
    expect(finding?.statement).toContain('inherits from types outside the index');
    expect(finding?.statement).not.toContain('is not a member');
  });

  it('keeps an enum closed-world even though it extends a base outside the index', () => {
    // `class ItemType(Enum)` always extends the stdlib Enum — an unresolved supertype by
    // construction. An enum's member roster is syntactically complete regardless, so ANGEBOT
    // missing must stay a blocking fact, never degrade to "could not verify".
    const base = enumGraph(['GESUCH', 'IMMOBILIE']);
    const boundary = node({
      id: 'ext:Enum',
      category: 'integration',
      type: 'unresolved-external-boundary',
      name: 'Enum',
    });
    const withOpenBase = createKnowledgeGraph(
      [...base.nodes.values(), boundary],
      [...base.edges.values(), edge('x:enum', 'EXTENDS', 'sym:ItemType', 'ext:Enum')],
    );
    if (!withOpenBase.ok) {
      throw new Error('graph invalid');
    }
    const findings = checkAssumptions({
      requirementId: 'R4',
      statement: 'The search filter uses ItemType.ANGEBOT when the listing is an offer.',
      graph: withOpenBase.value,
      nextId,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('invalid-assumption');
    expect(findings[0]?.severity).toBe('blocking');
  });

  it('keeps the extraction-gap silence when nothing in the hierarchy declares members', () => {
    const findings = checkAssumptions({
      requirementId: 'R7',
      statement: 'The relay uses SqlOutboundQueueRepository.list_rows to page pending events.',
      graph: hierarchyGraph({
        methodsByClass: { SqlOutboundQueueRepository: [], OutboundAuditReadsMixin: [] },
        extendsPairs: [['SqlOutboundQueueRepository', 'OutboundAuditReadsMixin']],
      }),
      nextId,
    });
    expect(findings).toEqual([]);
  });
});
