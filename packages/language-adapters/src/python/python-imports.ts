import { fileNodeId } from '../file-node.js';
import {
  fieldNode,
  fieldNodes,
  firstNamedChildOfType,
  namedChildrenOf,
} from '../tree-sitter/syntax.js';

import { importEvidence } from './python-context.js';

import type { PythonParseState } from './python-context.js';
import type { ImportAlias } from '../types.js';
import type { Node } from 'web-tree-sitter';

// `import x` / `from pkg import a, b as c` → ImportReference (PRD §12.2 IMPORTS). Cross-file
// resolution happens at assembly time; the adapter only reports what the statement says.
//
// `importedNames` carries the LOCAL binding — the name other statements in this file actually
// use — which is the same convention the TypeScript adapter follows for `import { a as b }`.

/** `router as deals_router` → 'deals_router'; `os.path as osp` → 'osp'. */
const aliasBinding = (nameNode: Node): string | undefined => {
  const children = namedChildrenOf(nameNode);
  return children[children.length - 1]?.text;
};

/** `router as deals_router` → 'router', the name the target module actually defines. */
const aliasOriginal = (nameNode: Node): string | undefined => namedChildrenOf(nameNode)[0]?.text;

/**
 * The renamed bindings of one `from m import a as b, c` statement (epic-16 line 140). Only
 * `import_from_statement` produces these: `import os.path as osp` renames a MODULE, and `os.path`
 * is not a symbol any export table holds, so calling it an alias would send assembly looking for
 * a name that cannot exist.
 */
const aliasesOf = (statement: Node): readonly ImportAlias[] => {
  const aliases: ImportAlias[] = [];
  for (const nameNode of fieldNodes(statement, 'name')) {
    if (nameNode.type !== 'aliased_import') {
      continue;
    }
    const local = aliasBinding(nameNode);
    const exported = aliasOriginal(nameNode);
    if (local !== undefined && exported !== undefined && local !== exported) {
      aliases.push({ local, exported });
    }
  }
  return aliases;
};

/** `import os.path` binds the top-level package name; `from m import a` binds 'a'. */
const plainBinding = (nameNode: Node): string | undefined => nameNode.text.split('.')[0];

const bindingOf = (nameNode: Node): string | undefined =>
  nameNode.type === 'aliased_import' ? aliasBinding(nameNode) : plainBinding(nameNode);

interface ImportEntry {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly aliases?: readonly ImportAlias[];
}

const record = (state: PythonParseState, statement: Node, entry: ImportEntry): void => {
  const evidenceId = importEvidence(state, statement);
  if (evidenceId === undefined) {
    return;
  }
  const aliases = entry.aliases ?? [];
  state.builder.addImport({
    fromFilePath: state.filePath,
    fromFileNodeId: fileNodeId(state.filePath),
    specifier: entry.specifier,
    importedNames: entry.names,
    // Python has no re-export statement; `__init__.py` re-exports are plain imports.
    isReExport: false,
    ...(aliases.length === 0 ? {} : { aliases }),
    evidenceId,
  });
};

const collectPlainImport = (state: PythonParseState, statement: Node): void => {
  for (const nameNode of fieldNodes(statement, 'name')) {
    const specifier =
      nameNode.type === 'aliased_import'
        ? (firstNamedChildOfType(nameNode, 'dotted_name')?.text ?? nameNode.text)
        : nameNode.text;
    const binding = bindingOf(nameNode);
    record(state, statement, { specifier, names: binding === undefined ? [] : [binding] });
  }
};

/**
 * Record one import statement. A wildcard import (`from m import *`) legitimately carries no
 * names — that is a fact about the source, not a parse failure.
 */
export const collectImport = (state: PythonParseState, statement: Node): void => {
  if (statement.type === 'import_statement') {
    collectPlainImport(state, statement);
    return;
  }
  const specifier = fieldNode(statement, 'module_name')?.text;
  if (specifier === undefined) {
    state.builder.warn(state.filePath, 'import statement without a module name — skipped');
    return;
  }
  const names = fieldNodes(statement, 'name')
    .map(bindingOf)
    .filter((name): name is string => name !== undefined);
  record(state, statement, { specifier, names, aliases: aliasesOf(statement) });
};
