import { deterministicEnvelope } from '../fragment-builder.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { declaresEnumBase } from './python-members.js';
import { dottedName } from './python-syntax.js';

import type { PythonParseState } from './python-context.js';
import type { Node } from 'web-tree-sitter';

/**
 * Class-attribute fields with a declared type (ADR-0020 §3).
 *
 * The UUID/SQL near-miss needed exactly one fact this adapter used to discard: `id =
 * Column(UUID, primary_key=True)` states the column's type, and nothing indexed it. Annotated
 * attributes (`id: Mapped[uuid.UUID]`, the SQLAlchemy 2 / Pydantic shape) and
 * `Column`/`mapped_column` assignments are the two shapes where the type is literally stated, so
 * those two — and only those — become `field` member nodes carrying the verbatim trimmed text.
 *
 * Everything else is refused, not approximated: a plain assignment states a value, not a data
 * shape; a computed Column type argument states nothing this adapter may know (PRD §35). Enum
 * classes are excluded entirely — their attributes are enum members, owned by python-members.
 */

const COLUMN_CALLEES = new Set(['Column', 'mapped_column']);

const MAX_FIELDS = 200;

/** `Column`, `sa.Column`, `sqlalchemy.orm.mapped_column` — matched on the last dotted segment. */
const isColumnCall = (call: Node): boolean => {
  const callee = fieldNode(call, 'function');
  const dotted = callee === undefined ? undefined : dottedName(callee);
  return dotted !== undefined && COLUMN_CALLEES.has(dotted.split('.').pop() ?? '');
};

/**
 * The text of an expression that reads as a TYPE: `UUID`, `postgresql.UUID`, `String(64)`.
 * SQLAlchemy types are capitalized classes; a lowercase callee (`compute_type()`) is ordinary
 * code whose result the syntax does not state, so it yields nothing rather than a guess.
 */
const typeExpressionText = (node: Node): string | undefined => {
  const named = node.type === 'call' ? fieldNode(node, 'function') : node;
  const dotted = named === undefined ? undefined : dottedName(named);
  const lastSegment = dotted?.split('.').pop();
  if (lastSegment === undefined || !/^[A-Z]/.test(lastSegment)) {
    return undefined;
  }
  return node.text.trim();
};

/** The type argument of `Column(...)`: the first positional that is not the optional name string. */
const columnTypeText = (call: Node): string | undefined => {
  const argumentList = fieldNode(call, 'arguments');
  for (const argument of argumentList === undefined ? [] : namedChildrenOf(argumentList)) {
    if (argument.type === 'keyword_argument') {
      continue;
    }
    if (argument.type === 'string') {
      continue; // `Column("legacy_id", Integer)` — the leading string is the column NAME
    }
    return typeExpressionText(argument);
  }
  return undefined;
};

interface DeclaredField {
  readonly name: string;
  readonly declaredType?: string;
}

const assignmentIn = (statement: Node): Node | undefined => {
  const candidate =
    statement.type === 'expression_statement' ? namedChildrenOf(statement)[0] : undefined;
  return candidate?.type === 'assignment' ? candidate : undefined;
};

/** A public identifier target — `_private` and dunder attributes are convention-hidden. */
const targetNameOf = (assignment: Node): string | undefined => {
  const target = fieldNode(assignment, 'left');
  return target?.type === 'identifier' && !target.text.startsWith('_') ? target.text : undefined;
};

/** `name = Column(TYPE, …)` / `name = mapped_column(TYPE, …)` — or nothing, silently. */
const columnField = (assignment: Node, name: string): DeclaredField | undefined => {
  const value = fieldNode(assignment, 'right');
  if (value === undefined || value.type !== 'call' || !isColumnCall(value)) {
    return undefined;
  }
  const declaredType = columnTypeText(value);
  return { name, ...(declaredType === undefined ? {} : { declaredType }) };
};

/** One class-body statement, read as a field declaration — or nothing, silently. */
const fieldIn = (statement: Node): DeclaredField | undefined => {
  const assignment = assignmentIn(statement);
  const name = assignment === undefined ? undefined : targetNameOf(assignment);
  if (assignment === undefined || name === undefined) {
    return undefined;
  }
  const annotation = fieldNode(assignment, 'type');
  if (annotation !== undefined) {
    const text = annotation.text.trim();
    return { name, ...(text.length === 0 ? {} : { declaredType: text }) };
  }
  return columnField(assignment, name);
};

const declaredFields = (declaration: Node): readonly DeclaredField[] => {
  const body = fieldNode(declaration, 'body');
  if (body === undefined) {
    return [];
  }
  const found: DeclaredField[] = [];
  for (const statement of namedChildrenOf(body)) {
    const field = fieldIn(statement);
    if (field !== undefined) {
      found.push(field);
    }
  }
  return found.slice(0, MAX_FIELDS);
};

/** Mirrors addEnumMembers' id/evidence discipline: same namespace, same edge shape. */
export const addClassFields = (
  state: PythonParseState,
  declaration: Node,
  className: string,
  classNodeId: string,
): void => {
  if (declaresEnumBase(declaration)) {
    return;
  }
  for (const field of declaredFields(declaration)) {
    const evidenceId = state.builder.addEvidence(
      {
        id: `ev:${state.filePath}#${className}.${field.name}`,
        kind: 'symbol-declaration',
        source: {
          kind: 'file',
          filePath: state.filePath,
          symbolName: `${className}.${field.name}`,
        },
        repositorySnapshotId: state.context.repositorySnapshotId,
        createdAt: state.context.createdAt,
      },
      state.filePath,
    );
    if (evidenceId === undefined) {
      continue;
    }
    const fieldId = `${classNodeId}.${field.name}`;
    state.builder.addNode(
      {
        id: fieldId,
        category: 'data',
        type: 'field',
        name: `${className}.${field.name}`,
        path: state.filePath,
        ...(field.declaredType === undefined ? {} : { declaredType: field.declaredType }),
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
    state.builder.addEdge(
      {
        id: `declares-member:${classNodeId}->${field.name}`,
        type: 'DECLARES_MEMBER',
        sourceId: classNodeId,
        targetId: fieldId,
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
  }
};
