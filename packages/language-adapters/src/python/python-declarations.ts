import { fileNodeId } from '../file-node.js';
import { deterministicEnvelope } from '../fragment-builder.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { collectBodyCalls } from './python-calls.js';
import { declarationEvidence } from './python-context.js';
import { collectDecorators } from './python-decorators.js';
import { addEnumMembers } from './python-members.js';

import type { PythonParseState } from './python-context.js';
import type { Node } from 'web-tree-sitter';

// Python declarations → PRD §12.1 nodes: `function`, `class`, `method`, plus a `symbol` for a
// module-level binding. Visibility follows the language's only convention: a leading underscore
// means private, everything else is importable.

const isPublic = (name: string): boolean => !name.startsWith('_');

interface SymbolNodeOptions {
  readonly nodeId: string;
  readonly category: string;
  readonly type: string;
  readonly name: string;
  readonly evidenceId: string;
  readonly containerId: string;
}

const addSymbolNode = (state: PythonParseState, options: SymbolNodeOptions): void => {
  const { builder, context, filePath } = state;
  const knowledge = deterministicEnvelope(context, [options.evidenceId], 'static-analysis');
  const node = builder.addNode(
    {
      id: options.nodeId,
      category: options.category,
      type: options.type,
      name: options.name,
      path: filePath,
      knowledge,
    },
    filePath,
  );
  if (node === undefined) {
    return;
  }
  builder.addEdge(
    {
      id: `contains:${options.nodeId}`,
      type: 'CONTAINS',
      sourceId: options.containerId,
      targetId: options.nodeId,
      knowledge,
    },
    filePath,
  );
};

const declarationName = (declaration: Node): string | undefined =>
  fieldNode(declaration, 'name')?.text;

/** A module-level `def`. Methods go through `addMethod`, which knows its owning class. */
export const addFunction = (
  state: PythonParseState,
  declaration: Node,
  decorators: readonly Node[],
): void => {
  const name = declarationName(declaration);
  if (name === undefined) {
    state.builder.warn(state.filePath, 'function definition without a name — skipped');
    return;
  }
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = `symbol:${state.filePath}#${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: 'function',
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
  });
  if (isPublic(name)) {
    state.builder.addExport(state.filePath, { name, nodeId });
  }
  collectDecorators(state, decorators, nodeId);
  const body = fieldNode(declaration, 'body');
  if (body !== undefined) {
    collectBodyCalls(state, body, nodeId);
  }
};

const addMethod = (
  state: PythonParseState,
  declaration: Node,
  owner: { className: string; nodeId: string },
  decorators: readonly Node[],
): void => {
  const name = declarationName(declaration);
  if (name === undefined) {
    return;
  }
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = `symbol:${state.filePath}#${owner.className}.${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: 'method',
    name: `${owner.className}.${name}`,
    evidenceId,
    containerId: owner.nodeId,
  });
  collectDecorators(state, decorators, nodeId);
  const body = fieldNode(declaration, 'body');
  if (body !== undefined) {
    collectBodyCalls(state, body, nodeId);
  }
};

/** Base classes become `extends` references; unresolvable ones are reported at assembly time. */
const addBaseClasses = (state: PythonParseState, declaration: Node, nodeId: string): void => {
  const superclasses = fieldNode(declaration, 'superclasses');
  for (const base of superclasses === undefined ? [] : namedChildrenOf(superclasses)) {
    if (base.type !== 'identifier') {
      continue; // `class X(Generic[T])`, keyword bases — not a plain inheritance fact
    }
    const evidenceId = declarationEvidence(state, base, base.text);
    if (evidenceId !== undefined) {
      state.builder.addSymbolReference({
        kind: 'extends',
        fromSymbolNodeId: nodeId,
        filePath: state.filePath,
        targetName: base.text,
        evidenceId,
      });
    }
  }
};

const classMembers = (declaration: Node): readonly Node[] => {
  const body = fieldNode(declaration, 'body');
  return body === undefined ? [] : namedChildrenOf(body);
};

export const addClass = (
  state: PythonParseState,
  declaration: Node,
  decorators: readonly Node[],
): void => {
  const name = declarationName(declaration);
  if (name === undefined) {
    state.builder.warn(state.filePath, 'class definition without a name — skipped');
    return;
  }
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = `symbol:${state.filePath}#${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: 'class',
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
  });
  if (isPublic(name)) {
    state.builder.addExport(state.filePath, { name, nodeId });
  }
  collectDecorators(state, decorators, nodeId);
  addBaseClasses(state, declaration, nodeId);
  // ADR-0017 — an enum's members, so a specification asserting one can be contradicted.
  addEnumMembers(state, declaration, name, nodeId);
  for (const member of classMembers(declaration)) {
    const inner = member.type === 'decorated_definition' ? fieldNode(member, 'definition') : member;
    if (inner?.type === 'function_definition') {
      const memberDecorators =
        member.type === 'decorated_definition' ? decoratorsOf(member) : ([] as readonly Node[]);
      addMethod(state, inner, { className: name, nodeId }, memberDecorators);
    }
  }
};

/** The `@…` lines attached to a `decorated_definition`. */
export const decoratorsOf = (decorated: Node): readonly Node[] =>
  namedChildrenOf(decorated).filter((child) => child.type === 'decorator');

/** A module-level binding (`app = FastAPI()`, `router = APIRouter()`) becomes a `symbol` node. */
export const addModuleBinding = (state: PythonParseState, target: Node, assignment: Node): void => {
  const name = target.text;
  if (!isPublic(name)) {
    return;
  }
  const evidenceId = declarationEvidence(state, assignment, name);
  if (evidenceId === undefined) {
    return;
  }
  const nodeId = `symbol:${state.filePath}#${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'repository',
    type: 'symbol',
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
  });
  state.builder.addExport(state.filePath, { name, nodeId });
};
