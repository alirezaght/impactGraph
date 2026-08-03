import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { declarationEvidence } from './java-context.js';
import { notePackageLocalType } from './java-imports.js';

import type { JavaParseState } from './java-context.js';
import type { SymbolReference } from '../types.js';
import type { Node } from 'web-tree-sitter';

// Type references that become graph relationships: `extends`/`implements` heritage and
// constructor parameter types. Each is reported as a SymbolReference for the assembly stage to
// resolve — EXTENDS, IMPLEMENTS and (for constructor parameters) USES, exactly as the TypeScript
// adapter reports the same three relationships.

/** `List<String>` → 'List'; `com.example.Deal` → 'Deal'; anything else → undefined. */
export const simpleTypeName = (type: Node): string | undefined => {
  if (type.type === 'type_identifier') {
    return type.text;
  }
  if (type.type === 'scoped_type_identifier') {
    return type.text.slice(type.text.lastIndexOf('.') + 1);
  }
  if (type.type === 'generic_type') {
    const base = namedChildrenOf(type)[0];
    return base === undefined ? undefined : simpleTypeName(base);
  }
  // Primitives (`int`), arrays, and wildcards are not repository types — never guessed at.
  return undefined;
};

const addReference = (
  state: JavaParseState,
  kind: SymbolReference['kind'],
  from: string,
  type: Node,
): void => {
  const targetName = simpleTypeName(type);
  if (targetName === undefined) {
    return;
  }
  const evidenceId = declarationEvidence(state, type, targetName);
  if (evidenceId === undefined) {
    return;
  }
  notePackageLocalType(state, targetName, type);
  state.builder.addSymbolReference({
    kind,
    fromSymbolNodeId: from,
    filePath: state.filePath,
    targetName,
    evidenceId,
  });
};

/** The `type_identifier`s inside a `super_interfaces`/`extends_interfaces` clause. */
const interfaceTypes = (clause: Node): readonly Node[] => {
  const list = namedChildrenOf(clause).find((child) => child.type === 'type_list');
  return list === undefined ? [] : namedChildrenOf(list);
};

const HERITAGE_CLAUSES: Readonly<Record<string, SymbolReference['kind']>> = {
  superclass: 'extends',
  super_interfaces: 'implements',
  // An interface extending interfaces is an `extends` in Java's own words.
  extends_interfaces: 'extends',
};

/** `extends Base` / `implements A, B` → EXTENDS and IMPLEMENTS references. */
export const collectHeritage = (state: JavaParseState, declaration: Node, nodeId: string): void => {
  for (const child of namedChildrenOf(declaration)) {
    const kind = HERITAGE_CLAUSES[child.type];
    if (kind === undefined) {
      continue;
    }
    const types = child.type === 'superclass' ? namedChildrenOf(child) : interfaceTypes(child);
    for (const type of types) {
      addReference(state, kind, nodeId, type);
    }
  }
};

/**
 * Constructor parameter types are static dependencies → `injects` references, which assembly
 * turns into USES edges. Spring's constructor injection is one instance of that general fact,
 * so the edge is produced here with `static-analysis` provenance rather than invented a second
 * time by the Spring adapter (which would duplicate it under a framework label).
 */
export const collectConstructorInjections = (
  state: JavaParseState,
  constructor: Node,
  classNodeId: string,
): void => {
  const parameters = fieldNode(constructor, 'parameters');
  for (const parameter of parameters === undefined ? [] : namedChildrenOf(parameters)) {
    const type = fieldNode(parameter, 'type');
    if (type !== undefined) {
      addReference(state, 'injects', classNodeId, type);
    }
  }
};
