import ts from 'typescript';

import { deterministicEnvelope } from '../fragment-builder.js';

import { collectBodyCallFacts } from './parse-body-calls.js';
import { declarationEvidence, evidenceIdFor, rangeOf } from './parse-context.js';

import type { ParseState } from './parse-context.js';
import type { FieldAssignment } from './parse-field-flow.js';

// Shared symbol-level helpers: emitting a symbol node, walking a body for calls and field
// assignments, and resolving extends/implements heritage. Used by both the file-level walk
// (parse-source.ts) and the per-declaration handlers (parse-declarations.ts).

/** One file's field-flow accumulators: declared shapes, and the assignments awaiting resolution. */
export interface FieldFlowState {
  readonly declaredFields: Map<string, string[]>;
  readonly assignments: FieldAssignment[];
}

export const isExported = (node: ts.HasModifiers): boolean =>
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

export const addSymbolNode = (
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
export const collectCalls = (
  state: ParseState,
  body: ts.Node | undefined,
  fromSymbolNodeId: string,
): void => {
  if (body === undefined) {
    return;
  }
  // Body-level call FACTS (string-literal arguments only) alongside the symbol references. The
  // outbox and locale correspondences join on those literals, and every one of them lives in a body.
  collectBodyCallFacts(state, body, fromSymbolNodeId);
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
export const ROUTE_FILE_PATTERN = /(^|\/)(api|routes)\//;

export const handleHeritage = (
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
