import { rangeOfNode } from '../tree-sitter/syntax.js';

import type { FragmentBuilder } from '../fragment-builder.js';
import type { IndexingContext } from '../types.js';
import type { Node } from 'web-tree-sitter';

/** Everything one Python file's parse needs. Immutable — the builder accumulates the facts. */
export interface PythonParseState {
  readonly builder: FragmentBuilder;
  readonly context: IndexingContext;
  readonly filePath: string;
}

const evidenceAt = (
  state: PythonParseState,
  node: Node,
  kind: 'symbol-declaration' | 'call-site' | 'import-statement' | 'decorator',
  symbolName?: string,
): string | undefined => {
  const range = rangeOfNode(node);
  const position = `${String(range.startLine)}:${String(range.startColumn)}`;
  // The symbol is part of the identity: two detectors can cite the SAME call expression for
  // different symbols (the generic call pass and the Pub/Sub pass both look at
  // `client.publish(...)`). Without it both records land under one id, and the one that survives
  // deduplication may describe the other's symbol.
  const symbolSuffix = symbolName === undefined ? '' : `:${symbolName}`;
  return state.builder.addEvidence(
    {
      id: `ev:${kind}:${state.filePath}:${position}${symbolSuffix}`,
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
  state: PythonParseState,
  node: Node,
  symbolName: string,
): string | undefined => evidenceAt(state, node, 'symbol-declaration', symbolName);

export const callSiteEvidence = (
  state: PythonParseState,
  node: Node,
  calleeName: string,
): string | undefined => evidenceAt(state, node, 'call-site', calleeName);

export const importEvidence = (state: PythonParseState, node: Node): string | undefined =>
  evidenceAt(state, node, 'import-statement');

export const decoratorEvidence = (
  state: PythonParseState,
  node: Node,
  decoratorName: string,
): string | undefined => evidenceAt(state, node, 'decorator', decoratorName);
