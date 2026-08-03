import { addFileFact } from '../file-node.js';
import { fieldNode, namedChildrenOf } from '../tree-sitter/syntax.js';

import { recordCallFact } from './python-calls.js';
import { addClass, addFunction, addModuleBinding, decoratorsOf } from './python-declarations.js';
import { collectHttpCallFacts } from './python-http.js';
import { collectImport } from './python-imports.js';
import { collectPubSubFacts } from './python-pubsub.js';

import type { PythonParseState } from './python-context.js';
import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext, RepositoryFile } from '../types.js';
import type { Node } from 'web-tree-sitter';

// One module's worth of facts. Only module-level statements are walked (plus class bodies and
// function bodies for calls) — deeply nested definitions are out of scope and are never guessed
// at. Nothing here executes anything: tree-sitter reads text (PRD §35).

const handleAssignment = (state: PythonParseState, assignment: Node): void => {
  const target = fieldNode(assignment, 'left');
  const value = fieldNode(assignment, 'right');
  if (target?.type !== 'identifier') {
    return;
  }
  addModuleBinding(state, target, assignment);
  if (value?.type === 'call') {
    recordCallFact(state, value, { assignedTo: target.text });
  }
};

const handleExpressionStatement = (state: PythonParseState, statement: Node): void => {
  for (const expression of namedChildrenOf(statement)) {
    if (expression.type === 'assignment') {
      handleAssignment(state, expression);
    } else if (expression.type === 'call') {
      recordCallFact(state, expression, {});
    }
  }
};

const handleDefinition = (
  state: PythonParseState,
  definition: Node,
  decorators: readonly Node[],
): void => {
  if (definition.type === 'function_definition') {
    addFunction(state, definition, decorators);
  } else if (definition.type === 'class_definition') {
    addClass(state, definition, decorators);
  }
};

const visitStatement = (state: PythonParseState, statement: Node): void => {
  if (statement.type === 'import_statement' || statement.type === 'import_from_statement') {
    collectImport(state, statement);
    return;
  }
  if (statement.type === 'expression_statement') {
    handleExpressionStatement(state, statement);
    return;
  }
  if (statement.type === 'decorated_definition') {
    const definition = fieldNode(statement, 'definition');
    if (definition !== undefined) {
      handleDefinition(state, definition, decoratorsOf(statement));
    }
    return;
  }
  handleDefinition(state, statement, []);
};

/** Walk one parsed Python module, emitting its facts into the builder. */
export const parsePythonModule = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  context: IndexingContext,
  root: Node,
): void => {
  addFileFact(builder, file, context);
  const state: PythonParseState = { builder, context, filePath: file.relativePath };
  for (const statement of namedChildrenOf(root)) {
    visitStatement(state, statement);
  }
  collectPubSubFacts(state, root);
  collectHttpCallFacts(state, root);
};
