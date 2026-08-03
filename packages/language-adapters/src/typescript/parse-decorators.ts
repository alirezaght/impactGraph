import ts from 'typescript';

import { declarationEvidence, evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';

/** Identifier arrays from one object-literal argument: `{providers: [A, B]}` → {providers:[A,B]}. */
const identifierListsOf = (args: readonly ts.Expression[]): Record<string, readonly string[]> => {
  const lists: Record<string, readonly string[]> = {};
  const objectArg = args.find(ts.isObjectLiteralExpression);
  for (const property of objectArg?.properties ?? []) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      ts.isArrayLiteralExpression(property.initializer)
    ) {
      lists[property.name.text] = property.initializer.elements
        .filter(ts.isIdentifier)
        .map((element) => element.text);
    }
  }
  return lists;
};

/** Decorators are language facts (Epic 03): extracted once, consumed by framework adapters. */
export const collectDecorators = (
  state: ParseState,
  node: ts.HasDecorators,
  targetNodeId: string,
): void => {
  for (const decorator of ts.getDecorators(node) ?? []) {
    const expression = decorator.expression;
    const call = ts.isCallExpression(expression) ? expression : undefined;
    const nameNode = call?.expression ?? expression;
    if (!ts.isIdentifier(nameNode)) {
      continue;
    }
    const range = rangeOf(state.source, decorator);
    const evidenceId = state.builder.addEvidence(
      {
        id: evidenceIdFor(state, 'decorator', range),
        kind: 'decorator',
        source: { kind: 'file', filePath: state.filePath, range, symbolName: nameNode.text },
        repositorySnapshotId: state.context.repositorySnapshotId,
        createdAt: state.context.createdAt,
      },
      state.filePath,
    );
    if (evidenceId === undefined) {
      continue;
    }
    const args = [...(call?.arguments ?? [])];
    state.builder.addDecorator({
      targetNodeId,
      decoratorName: nameNode.text,
      stringArguments: args.filter(ts.isStringLiteral).map((arg) => arg.text),
      identifierLists: identifierListsOf(args),
      filePath: state.filePath,
      evidenceId,
    });
  }
};

/** Constructor parameter types are static dependencies → `injects` references (DI edges). */
export const collectInjections = (
  state: ParseState,
  declaration: ts.ClassDeclaration,
  classNodeId: string,
): void => {
  const ctor = declaration.members.find(ts.isConstructorDeclaration);
  for (const parameter of ctor?.parameters ?? []) {
    const type = parameter.type;
    if (type === undefined || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
      continue;
    }
    const evidenceId = declarationEvidence(state, parameter, type.typeName.text);
    if (evidenceId !== undefined) {
      state.builder.addSymbolReference({
        kind: 'injects',
        fromSymbolNodeId: classNodeId,
        filePath: state.filePath,
        targetName: type.typeName.text,
        evidenceId,
      });
    }
  }
};
