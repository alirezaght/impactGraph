import ts from 'typescript';

import { evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';

// Module-level call facts (Story 3.3): raw material for call-convention frameworks such as
// Express. Only top-level statements are recorded — bounded, deterministic, syntax-only.

const decompose = (
  call: ts.CallExpression,
): { receiverName?: string; calleeName: string } | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return { calleeName: callee.text };
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    ts.isIdentifier(callee.name)
  ) {
    return { receiverName: callee.expression.text, calleeName: callee.name.text };
  }
  return undefined; // deeper chains (a.b.c()) are out of scope — never guessed
};

const recordCall = (state: ParseState, call: ts.CallExpression, assignedTo?: string): void => {
  const parts = decompose(call);
  if (parts === undefined) {
    return;
  }
  const range = rangeOf(state.source, call);
  const evidenceId = state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'call-site', range),
      kind: 'call-site',
      source: { kind: 'file', filePath: state.filePath, range, symbolName: parts.calleeName },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addCallFact({
    filePath: state.filePath,
    ...(assignedTo === undefined ? {} : { assignedTo }),
    ...(parts.receiverName === undefined ? {} : { receiverName: parts.receiverName }),
    calleeName: parts.calleeName,
    stringArguments: call.arguments.filter(ts.isStringLiteral).map((arg) => arg.text),
    identifierArguments: call.arguments.filter(ts.isIdentifier).map((arg) => arg.text),
    evidenceId,
  });
};

/**
 * `await getCollection('deals')` is the same call as `getCollection('deals')` — the await is a
 * property of how the result is consumed, not of what was called. Top-level await is ordinary in
 * Astro frontmatter and ES modules, so unwrapping it keeps those calls visible.
 */
const callExpressionOf = (node: ts.Expression): ts.CallExpression | undefined => {
  const unwrapped = ts.isAwaitExpression(node) ? node.expression : node;
  return ts.isCallExpression(unwrapped) ? unwrapped : undefined;
};

/** Record `const x = call(...)` and bare `receiver.method(...)` statements at module level. */
export const collectModuleCallFacts = (state: ParseState, statement: ts.Statement): void => {
  if (ts.isExpressionStatement(statement)) {
    const call = callExpressionOf(statement.expression);
    if (call !== undefined) {
      recordCall(state, call);
    }
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const call =
        declaration.initializer === undefined
          ? undefined
          : callExpressionOf(declaration.initializer);
      if (ts.isIdentifier(declaration.name) && call !== undefined) {
        recordCall(state, call, declaration.name.text);
      }
    }
  }
};
