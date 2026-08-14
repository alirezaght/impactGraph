import ts from 'typescript';

import { deterministicEnvelope } from '../fragment-builder.js';

import { evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';

/**
 * Field-level flow for the patterns that carry payloads (item 7).
 *
 * Deliberately NOT a dataflow engine. The instruction was explicit — "Do not build a theoretically
 * complete dataflow engine" — and a complete one would be unsound here anyway: without types
 * resolved across files, every assignment is a guess. What IS deterministic is the shape a payload
 * travels in, and that is what this extracts:
 *
 *   * a declared field of an interface or type literal → a `field` node;
 *   * an object literal `{ expiry: row.expiresAt }` → `expiresAt` FLOWS_TO `expiry`, and when the
 *     names differ, RENAMED_TO as well;
 *   * `{ id: row.id }` → the same field name on both sides: FLOWS_TO, no rename.
 *
 * What it refuses: a computed key, a spread, a call result, a conditional. Each of those is a value
 * whose origin the syntax does not state, and inventing a flow for it is the same class of mistake as
 * inventing a node from prose (item 2).
 */

/** `field:<file>#<Type>.<name>` — a declared field of a declared shape. */
export const fieldNodeId = (filePath: string, owner: string, name: string): string =>
  `field:${filePath}#${owner}.${name}`;

const isOptionalOrNullable = (member: ts.PropertySignature): boolean => {
  if (member.questionToken !== undefined) {
    return true;
  }
  const type = member.type;
  if (type === undefined || !ts.isUnionTypeNode(type)) {
    return false;
  }
  return type.types.some(
    (entry) =>
      entry.kind === ts.SyntaxKind.NullKeyword ||
      entry.kind === ts.SyntaxKind.UndefinedKeyword ||
      (ts.isLiteralTypeNode(entry) && entry.literal.kind === ts.SyntaxKind.NullKeyword),
  );
};

/**
 * Declared fields of an interface become `field` nodes owned by their shape.
 *
 * Nullability is recorded in the node NAME suffix rather than a bespoke attribute, so it survives
 * every serializer unchanged and shows up in a diff — "a field became nullable" is a contract change
 * and has to be visible as one.
 */
export const collectDeclaredFields = (
  state: ParseState,
  declaration: ts.InterfaceDeclaration,
  ownerNodeId: string,
  /** Field name → node ids declared in this file, accumulated for the same-file flow resolution. */
  index: Map<string, string[]>,
): void => {
  const owner = declaration.name.text;
  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) {
      continue;
    }
    const name = member.name.text;
    const range = rangeOf(state.source, member);
    const evidenceId = state.builder.addEvidence(
      {
        id: evidenceIdFor(state, 'symbol-declaration', range),
        kind: 'symbol-declaration',
        source: { kind: 'file', filePath: state.filePath, range, symbolName: name },
        repositorySnapshotId: state.context.repositorySnapshotId,
        createdAt: state.context.createdAt,
      },
      state.filePath,
    );
    if (evidenceId === undefined) {
      continue;
    }
    const nodeId = fieldNodeId(state.filePath, owner, name);
    // ADR-0020 §3 — the declared type is a fact the parse already holds: recorded verbatim
    // (trimmed), never inferred, and absent when the declaration states none.
    const declaredType = member.type?.getText(state.source).trim();
    state.builder.addNode(
      {
        id: nodeId,
        category: 'data',
        type: 'field',
        name: isOptionalOrNullable(member) ? `${owner}.${name}?` : `${owner}.${name}`,
        path: state.filePath,
        ...(declaredType === undefined || declaredType.length === 0 ? {} : { declaredType }),
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
    state.builder.addEdge(
      {
        id: `edge:field-of:${nodeId}`,
        type: 'CONTAINS',
        sourceId: ownerNodeId,
        targetId: nodeId,
        knowledge: deterministicEnvelope(state.context, [evidenceId]),
      },
      state.filePath,
    );
    index.set(name, [...(index.get(name) ?? []), nodeId]);
  }
};

/**
 * A field-to-field assignment inside an object literal, resolved at assembly time.
 *
 * The target name is stated by the property; the source name is stated by the property access. Both
 * are syntax, which is why this can be a fact. The OWNER of each side is not stated — that needs the
 * types — so the reference travels by field NAME and assembly joins it to whichever declared fields
 * carry that name in scope.
 */
export interface FieldAssignment {
  readonly filePath: string;
  /** Property name on the left: `{ expiry: … }` → `expiry`. */
  readonly targetField: string;
  /** Property being read on the right: `row.expiresAt` → `expiresAt`. */
  readonly sourceField: string;
  readonly enclosingSymbolNodeId?: string;
  /** Declared shapes of the enclosing signature, when it annotates them. */
  readonly owners: FlowOwners;
  readonly evidenceId: string;
}

/**
 * The shapes a mapper declares it maps between.
 *
 * `(row: DealRow): DealDto => ({ expiry: row.expiresAt })` states all four facts in its syntax: the
 * source shape, the target shape, the source field and the target field. Reading the annotations is
 * what makes the flow EXACT rather than name-matched — without them, `{ id: row.id }` resolves to
 * `id` on both shapes and the direction is unknowable, which is a refusal, not a coin toss.
 */
export interface FlowOwners {
  /** Type names of the parameters. */
  readonly sources: readonly string[];
  /** Declared return type name. */
  readonly target?: string;
}

const typeNameOf = (type: ts.TypeNode | undefined): string | undefined => {
  if (type === undefined) {
    return undefined;
  }
  // `Promise<DealDto>` / `readonly DealDto[]` are wrappers around the shape, not the shape.
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const argument = type.typeArguments?.[0];
    return argument === undefined
      ? type.typeName.text
      : (typeNameOf(argument) ?? type.typeName.text);
  }
  if (ts.isArrayTypeNode(type)) {
    return typeNameOf(type.elementType);
  }
  return undefined;
};

