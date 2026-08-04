import ts from 'typescript';

import { evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';

/**
 * Calls made INSIDE a function or method body, recorded with the symbol that encloses them.
 *
 * Why this is needed (trial items 5 and 8). Every pattern the trials said was invisible lives in a
 * body, not at module level: `recordOutboxEvent('notification.nda_signature_request', …)` inside a
 * service method, `t('nda.signature_request.subject')` inside a renderer. Module-level call facts
 * could never see them, so the outbox chain and the locale correspondence had nothing to join on.
 *
 * Why it is BOUNDED rather than "record every call". A body-level call fact is only useful to a
 * framework adapter when its arguments name something — a topic, an event type, a translation key —
 * and recording every call in the repository would multiply the fact table by an order of magnitude
 * for facts nothing reads. So the rule is: record a body-level call only when it passes at least one
 * STRING LITERAL argument. That is the shape every correlation in this codebase joins on, and it is
 * checkable from the syntax alone.
 */

/** Deeper chains (`a.b.c()`) stay out of scope, exactly as at module level — never guessed. */
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
  return undefined;
};

const record = (state: ParseState, call: ts.CallExpression, enclosing: string): void => {
  const parts = decompose(call);
  if (parts === undefined) {
    return;
  }
  const stringArguments = call.arguments
    .filter(ts.isStringLiteral)
    .map((argument) => argument.text);
  if (stringArguments.length === 0) {
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
    ...(parts.receiverName === undefined ? {} : { receiverName: parts.receiverName }),
    calleeName: parts.calleeName,
    stringArguments,
    identifierArguments: call.arguments.filter(ts.isIdentifier).map((argument) => argument.text),
    enclosingSymbolNodeId: enclosing,
    evidenceId,
  });
};

const walk = (state: ParseState, node: ts.Node, enclosing: string): void => {
  if (ts.isCallExpression(node)) {
    record(state, node, enclosing);
  }
  ts.forEachChild(node, (child) => {
    walk(state, child, enclosing);
  });
};

/**
 * Walk one declaration's body. `enclosingSymbolNodeId` must be the id the declaration handler
 * already emitted, so the fact attaches to the symbol a reader will see rather than to a
 * reconstruction of it.
 */
export const collectBodyCallFacts = (
  state: ParseState,
  body: ts.Node | undefined,
  enclosingSymbolNodeId: string,
): void => {
  if (body === undefined) {
    return;
  }
  walk(state, body, enclosingSymbolNodeId);
};
