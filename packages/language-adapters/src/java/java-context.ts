import { rangeOfNode } from '../tree-sitter/syntax.js';

import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext } from '../types.js';
import type { Node } from 'web-tree-sitter';

/**
 * Everything one Java file's parse needs.
 *
 * `packageName` and `explicitImports` are collected in a first pass over the compilation unit,
 * because Java's name resolution needs both: a type used without an import is resolved against
 * the file's own package, and only the declarations pass can tell which types are used.
 */
export interface JavaParseState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePath: string;
  /** `package com.example.deals;` → 'com.example.deals'; absent in the default package. */
  packageName: string | undefined;
  /** Simple type names bound by an explicit `import` in this file. */
  readonly explicitImports: Set<string>;
  /**
   * Simple type name → the fully-qualified name it was imported as. Java has no import renaming,
   * so this is a plain record of what each `import` line said. It is what lets a detector insist
   * that `PubSubTemplate` is `com.google.cloud.spring.pubsub.core.PubSubTemplate` and not a class
   * of the same name declared next door (Story 16.3).
   */
  readonly importedTypes: Map<string, string>;
  /** Same-package types already reported once — Java needs no import to use them. */
  readonly impliedImports: Set<string>;
  /**
   * Ids of the integration nodes (`topic:<name>`) and usage edges already emitted for this file,
   * so two publish calls to one topic in one method produce one node and one edge. Assembly
   * deduplicates by id as well, but a fragment that states a fact twice is a fact stated twice.
   * The node ids are shared across languages by design (§C13).
   */
  readonly emittedIntegrationFacts: Set<string>;
}

export const createJavaParseState = (
  builder: FragmentBuilder,
  context: IndexingContext,
  filePath: string,
): JavaParseState => ({
  builder,
  context,
  filePath,
  packageName: undefined,
  explicitImports: new Set<string>(),
  importedTypes: new Map<string, string>(),
  impliedImports: new Set<string>(),
  emittedIntegrationFacts: new Set<string>(),
});

const evidenceAt = (
  state: JavaParseState,
  node: Node,
  kind: 'symbol-declaration' | 'call-site' | 'import-statement' | 'decorator',
  symbolName?: string,
): string | undefined => {
  const range = rangeOfNode(node);
  const position = `${String(range.startLine)}:${String(range.startColumn)}`;
  return state.builder.addEvidence(
    {
      id: `ev:${kind}:${state.filePath}:${position}`,
      kind,
      source: {
        kind: 'file',
        filePath: state.filePath,
        range,
        ...(symbolName === undefined ? {} : { symbolName }),
      },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

export const declarationEvidence = (
  state: JavaParseState,
  node: Node,
  symbolName: string,
): string | undefined => evidenceAt(state, node, 'symbol-declaration', symbolName);

export const callSiteEvidence = (
  state: JavaParseState,
  node: Node,
  calleeName: string,
): string | undefined => evidenceAt(state, node, 'call-site', calleeName);

export const importEvidence = (state: JavaParseState, node: Node): string | undefined =>
  evidenceAt(state, node, 'import-statement');

export const annotationEvidence = (
  state: JavaParseState,
  node: Node,
  annotationName: string,
): string | undefined => evidenceAt(state, node, 'decorator', annotationName);
