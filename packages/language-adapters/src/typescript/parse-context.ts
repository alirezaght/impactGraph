import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext } from '../types.js';
import type { SourceRange } from '@impactgraph/domain';
import type ts from 'typescript';

export interface ParseState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly source: ts.SourceFile;
  readonly filePath: string;
  /**
   * Marks which half of a composite file produced a fact, e.g. `'astro-frontmatter:'` for the
   * TypeScript half of an `.astro` file (ADR-0014). Undefined for a plain `.ts`/`.js` file, so
   * ordinary evidence ids are unchanged.
   */
  readonly evidenceScope?: string;
}

export const rangeOf = (source: ts.SourceFile, node: ts.Node): SourceRange => {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
};

/** The one place an evidence id is shaped, so the scope marker can never be forgotten. */
export const evidenceIdFor = (state: ParseState, kind: string, range: SourceRange): string => {
  const position = `${String(range.startLine)}:${String(range.startColumn)}`;
  return `ev:${kind}:${state.evidenceScope ?? ''}${state.filePath}:${position}`;
};

export const declarationEvidence = (
  state: ParseState,
  node: ts.Node,
  symbolName: string,
): string | undefined => {
  const range = rangeOf(state.source, node);
  return state.builder.addEvidence(
    {
      id: evidenceIdFor(state, 'symbol-declaration', range),
      kind: 'symbol-declaration',
      source: { kind: 'file', filePath: state.filePath, range, symbolName },
      repositorySnapshotId: state.context.repositorySnapshotId,
      createdAt: state.context.createdAt,
    },
    state.filePath,
  );
};
