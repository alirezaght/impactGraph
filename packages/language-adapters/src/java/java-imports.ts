import { fileNodeId } from '../file-node.js';
import { firstNamedChildOfType } from '../tree-sitter/syntax.js';

import { declarationEvidence, importEvidence } from './java-context.js';

import type { JavaParseState } from './java-context.js';
import type { Node } from 'web-tree-sitter';

// Java imports → ImportReference (PRD §12.2 IMPORTS). Cross-file resolution happens at assembly
// time against the scanned file set; the adapter only reports what the source says.

/** `package a.b.c;` and `import a.b.C;` both carry their name as a scoped (or bare) identifier. */
const qualifiedNameOf = (statement: Node): Node | undefined =>
  firstNamedChildOfType(statement, 'scoped_identifier') ??
  firstNamedChildOfType(statement, 'identifier');

/** `com.example.Deal` → { qualifier: 'com.example', simpleName: 'Deal' }. */
const splitQualified = (text: string): { qualifier: string; simpleName: string } => {
  const lastDot = text.lastIndexOf('.');
  return lastDot === -1
    ? { qualifier: '', simpleName: text }
    : { qualifier: text.slice(0, lastDot), simpleName: text.slice(lastDot + 1) };
};

export const readPackageDeclaration = (state: JavaParseState, statement: Node): void => {
  state.packageName = qualifiedNameOf(statement)?.text;
};

const hasChildOfType = (statement: Node, type: string): boolean =>
  statement.children.some((child) => child !== null && child.type === type);

/** What one `import` line binds, and what file a resolver should look for. */
const importShape = (
  statement: Node,
  text: string,
): { specifier: string; boundName: string | undefined } => {
  if (hasChildOfType(statement, 'asterisk')) {
    // `import java.util.*;` names a package, not a type: no binding to record.
    return { specifier: text, boundName: undefined };
  }
  const { qualifier, simpleName } = splitQualified(text);
  return hasChildOfType(statement, 'static')
    ? // `import static org.junit.Assert.assertEquals;` binds the member; the declaring type is
      // the thing a resolver can actually point at.
      { specifier: qualifier, boundName: simpleName }
    : { specifier: text, boundName: simpleName };
};

/** Record one `import` statement. A wildcard legitimately binds nothing — that is not a failure. */
export const collectImport = (state: JavaParseState, statement: Node): void => {
  const name = qualifiedNameOf(statement);
  if (name === undefined) {
    state.builder.warn(state.filePath, 'import declaration without a name — skipped');
    return;
  }
  const evidenceId = importEvidence(state, statement);
  if (evidenceId === undefined) {
    return;
  }
  const shape = importShape(statement, name.text);
  if (shape.boundName !== undefined) {
    state.explicitImports.add(shape.boundName);
    state.importedTypes.set(shape.boundName, name.text);
  }
  state.builder.addImport({
    fromFilePath: state.filePath,
    fromFileNodeId: fileNodeId(state.filePath),
    specifier: shape.specifier,
    importedNames: shape.boundName === undefined ? [] : [shape.boundName],
    // Java has no re-export statement.
    isReExport: false,
    evidenceId,
  });
};

/**
 * Java resolves an unqualified type against the file's own package with no import statement at
 * all. That implicit visibility is a language rule, not a guess — so a type reference the file
 * never imported is reported as a reference to `<own package>.<Type>`, evidenced by the
 * reference site itself rather than by an import line that does not exist. Without this, every
 * same-package dependency (the normal case in Spring services) would be unresolvable.
 */
export const notePackageLocalType = (
  state: JavaParseState,
  typeName: string,
  referenceNode: Node,
): void => {
  const packageName = state.packageName;
  if (
    packageName === undefined ||
    state.explicitImports.has(typeName) ||
    state.impliedImports.has(typeName)
  ) {
    return;
  }
  state.impliedImports.add(typeName);
  const evidenceId = declarationEvidence(state, referenceNode, typeName);
  if (evidenceId === undefined) {
    return;
  }
  state.builder.addImport({
    fromFilePath: state.filePath,
    fromFileNodeId: fileNodeId(state.filePath),
    specifier: `${packageName}.${typeName}`,
    importedNames: [typeName],
    isReExport: false,
    evidenceId,
  });
};
