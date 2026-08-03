import type { SourceRange } from '@impactgraph/domain';
import type { Node } from 'web-tree-sitter';

// Small, typed helpers over the tree-sitter CST. Nothing here leaks outside the adapters:
// `GraphFragment` never carries a syntax node (PRD §C14).

/** tree-sitter positions are zero-based; evidence ranges are one-based (provenance-model.md). */
export const rangeOfNode = (node: Node): SourceRange => ({
  startLine: node.startPosition.row + 1,
  startColumn: node.startPosition.column + 1,
  endLine: node.endPosition.row + 1,
  endColumn: node.endPosition.column + 1,
});

/** `children`/`namedChildren` are typed `(Node | null)[]` by web-tree-sitter — narrow them. */
export const namedChildrenOf = (node: Node): readonly Node[] =>
  node.namedChildren.filter((child): child is Node => child !== null);

export const fieldNodes = (node: Node, field: string): readonly Node[] =>
  node.childrenForFieldName(field).filter((child): child is Node => child !== null);

export const fieldNode = (node: Node, field: string): Node | undefined =>
  node.childForFieldName(field) ?? undefined;

export const firstNamedChildOfType = (node: Node, type: string): Node | undefined =>
  namedChildrenOf(node).find((child) => child.type === type);

const MAX_REPORTED_ERRORS = 3;

const describe = (node: Node): string =>
  `${node.isMissing ? 'missing' : 'unexpected'} syntax at line ${String(node.startPosition.row + 1)}`;

/**
 * Error-recovery nodes are tolerated and reported, never fatal (PRD §34): tree-sitter still
 * produces a usable tree around them, so the surrounding facts are kept. Reporting is capped so
 * one pathological file cannot flood the warning channel.
 */
export const errorRecoveryWarnings = (root: Node): readonly string[] => {
  if (!root.hasError) {
    return [];
  }
  const found: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0 && found.length < MAX_REPORTED_ERRORS) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.isError || node.isMissing) {
      found.push(describe(node));
      continue;
    }
    stack.push(...node.children.filter((child): child is Node => child !== null).reverse());
  }
  return found.length === 0 ? [] : [`parsed with error recovery: ${found.join('; ')}`];
};
