import ts from 'typescript';

import { fileNodeId } from '../fallback/fallback-adapter.js';

// Which graph node owns a call site that is NOT at module level.
//
// The rule is deliberately conservative: only ancestors that `parse-source.ts` actually emitted a
// symbol node for are eligible. A nested arrow function, a non-exported `const`, an object-literal
// method — none of those have a node, so an edge pointing at an invented `symbol:…#inner` id would
// reference a node nothing else in the graph knows about. Assembly does not validate language-fact
// edge endpoints, so a dangling id would survive into the persisted graph; the file node is the
// honest fallback (PRD §34: report less rather than report wrong).

const isTopLevel = (node: ts.Node): boolean => ts.isSourceFile(node.parent);

const isExported = (node: ts.HasModifiers): boolean =>
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** `handleMethod` emits `symbol:<file>#<Class>.<method>` for members of a top-level class. */
const methodOwnerName = (node: ts.Node): string | undefined => {
  if (!ts.isMethodDeclaration(node) || !ts.isIdentifier(node.name)) {
    return undefined;
  }
  const owner = node.parent;
  if (!ts.isClassDeclaration(owner) || owner.name === undefined || !isTopLevel(owner)) {
    return undefined;
  }
  return `${owner.name.text}.${node.name.text}`;
};

/** `handleFunction` emits `symbol:<file>#<name>` for every named top-level function. */
const functionOwnerName = (node: ts.Node): string | undefined =>
  ts.isFunctionDeclaration(node) && node.name !== undefined && isTopLevel(node)
    ? node.name.text
    : undefined;

/** `handleVariables` emits a node only for EXPORTED top-level variable declarations. */
const variableOwnerName = (node: ts.Node): string | undefined => {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
    return undefined;
  }
  const statement = node.parent.parent;
  const exported =
    ts.isVariableStatement(statement) && isTopLevel(statement) && isExported(statement);
  return exported ? node.name.text : undefined;
};

/**
 * The id of the nearest ancestor with a symbol node, or the file node. Always an id the same
 * parse emitted — never invented.
 */
export const ownerNodeId = (filePath: string, node: ts.Node): string => {
  for (let current: ts.Node | undefined = node.parent; current !== undefined;) {
    const name =
      methodOwnerName(current) ?? functionOwnerName(current) ?? variableOwnerName(current);
    if (name !== undefined) {
      return `symbol:${filePath}#${name}`;
    }
    current = current.parent;
  }
  return fileNodeId(filePath);
};
