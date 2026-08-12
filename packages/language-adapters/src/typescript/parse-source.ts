import ts from 'typescript';

import { addFileFact, fileNodeId } from '../fallback/fallback-adapter.js';

import { collectModuleCallFacts } from './parse-call-facts.js';
import { evidenceIdFor, rangeOf } from './parse-context.js';
import {
  handleClass,
  handleFunction,
  handleInterface,
  handleVariables,
} from './parse-declarations.js';
import { collectEnvReferences } from './parse-env.js';
import { collectSymbolMembers } from './parse-members.js';
import { emitFieldFlows } from './parse-field-flow.js';
import { collectHttpCallFacts } from './parse-http-calls.js';
import { collectPubSubFacts } from './parse-pubsub.js';

import type { ParseState } from './parse-context.js';
import type { FieldFlowState } from './parse-symbols.js';
import type { FragmentBuilder } from '../fragment-builder.js';
import type { ImportAlias, IndexingContext, RepositoryFile } from '../types.js';

const handleImportLike = (
  state: ParseState,
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): void => {
  const specifierNode = statement.moduleSpecifier;
  if (specifierNode === undefined || !ts.isStringLiteral(specifierNode)) {
    return;
  }
  const range = rangeOf(state.source, statement);
  const evidenceId = state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'import-statement', range),
      kind: 'import-statement',
      source: { kind: 'file', filePath: state.filePath, range },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
  if (evidenceId === undefined) {
    return;
  }
  const aliases = aliasesOf(statement);
  state.builder.addImport({
    fromFilePath: state.filePath,
    fromFileNodeId: fileNodeId(state.filePath),
    specifier: specifierNode.text,
    importedNames: importedNamesOf(statement),
    isReExport: ts.isExportDeclaration(statement),
    ...(aliases.length === 0 ? {} : { aliases }),
    evidenceId,
  });
};

/** The named-binding list of an import or a re-export, or undefined for the other shapes. */
const namedElements = (
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] | undefined => {
  if (ts.isImportDeclaration(statement)) {
    const bindings = statement.importClause?.namedBindings;
    return bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : undefined;
  }
  const clause = statement.exportClause;
  return clause !== undefined && ts.isNamedExports(clause) ? clause.elements : undefined;
};

const importedNamesOf = (
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): readonly string[] => {
  const elements = namedElements(statement) ?? [];
  if (!ts.isImportDeclaration(statement)) {
    return elements.map((element) => element.name.text); // `export * from` → no elements
  }
  const clause = statement.importClause;
  const names: string[] = clause?.name === undefined ? [] : [clause.name.text];
  names.push(...elements.map((element) => element.name.text));
  return names;
};

/**
 * `import { DealRepository as Repo }` and `export { inner as outer } from './m'` both state the
 * exported name in `propertyName`. Without it assembly looks `Repo` up in the target's export
 * table and finds nothing, so the EXTENDS/CALLS edge is silently lost (epic-16 line 140).
 *
 * A DEFAULT import (`import Foo from './m'`) is deliberately not treated as an alias of
 * `default`: the exports table records default exports under their declared name, so rewriting
 * `Foo` to `default` would break resolution that works today.
 */
const aliasesOf = (
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): readonly ImportAlias[] => {
  const aliases: ImportAlias[] = [];
  for (const element of namedElements(statement) ?? []) {
    const exported = element.propertyName?.text;
    if (exported !== undefined && exported !== element.name.text) {
      aliases.push({ local: element.name.text, exported });
    }
  }
  return aliases;
};

const visitStatement = (state: ParseState, statement: ts.Statement, flow: FieldFlowState): void => {
  collectModuleCallFacts(state, statement);
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
    handleImportLike(state, statement);
  } else if (ts.isClassDeclaration(statement)) {
    handleClass(state, statement);
  } else if (ts.isInterfaceDeclaration(statement)) {
    handleInterface(state, statement, flow);
  } else if (ts.isFunctionDeclaration(statement)) {
    handleFunction(state, statement, flow);
  } else if (ts.isVariableStatement(statement)) {
    handleVariables(state, statement, flow);
  }
};

export interface TypeScriptParseOptions {
  /**
   * The text actually handed to the TypeScript parser, when it is not the whole file. The Astro
   * adapter passes the frontmatter padded with leading newlines so every reported line and column
   * still points at the real position in the `.astro` file (ADR-0014).
   */
  readonly source?: string;
  /** Marks the evidence this parse produces, e.g. `'astro-frontmatter:'`. */
  readonly evidenceScope?: string;
  /** Set false when the caller already emitted the File node for this path. */
  readonly emitFileFact?: boolean;
}

/** TypeScript needs a TS/JS file name to choose its parse mode; `.astro` is not one. */
const parserFileName = (relativePath: string): string =>
  /\.[cm]?[jt]sx?$/.test(relativePath) ? relativePath : `${relativePath}.ts`;

/** Static, syntactic parse of one TS/JS file — no type checker, no execution (PRD §35). */
export const parseTypeScriptFile = (
  builder: FragmentBuilder,
  file: RepositoryFile,
  context: IndexingContext,
  options: TypeScriptParseOptions = {},
): void => {
  if (options.emitFileFact ?? true) {
    addFileFact(builder, file, context);
  }
  const source = ts.createSourceFile(
    parserFileName(file.relativePath),
    options.source ?? file.content,
    ts.ScriptTarget.Latest,
    true,
  );
  const state: ParseState = {
    builder,
    context,
    source,
    filePath: file.relativePath,
    ...(options.evidenceScope === undefined ? {} : { evidenceScope: options.evidenceScope }),
  };
  const flow: FieldFlowState = { declaredFields: new Map(), assignments: [] };
  for (const statement of source.statements) {
    visitStatement(state, statement, flow);
  }
  collectEnvReferences(state);
  collectSymbolMembers(state);
  collectPubSubFacts(state);
  collectHttpCallFacts(state);
  // Item 7: field flow is resolved LAST, once every shape declared in this file is known — an object
  // literal routinely appears above the interface it builds.
  const resolved = emitFieldFlows(state, flow.assignments, flow.declaredFields);
  if (resolved.unresolved > 0) {
    builder.warn(
      file.relativePath,
      `unsupported syntax: ${String(resolved.unresolved)} field assignment(s) reference a shape declared in another file — cross-file field flow needs type resolution and is not emitted`,
    );
  }
};
