import ts from 'typescript';

import { fileNodeId } from '../file-node.js';

import { declarationEvidence } from './parse-context.js';
import { collectDecorators, collectInjections } from './parse-decorators.js';
import { collectDeclaredFields, collectFieldAssignments, ownersOf } from './parse-field-flow.js';
import {
  addSymbolNode,
  collectCalls,
  handleHeritage,
  isExported,
  ROUTE_FILE_PATTERN,
} from './parse-symbols.js';

import type { ParseState } from './parse-context.js';
import type { FieldFlowState } from './parse-symbols.js';

// Per-declaration handlers: class, method, interface, function, exported const. Split out of
// parse-source.ts, which had grown past the effective-LOC budget once field-flow extraction (item 7)
// joined it. The split is by responsibility, not by line count: parse-source owns the file-level walk
// and the import/heritage resolution; this module owns "what one declaration contributes".

export const handleClass = (state: ParseState, declaration: ts.ClassDeclaration): void => {
  const name = declaration.name?.text;
  if (name === undefined) {
    state.builder.warn(state.filePath, 'anonymous default-export class skipped');
    return;
  }
  const nodeId = `symbol:${state.filePath}#${name}`;
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: 'class',
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
    exported: isExported(declaration),
  });
  handleHeritage(state, declaration, nodeId);
  collectDecorators(state, declaration, nodeId);
  collectInjections(state, declaration, nodeId);
  for (const member of declaration.members) {
    if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
      handleMethod(state, member, name, nodeId);
    }
  }
};

const handleMethod = (
  state: ParseState,
  member: ts.MethodDeclaration,
  className: string,
  classNodeId: string,
): void => {
  if (!ts.isIdentifier(member.name)) {
    return;
  }
  const methodName = member.name.text;
  const methodEvidence = declarationEvidence(state, member, methodName);
  if (methodEvidence === undefined) {
    return;
  }
  const methodNodeId = `symbol:${state.filePath}#${className}.${methodName}`;
  addSymbolNode(state, {
    nodeId: methodNodeId,
    category: 'application',
    type: 'method',
    name: `${className}.${methodName}`,
    evidenceId: methodEvidence,
    containerId: classNodeId,
    exported: false,
  });
  collectDecorators(state, member, methodNodeId);
  if (member.body !== undefined) {
    collectCalls(state, member.body, methodNodeId);
  }
};

export const handleInterface = (
  state: ParseState,
  declaration: ts.InterfaceDeclaration,
  flow: FieldFlowState,
): void => {
  const name = declaration.name.text;
  const nodeId = `symbol:${state.filePath}#${name}`;
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: 'interface',
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
    exported: isExported(declaration),
  });
  handleHeritage(state, declaration, nodeId);
  collectDeclaredFields(state, declaration, nodeId, flow.declaredFields);
};

export const handleFunction = (
  state: ParseState,
  declaration: ts.FunctionDeclaration,
  flow: FieldFlowState,
): void => {
  const name = declaration.name?.text;
  if (name === undefined) {
    return;
  }
  const evidenceId = declarationEvidence(state, declaration, name);
  if (evidenceId === undefined) {
    return;
  }
  const exported = isExported(declaration);
  const isRouteHandler = exported && ROUTE_FILE_PATTERN.test(state.filePath);
  const nodeId = `symbol:${state.filePath}#${name}`;
  addSymbolNode(state, {
    nodeId,
    category: 'application',
    type: isRouteHandler ? 'api-endpoint' : 'function',
    name,
    evidenceId,
    containerId: fileNodeId(state.filePath),
    exported,
    // The api-endpoint typing is derived from directory convention, not parsed semantics.
    ...(isRouteHandler ? { provenance: 'framework-convention' as const } : {}),
  });
  if (declaration.body !== undefined) {
    collectCalls(state, declaration.body, nodeId);
    flow.assignments.push(
      ...collectFieldAssignments(state, declaration.body, nodeId, ownersOf(declaration)),
    );
  }
};

export const handleVariables = (
  state: ParseState,
  statement: ts.VariableStatement,
  flow: FieldFlowState,
): void => {
  if (!isExported(statement)) {
    return;
  }
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      continue;
    }
    const name = declaration.name.text;
    const evidenceId = declarationEvidence(state, declaration, name);
    if (evidenceId === undefined) {
      continue;
    }
    const nodeId = `symbol:${state.filePath}#${name}`;
    addSymbolNode(state, {
      nodeId,
      category: 'repository',
      type: 'symbol',
      name,
      evidenceId,
      containerId: fileNodeId(state.filePath),
      exported: true,
    });
    // `export const renderMessage = (…) => {…}` is a function by every standard except the
    // AST node kind, and its body holds the same facts a `function` declaration's does. Walking it
    // is what makes `t('nda.signature_request.subject')` inside an arrow function visible at all —
    // arrow-const is the dominant style in the repositories the trials ran on.
    const initializer = declaration.initializer;
    const signature =
      initializer !== undefined &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ? ownersOf(initializer)
        : undefined;
    const body = bodyOfInitializer(declaration);
    collectCalls(state, body, nodeId);
    flow.assignments.push(
      ...collectFieldAssignments(state, body, nodeId, signature ?? { sources: [] }),
    );
  }
};

/** The body of an arrow function or function expression initializer, when there is one. */
const bodyOfInitializer = (declaration: ts.VariableDeclaration): ts.Node | undefined => {
  const initializer = declaration.initializer;
  if (initializer === undefined) {
    return undefined;
  }
  return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
    ? initializer.body
    : undefined;
};
