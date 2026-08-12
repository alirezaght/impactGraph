import ts from 'typescript';

import { deterministicEnvelope } from '../fragment-builder.js';

import { evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';

/**
 * Symbol MEMBERS: enum members, union literals, and the values of a const object used as an enum.
 *
 * Resolution used to stop at the top-level symbol. `ItemType` existed, so a specification asserting
 * `ItemType.ANGEBOT` resolved, and the assertion was never contradicted — the member was
 * implemented against and did not exist. What is missing is not cleverness; it is the members
 * themselves being in the graph at all.
 *
 * Only DECLARED members are emitted, and only from shapes where the member set is closed and
 * literal. A union of computed types, or an enum with computed initialisers, declares a set this
 * reader cannot enumerate — so it emits nothing for it, and the assumption checker stays silent
 * rather than reporting a member as missing from a set it never fully read.
 */

const MAX_MEMBERS = 200;

interface MemberFact {
  readonly containerName: string;
  readonly containerKind: 'enum' | 'union' | 'const-object';
  readonly memberName: string;
  readonly node: ts.Node;
}

/** `enum ItemType { GESUCH = 'gesuch' }` — the closed, declared case. */
const enumMembers = (declaration: ts.EnumDeclaration): readonly MemberFact[] => {
  const facts: MemberFact[] = [];
  for (const member of declaration.members) {
    if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
      facts.push({
        containerName: declaration.name.text,
        containerKind: 'enum',
        memberName: member.name.text,
        node: member,
      });
    }
  }
  return facts;
};

/** `type ItemType = 'GESUCH' | 'ANGEBOT'` — a union of string literals, and nothing else. */
const unionMembers = (declaration: ts.TypeAliasDeclaration): readonly MemberFact[] => {
  if (!ts.isUnionTypeNode(declaration.type)) {
    return [];
  }
  const literals = declaration.type.types.filter(
    (member): member is ts.LiteralTypeNode =>
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
  );
  // A union that is only PARTLY literal declares a set this reader cannot enumerate. Emitting the
  // literal half would let the checker report a member as missing from a set it never fully read.
  if (literals.length !== declaration.type.types.length || literals.length === 0) {
    return [];
  }
  const facts: MemberFact[] = [];
  for (const member of literals) {
    if (ts.isStringLiteral(member.literal)) {
      facts.push({
        containerName: declaration.name.text,
        containerKind: 'union',
        memberName: member.literal.text,
        node: member,
      });
    }
  }
  return facts;
};

/**
 * The object literal a `const X = { … } as const` declares, when the whole thing is readable.
 *
 * Undefined for a spread, a computed key, or a non-object initialiser — all cases where the member
 * set is not closed, and where emitting the readable half would let the checker report a member as
 * missing from a set it never fully read.
 */
const closedObjectLiteral = (
  declaration: ts.VariableDeclaration,
): ts.ObjectLiteralExpression | undefined => {
  const initializer = declaration.initializer;
  const object =
    initializer !== undefined && ts.isAsExpression(initializer)
      ? initializer.expression
      : initializer;
  if (object === undefined || !ts.isObjectLiteralExpression(object)) {
    return undefined;
  }
  const assignments = object.properties.filter(ts.isPropertyAssignment);
  return assignments.length === object.properties.length && assignments.length > 0
    ? object
    : undefined;
};

/** `const ItemType = { GESUCH: 'gesuch' } as const` — the enum-shaped object. */
const constObjectMembers = (declaration: ts.VariableDeclaration): readonly MemberFact[] => {
  const object = closedObjectLiteral(declaration);
  if (object === undefined || !ts.isIdentifier(declaration.name)) {
    return [];
  }
  const containerName = declaration.name.text;
  const facts: MemberFact[] = [];
  for (const property of object.properties.filter(ts.isPropertyAssignment)) {
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      facts.push({
        containerName,
        containerKind: 'const-object',
        memberName: property.name.text,
        node: property,
      });
    }
  }
  return facts;
};

const collect = (source: ts.SourceFile): readonly MemberFact[] => {
  const facts: MemberFact[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isEnumDeclaration(node)) {
      facts.push(...enumMembers(node));
    } else if (ts.isTypeAliasDeclaration(node)) {
      facts.push(...unionMembers(node));
    } else if (ts.isVariableDeclaration(node)) {
      facts.push(...constObjectMembers(node));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return facts.slice(0, MAX_MEMBERS);
};

const CONTAINER_TYPE = {
  enum: 'enum',
  union: 'enum',
  'const-object': 'enum',
} as const;

const MEMBER_TYPE = {
  enum: 'enum-member',
  union: 'union-literal',
  'const-object': 'union-literal',
} as const;

const emitContainer = (
  state: ParseState,
  fact: MemberFact,
  containerId: string,
  evidenceId: string,
): void => {
  state.builder.addNode(
    {
      id: containerId,
      category: 'application',
      type: CONTAINER_TYPE[fact.containerKind],
      name: fact.containerName,
      path: state.filePath,
      knowledge: deterministicEnvelope(state.context, [evidenceId]),
    },
    state.filePath,
  );
};

const memberEvidence = (state: ParseState, fact: MemberFact): string | undefined => {
  const range = rangeOf(state.source, fact.node);
  return state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'symbol-declaration', range),
      kind: 'symbol-declaration',
      source: {
        kind: 'file',
        filePath: state.filePath,
        range,
        symbolName: `${fact.containerName}.${fact.memberName}`,
      },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

export const collectSymbolMembers = (state: ParseState): void => {
  const containers = new Set<string>();
  for (const fact of collect(state.source)) {
    const evidenceId = memberEvidence(state, fact);
    if (evidenceId === undefined) {
      continue;
    }
    const containerId = `member-container:${state.filePath}#${fact.containerName}`;
    if (!containers.has(containerId)) {
      containers.add(containerId);
      emitContainer(state, fact, containerId, evidenceId);
    }
    const memberId = `${containerId}.${fact.memberName}`;
    state.builder.addNode(
      {
        id: memberId,
        category: 'application',
        type: MEMBER_TYPE[fact.containerKind],
        name: fact.memberName,
        path: state.filePath,
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
    state.builder.addEdge(
      {
        id: `declares-member:${containerId}->${fact.memberName}`,
        type: 'DECLARES_MEMBER',
        sourceId: containerId,
        targetId: memberId,
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
  }
};
