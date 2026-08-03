import { fileNodeId } from '../file-node.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import type { PythonParseState } from './python-context.js';
import type { Node } from 'web-tree-sitter';

// Which declared symbol a call sits inside, and a bounded source-order walk of a module.
//
// Shared by every detector that records facts BELOW module level (Pub/Sub clients, HTTP clients),
// because they must agree on the answer: two detectors attributing the same call to two different
// owners would put two different source nodes on edges the graph then cannot reconcile.

/** Bounded so a generated module cannot turn one file into an unbounded walk (PRD §33). */
const MAX_VISITED_NODES = 20_000;

const effectiveParent = (node: Node): Node | undefined => {
  const parent = node.parent ?? undefined;
  return parent?.type === 'decorated_definition' ? (parent.parent ?? undefined) : parent;
};

/** The class name when `block` is the body of a MODULE-LEVEL class; undefined otherwise. */
const moduleLevelClassName = (block: Node): string | undefined => {
  const owner = block.type === 'block' ? effectiveParent(block) : undefined;
  if (owner?.type !== 'class_definition' || effectiveParent(owner)?.type !== 'module') {
    return undefined;
  }
  return fieldNode(owner, 'name')?.text;
};

/**
 * `Class.method` for a direct member of a module-level class; the bare name for a module-level
 * `def`; undefined for anything nested, which has no symbol node of its own to hang an edge on.
 */
const declaredOwnerName = (definition: Node): string | undefined => {
  const name = fieldNode(definition, 'name')?.text;
  const parent = effectiveParent(definition);
  if (name === undefined || parent === undefined) {
    return undefined;
  }
  if (parent.type === 'module') {
    return name;
  }
  const className = moduleLevelClassName(parent);
  return className === undefined ? undefined : `${className}.${name}`;
};

/** The graph id of the declaration containing `node`, falling back to the file's own node. */
export const ownerNodeId = (state: PythonParseState, node: Node): string => {
  for (
    let current = node.parent ?? undefined;
    current !== undefined;
    current = current.parent ?? undefined
  ) {
    const name = current.type === 'function_definition' ? declaredOwnerName(current) : undefined;
    if (name !== undefined) {
      return `symbol:${state.filePath}#${name}`;
    }
  }
  return fileNodeId(state.filePath);
};

/**
 * Pre-order depth-first over a module in SOURCE order (children are pushed reversed so the stack
 * yields them left to right) — `client = TestClient(app)` must be seen before the `client.get(…)`
 * that depends on it. Bounded; reading a tree is not running it (PRD §35).
 */
export const walkPythonTree = (root: Node, visit: (node: Node) => void): void => {
  const stack: Node[] = [root];
  let budget = MAX_VISITED_NODES;
  while (stack.length > 0 && budget > 0) {
    budget -= 1;
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    visit(node);
    stack.push(...[...namedChildrenOf(node)].reverse());
  }
};
