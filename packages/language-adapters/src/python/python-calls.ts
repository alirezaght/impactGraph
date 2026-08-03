import { fieldNode } from '../tree-sitter/syntax.js';

import { callSiteEvidence } from './python-context.js';
import { callArguments, dottedName } from './python-syntax.js';

import type { PythonParseState } from './python-context.js';
import type { Node } from 'web-tree-sitter';

// Two channels, deliberately split (mirroring the TypeScript adapter):
//
// * bare `foo()` / `Foo()` → a SymbolReference the assembly stage resolves into a CALLS edge;
// * `receiver.method(...)` → a CallFact, the raw material for call-convention frameworks
//   (`app.include_router(...)`, `background_tasks.add_task(...)`). Receiver-qualified calls need
//   type resolution to bind, so they are reported as facts and never guessed into edges.

interface CallShape {
  readonly receiverName?: string;
  readonly calleeName: string;
}

const shapeOf = (call: Node): CallShape | undefined => {
  const callee = fieldNode(call, 'function');
  if (callee === undefined) {
    return undefined;
  }
  if (callee.type === 'identifier') {
    return { calleeName: callee.text };
  }
  const dotted = dottedName(callee);
  if (dotted === undefined) {
    return undefined; // subscripted or computed callees — out of scope
  }
  const lastDot = dotted.lastIndexOf('.');
  return { receiverName: dotted.slice(0, lastDot), calleeName: dotted.slice(lastDot + 1) };
};

export interface CallFactOptions {
  readonly assignedTo?: string;
  readonly enclosingSymbolNodeId?: string;
}

/** Record one `receiver.method(...)` (or assigned `Constructor(...)`) call as a CallFact. */
export const recordCallFact = (
  state: PythonParseState,
  call: Node,
  options: CallFactOptions,
): void => {
  const shape = shapeOf(call);
  if (shape === undefined) {
    return;
  }
  const evidenceId = callSiteEvidence(state, call, shape.calleeName);
  if (evidenceId === undefined) {
    return;
  }
  const args = callArguments(fieldNode(call, 'arguments'));
  state.builder.addCallFact({
    filePath: state.filePath,
    ...(options.assignedTo === undefined ? {} : { assignedTo: options.assignedTo }),
    ...(shape.receiverName === undefined ? {} : { receiverName: shape.receiverName }),
    calleeName: shape.calleeName,
    stringArguments: args.strings,
    identifierArguments: args.identifiers,
    ...(Object.keys(args.keywordStrings).length === 0
      ? {}
      : { keywordStringArguments: args.keywordStrings }),
    ...(options.enclosingSymbolNodeId === undefined
      ? {}
      : { enclosingSymbolNodeId: options.enclosingSymbolNodeId }),
    evidenceId,
  });
};

const MAX_CALLS_PER_BODY = 200;

interface BareCall {
  readonly name: string;
  readonly node: Node;
}

interface BodyScan {
  readonly bareCalls: readonly BareCall[];
  readonly memberCalls: readonly Node[];
}

/** Collect the calls inside one function body, bounded so a generated file cannot flood the run. */
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
    const callee = node.type === 'call' ? fieldNode(node, 'function') : undefined;
    if (callee?.type === 'identifier') {
      if (!seen.has(callee.text)) {
        seen.add(callee.text);
        bareCalls.push({ name: callee.text, node });
      }
    } else if (callee !== undefined) {
      memberCalls.push(node);
    }
    stack.push(...node.namedChildren.filter((child): child is Node => child !== null));
  }
  return { bareCalls, memberCalls };
};

/** Emit the call facts and call references found in one function/method body. */
export const collectBodyCalls = (
  state: PythonParseState,
  body: Node,
  fromSymbolNodeId: string,
): void => {
  const scan = scanBody(body);
  for (const call of scan.memberCalls) {
    recordCallFact(state, call, { enclosingSymbolNodeId: fromSymbolNodeId });
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
