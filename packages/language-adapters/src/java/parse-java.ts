import { addFileFact } from '../file-node.js';
import { namedChildrenOf } from '../tree-sitter/syntax.js';

import { createJavaParseState } from './java-context.js';
import { addTypeDeclaration, isTypeDeclaration } from './java-declarations.js';
import { collectImport, readPackageDeclaration } from './java-imports.js';
import { collectServiceActivatorLinks } from './java-pubsub-channels.js';

import type { JavaParseState } from './java-context.js';
import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext, RepositoryFile } from '../types.js';
import type { Node } from 'web-tree-sitter';

// One compilation unit's worth of facts. Nothing here executes anything: tree-sitter reads text,
// and no annotation, string, or class name can change that (PRD §35, §42.5).
//
// The walk is deliberately two-pass. Java lets a file use a type from its own package with no
// import at all, so the declarations pass has to know the package name and the explicit imports
// before it can report what an unqualified type reference points at.

const readHeader = (state: JavaParseState, root: Node): void => {
  for (const statement of namedChildrenOf(root)) {
    if (statement.type === 'package_declaration') {
      readPackageDeclaration(state, statement);
    } else if (statement.type === 'import_declaration') {
      collectImport(state, statement);
    }
  }
};

const readDeclarations = (state: JavaParseState, root: Node): void => {
  for (const statement of namedChildrenOf(root)) {
    if (isTypeDeclaration(statement)) {
      addTypeDeclaration(state, statement);
    }
  }
};

/** Walk one parsed Java compilation unit, emitting its facts into the builder. */
export const parseJavaFile = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  context: IndexingContext,
  root: Node,
): void => {
  addFileFact(builder, file, context);
  const state = createJavaParseState(builder, context, file.relativePath);
  readHeader(state, root);
  readDeclarations(state, root);
  // A third pass, and it has to be third: a `@ServiceActivator` handler is routinely declared
  // above the `@Bean` that binds its channel to a subscription, and the edge it produces starts
  // at a method symbol node the declarations pass creates (Story 16.3).
  collectServiceActivatorLinks(state, root);
};
