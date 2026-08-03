import { fieldNode } from '../tree-sitter/syntax.js';

import { callSiteEvidence } from './java-context.js';
import { notePackageLocalType } from './java-imports.js';

import type { JavaParseState } from './java-context.js';
import type { JavaTypeScope } from './java-types.js';
import type { Node } from 'web-tree-sitter';

// Two channels, mirroring the TypeScript and Python adapters:
//
// * a bare `helper()` → a SymbolReference the assembly stage resolves into a CALLS edge;
// * `receiver.method(...)` → a CallFact, the raw material for framework adapters.
//
// Story 16.5 added a third, bounded thing on top of the second: when the receiver is a variable
// this file DECLARES — a field, a parameter, a local — its declared type is written down one
// line away, so the call also becomes a `calls` reference to that TYPE. The edge lands on the
// class, not on `DealService.findAll`, because picking the overload needs a type checker; that
// remains out of scope and the CallFact still carries the method name for anyone who needs it.
// A receiver whose type this file does not state stays a CallFact and nothing is guessed.

const MAX_CALLS_PER_BODY = 200;

interface BareCall {
  readonly name: string;
  readonly node: Node;
}

interface BodyScan {
  readonly bareCalls: readonly BareCall[];
  readonly memberCalls: readonly Node[];
}

/** Collect invocations in one body, bounded so a generated file cannot flood the run. */
const scanBody = (body: Node): BodyScan => {
  const bareCalls: BareCall[] = [];
  const memberCalls: Node[] = [];
  const seen = new Set<string>();
  const stack: Node[] = [body];
  while (stack.length > 0 && bareCalls.length + memberCalls.length < MAX_CALLS_PER_BODY) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.type === 'method_invocation') {
      collectInvocation(node, bareCalls, memberCalls, seen);
    }
    stack.push(...node.namedChildren.filter((child): child is Node => child !== null));
  }
  return { bareCalls, memberCalls };
};

const collectInvocation = (
  node: Node,
  bareCalls: BareCall[],
  memberCalls: Node[],
  seen: Set<string>,
): void => {
  const name = fieldNode(node, 'name')?.text;
  if (name === undefined) {
    return;
  }
  if (fieldNode(node, 'object') === undefined) {
    if (!seen.has(name)) {
      seen.add(name);
      bareCalls.push({ name, node });
    }
    return;
  }
  memberCalls.push(node);
};

const stringArgumentsOf = (invocation: Node): string[] => {
  const args = fieldNode(invocation, 'arguments');
  const values: string[] = [];
  for (const argument of args === undefined ? [] : args.namedChildren) {
    if (argument !== null && argument.type === 'string_literal') {
      const fragment = argument.namedChildren.find(
        (child): child is Node => child !== null && child.type === 'string_fragment',
      );
      values.push(fragment?.text ?? '');
    }
  }
  return values;
};

const identifierArgumentsOf = (invocation: Node): string[] => {
  const args = fieldNode(invocation, 'arguments');
  const values: string[] = [];
  for (const argument of args === undefined ? [] : args.namedChildren) {
    if (argument !== null && argument.type === 'identifier') {
      values.push(argument.text);
    }
  }
  return values;
};

const recordCallFact = (state: JavaParseState, invocation: Node, enclosing: string): void => {
  const calleeName = fieldNode(invocation, 'name')?.text;
  const receiverName = fieldNode(invocation, 'object')?.text;
  if (calleeName === undefined || receiverName === undefined) {
    return;
  }
  const evidenceId = callSiteEvidence(state, invocation, calleeName);
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addCallFact({
    filePath: state.filePath,
    receiverName,
    calleeName,
    stringArguments: stringArgumentsOf(invocation),
    identifierArguments: identifierArgumentsOf(invocation),
    enclosingSymbolNodeId: enclosing,
    evidenceId,
  });
};

const PLAIN_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The variable a call is made on, or undefined when the receiver is not a plain name.
 * `this.dealService` is the same variable as `dealService`; `deals.get(0)` and `Deal.of()` are
 * not variables this file declared, so they are left alone.
 */
const receiverVariable = (invocation: Node): string | undefined => {
  const text = fieldNode(invocation, 'object')?.text.replace(/^this\./, '');
  return text !== undefined && PLAIN_IDENTIFIER.test(text) ? text : undefined;
};

interface ReceiverLink {
  readonly state: JavaParseState;
  readonly fromSymbolNodeId: string;
  readonly scope: JavaTypeScope;
  /** Types already linked from this body — one edge per collaborator, not per call site. */
  readonly linked: Set<string>;
}

const linkReceiverType = (link: ReceiverLink, invocation: Node): void => {
  const variable = receiverVariable(invocation);
  // Resolved AT THE CALL SITE: a name declared in a sibling block does not govern this call, and
  // a shadowed one resolves to the declaration Java says is in scope here (see `java-types.ts`).
  const typeName =
    variable === undefined ? undefined : link.scope.get(variable, invocation.startIndex);
  const object = fieldNode(invocation, 'object');
  if (typeName === undefined || object === undefined || link.linked.has(typeName)) {
    return;
  }
  link.linked.add(typeName);
  const evidenceId = callSiteEvidence(link.state, invocation, typeName);
  if (evidenceId === undefined) {
    return;
  }
  notePackageLocalType(link.state, typeName, object);
  link.state.builder.addSymbolReference({
    kind: 'calls',
    fromSymbolNodeId: link.fromSymbolNodeId,
    filePath: link.state.filePath,
    targetName: typeName,
    evidenceId,
  });
};

/** Emit the call facts and call references found in one method/constructor body. */
export const collectBodyCalls = (
  state: JavaParseState,
  body: Node,
  fromSymbolNodeId: string,
  scope: JavaTypeScope,
): void => {
  const scan = scanBody(body);
  const link: ReceiverLink = { state, fromSymbolNodeId, scope, linked: new Set<string>() };
  for (const invocation of scan.memberCalls) {
    recordCallFact(state, invocation, fromSymbolNodeId);
    linkReceiverType(link, invocation);
  }
  for (const bare of scan.bareCalls) {
    const evidenceId = callSiteEvidence(state, bare.node, bare.name);
    if (evidenceId !== undefined) {
      state.builder.addSymbolReference({
        kind: 'calls',
        fromSymbolNodeId,
        filePath: state.filePath,
        targetName: bare.name,
        evidenceId,
      });
    }
  }
};