export const ownersOf = (signature: ts.SignatureDeclarationBase): FlowOwners => {
  const target = typeNameOf(signature.type);
  return {
    sources: signature.parameters
      .map((parameter) => typeNameOf(parameter.type))
      .filter((name): name is string => name !== undefined),
    ...(target === undefined ? {} : { target }),
  };
};

const assignmentIn = (
  state: ParseState,
  property: ts.ObjectLiteralElementLike,
): { target: string; source: string } | undefined => {
  // REFUSALS, each for the same reason: the syntax does not state where the value came from.
  if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
    return undefined;
  }
  const initializer = property.initializer;
  if (ts.isPropertyAccessExpression(initializer) && ts.isIdentifier(initializer.name)) {
    return { target: property.name.text, source: initializer.name.text };
  }
  if (ts.isIdentifier(initializer)) {
    return { target: property.name.text, source: initializer.text };
  }
  void state;
  return undefined;
};

/** Walk one body for object literals and record the field assignments they state. */
export const collectFieldAssignments = (
  state: ParseState,
  body: ts.Node | undefined,
  enclosingSymbolNodeId: string,
  owners: FlowOwners = { sources: [] },
): readonly FieldAssignment[] => {
  if (body === undefined) {
    return [];
  }
  const assignments: FieldAssignment[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const found = assignmentIn(state, property);
        if (found === undefined) {
          continue;
        }
        const range = rangeOf(state.source, property);
        const evidenceId = state.builder.addEvidence(
          {
            id: evidenceIdFor(state, 'call-site', range),
            kind: 'call-site',
            source: {
              kind: 'file',
              filePath: state.filePath,
              range,
              symbolName: found.target,
            },
            repositorySnapshotId: state.context.repositorySnapshotId,
            createdAt: state.context.createdAt,
          },
          state.filePath,
        );
        if (evidenceId !== undefined) {
          assignments.push({
            filePath: state.filePath,
            targetField: found.target,
            sourceField: found.source,
            enclosingSymbolNodeId,
            owners,
            evidenceId,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return assignments;
};

/**
 * Resolve field assignments against the fields declared IN THE SAME FILE, and emit the flow.
 *
 * Same-file only, stated rather than approximated (PRD §34). A DTO mapper and the two shapes it maps
 * between overwhelmingly live together — that is the whole point of a mapper — and resolving across
 * files needs the type checker, which this adapter deliberately does not run. A cross-file flow is
 * therefore not emitted at all rather than guessed, and `unresolvedFieldFlows` reports the count so
 * the gap is visible instead of silent.
 */
export interface FieldFlowOutcome {
  readonly emitted: number;
  readonly unresolved: number;
}

export const emitFieldFlows = (
  state: ParseState,
  assignments: readonly FieldAssignment[],
  index: ReadonlyMap<string, readonly string[]>,
): FieldFlowOutcome => {
  let emitted = 0;
  let unresolved = 0;
  for (const assignment of assignments) {
    const sourceId = resolveSide({
      state,
      assignment,
      ownerNames: assignment.owners.sources,
      side: 'source',
      index,
    });
    const targetId = resolveSide({
      state,
      assignment,
      ownerNames: assignment.owners.target === undefined ? [] : [assignment.owners.target],
      side: 'target',
      index,
    });
    if (sourceId === undefined || targetId === undefined || sourceId === targetId) {
      unresolved += 1;
      continue;
    }
    emitted += emitFlowEdges(state, assignment, sourceId, targetId);
  }
  return { emitted, unresolved };
};

/**
 * One side of an assignment, resolved to a single declared field node.
 *
 * Preference order: the shape the signature ANNOTATES, then the only shape in the file carrying that
 * field name. Anything else is undefined — with two candidate shapes and no annotation, the direction
 * of the flow is unknowable from syntax, and guessing produces an edge pointing the wrong way.
 */
interface SideInput {
  readonly state: ParseState;
  readonly assignment: FieldAssignment;
  readonly ownerNames: readonly string[];
  readonly side: 'source' | 'target';
  readonly index: ReadonlyMap<string, readonly string[]>;
}

const resolveSide = ({
  state,
  assignment,
  ownerNames,
  side,
  index,
}: SideInput): string | undefined => {
  const field = side === 'source' ? assignment.sourceField : assignment.targetField;
  for (const owner of ownerNames) {
    const candidate = fieldNodeId(state.filePath, owner, field);
    if ((index.get(field) ?? []).includes(candidate)) {
      return candidate;
    }
  }
  const declared = index.get(field) ?? [];
  return declared.length === 1 ? declared[0] : undefined;
};

const emitFlowEdges = (
  state: ParseState,
  assignment: FieldAssignment,
  sourceId: string,
  targetId: string,
): number => {
  const knowledge = deterministicEnvelope(state.context, [assignment.evidenceId]);
  let emitted = 0;
  for (const type of assignment.sourceField === assignment.targetField
    ? (['FLOWS_TO'] as const)
    : // A rename is BOTH a flow and a rename: the value travels, and its name changes. Emitting only
      // RENAMED_TO would break the flow chain; emitting only FLOWS_TO would lose the answer to
      // "where is it renamed?" (item 7).
      (['FLOWS_TO', 'RENAMED_TO'] as const)) {
    const edge = state.builder.addEdge(
      {
        id: `edge:${type.toLowerCase()}:${sourceId}->${targetId}`,
        type,
        sourceId,
        targetId,
        knowledge,
      },
      assignment.filePath,
    );
    if (edge !== undefined) {
      emitted += 1;
    }
  }
  return emitted;
};
