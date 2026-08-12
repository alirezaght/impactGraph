import { deterministicEnvelope } from '../fragment-builder.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import type { PythonParseState } from './python-context.js';
import type { Node } from 'web-tree-sitter';

/**
 * Members of a Python `Enum` class.
 *
 * `ItemType.ANGEBOT` was assumed by a specification, implemented against, and did not exist. The
 * class was indexed; what was inside it was not, so the reference resolved and nobody was
 * contradicted.
 *
 * Only classes that DECLARE themselves an enum are read. A plain class's attributes are not a
 * closed member set — an instance can grow them at runtime — and treating them as one would let the
 * assumption checker report a member as missing from a set that was never closed.
 */

const ENUM_BASES = new Set(['Enum', 'IntEnum', 'StrEnum', 'Flag', 'IntFlag', 'ReprEnum']);

const MAX_MEMBERS = 200;

/** True when the class states an enum base — `class ItemType(str, Enum)` included. */
export const declaresEnumBase = (declaration: Node): boolean => {
  const bases = fieldNode(declaration, 'superclasses');
  if (bases === undefined) {
    return false;
  }
  return namedChildrenOf(bases).some((base) => {
    const text = base.text.trim();
    return ENUM_BASES.has(text) || ENUM_BASES.has(text.split('.').pop() ?? '');
  });
};

/** `NAME = value` at class level. Members with no assignment are not declared values. */
const assignedNames = (declaration: Node): readonly { name: string; node: Node }[] => {
  const body = fieldNode(declaration, 'body');
  if (body === undefined) {
    return [];
  }
  const found: { name: string; node: Node }[] = [];
  for (const statement of namedChildrenOf(body)) {
    const assignment =
      statement.type === 'expression_statement' ? namedChildrenOf(statement)[0] : undefined;
    if (assignment === undefined || assignment.type !== 'assignment') {
      continue;
    }
    const target = fieldNode(assignment, 'left');
    if (target === undefined || target.type !== 'identifier') {
      continue;
    }
    found.push({ name: target.text, node: assignment });
  }
  return found.slice(0, MAX_MEMBERS);
};

export const addEnumMembers = (
  state: PythonParseState,
  declaration: Node,
  className: string,
  classNodeId: string,
): void => {
  if (!declaresEnumBase(declaration)) {
    return;
  }
  for (const member of assignedNames(declaration)) {
    const evidenceId = state.builder.addEvidence(
      {
        id: `ev:${state.filePath}#${className}.${member.name}`,
        kind: 'symbol-declaration',
        source: {
          kind: 'file',
          filePath: state.filePath,
          symbolName: `${className}.${member.name}`,
        },
        repositorySnapshotId: state.context.repositorySnapshotId,
        createdAt: state.context.createdAt,
      },
      state.filePath,
    );
    if (evidenceId === undefined) {
      continue;
    }
    const memberId = `${classNodeId}.${member.name}`;
    state.builder.addNode(
      {
        id: memberId,
        category: 'application',
        type: 'enum-member',
        name: member.name,
        path: state.filePath,
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
    state.builder.addEdge(
      {
        id: `declares-member:${classNodeId}->${member.name}`,
        type: 'DECLARES_MEMBER',
        sourceId: classNodeId,
        targetId: memberId,
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
  }
};
