import ts from 'typescript';

import { addFileFact, fileNodeId } from '../fallback/fallback-adapter.js';
import { deterministicEnvelope } from '../fragment-builder.js';

import { collectModuleCallFacts } from './parse-call-facts.js';
import { declarationEvidence, evidenceIdFor, rangeOf } from './parse-context.js';
import { collectDecorators, collectInjections } from './parse-decorators.js';
import { collectEnvReferences } from './parse-env.js';
import { collectHttpCallFacts } from './parse-http-calls.js';
import { collectPubSubFacts } from './parse-pubsub.js';

import type { ParseState } from './parse-context.js';
import type { FragmentBuilder } from '../fragment-builder.js';
import type { ImportAlias, IndexingContext, RepositoryFile } from '../types.js';

const isExported = (node: ts.HasModifiers): boolean =>
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const addSymbolNode = (
  state: ParseState,
  options: {
    nodeId: string;
    category: string;
    type: string;
    name: string;
    evidenceId: string;
    containerId: string;
    exported: boolean;
    provenance?: 'static-analysis' | 'framework-convention';
  },
): void => {
  const { builder, context, filePath } = state;
  const provenance = options.provenance ?? 'static-analysis';
  const node = builder.addNode(
    {
      id: options.nodeId,
      category: options.category,
      type: options.type,
      name: options.name,
      path: filePath,
      knowledge: deterministicEnvelope(context, [options.evidenceId], provenance),
    },
    filePath,
  );
  if (node === undefined) {
    return;
  }
  builder.addEdge(
    {
      id: `contains:${options.nodeId}`,
      type: 'CONTAINS',
      sourceId: options.containerId,
      targetId: options.nodeId,
      knowledge: deterministicEnvelope(context, [options.evidenceId], provenance),
    },
    filePath,
  );
  if (options.exported) {
    builder.addExport(filePath, { name: options.name, nodeId: options.nodeId });
  }
};

/**
 * Best-effort static call extraction (Story 2.5): bare identifier calls `foo()` / `new Foo()`
 * only. Property-access calls need type resolution and are skipped, never guessed.
 */
const collectCalls = (state: ParseState, body: ts.Node, fromSymbolNodeId: string): void => {
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    const isCallLike = ts.isCallExpression(node) || ts.isNewExpression(node);
    if (isCallLike && ts.isIdentifier(node.expression) && !seen.has(node.expression.text)) {
      seen.add(node.expression.text);
      const evidenceId = callEvidence(state, node, node.expression.text);
      if (evidenceId !== undefined) {
        state.builder.addSymbolReference({
          kind: 'calls',
          fromSymbolNodeId,
          filePath: state.filePath,
          targetName: node.expression.text,
          evidenceId,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
};

const callEvidence = (state: ParseState, node: ts.Node, callee: string): string | undefined => {
  const range = rangeOf(state.source, node);
  return state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'call-site', range),
      kind: 'call-site',
      source: { kind: 'file', filePath: state.filePath, range, symbolName: callee },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};

/** Generic route heuristic (Story 2.5): exported handlers under api/ or routes/ directories. */
const ROUTE_FILE_PATTERN = /(^|\/)(api|routes)\//;

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

const handleHeritage = (
  state: ParseState,
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
  fromSymbolNodeId: string,
): void => {
  for (const clause of declaration.heritageClauses ?? []) {
    const kind = clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
    for (const type of clause.types) {
      if (!ts.isIdentifier(type.expression)) {
        state.builder.warn(
          state.filePath,
          `unresolvable heritage expression on ${fromSymbolNodeId}`,
        );
        continue;
      }
      const evidenceId = declarationEvidence(state, clause, type.expression.text);
      if (evidenceId !== undefined) {
        state.builder.addSymbolReference({
          kind,
          fromSymbolNodeId,
          filePath: state.filePath,
          targetName: type.expression.text,
          evidenceId,
        });
      }
    }
  }
};

const handleClass = (state: ParseState, declaration: ts.ClassDeclaration): void => {
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

const handleInterface = (state: ParseState, declaration: ts.InterfaceDeclaration): void => {
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
};

const handleFunction = (state: ParseState, declaration: ts.FunctionDeclaration): void => {
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
  }
};

const handleVariables = (state: ParseState, statement: ts.VariableStatement): void => {
  if (!isExported(statement)) {
    return;
  }
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) {
      continue;
    }
    const name = declaration.name.text;
    const evidenceId = declarationEvidence(state, declaration, name);
    if (evidenceId !== undefined) {
      addSymbolNode(state, {
        nodeId: `symbol:${state.filePath}#${name}`,
        category: 'repository',
        type: 'symbol',
        name,
        evidenceId,
        containerId: fileNodeId(state.filePath),
        exported: true,
      });
    }
  }
};

const visitStatement = (state: ParseState, statement: ts.Statement): void => {
  collectModuleCallFacts(state, statement);
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
    handleImportLike(state, statement);
  } else if (ts.isClassDeclaration(statement)) {
    handleClass(state, statement);
  } else if (ts.isInterfaceDeclaration(statement)) {
    handleInterface(state, statement);
  } else if (ts.isFunctionDeclaration(statement)) {
    handleFunction(state, statement);
  } else if (ts.isVariableStatement(statement)) {
    handleVariables(state, statement);
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
  for (const statement of source.statements) {
    visitStatement(state, statement);
  }
  collectEnvReferences(state);
  collectPubSubFacts(state);
  collectHttpCallFacts(state);
};
