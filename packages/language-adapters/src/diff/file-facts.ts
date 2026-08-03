import { fileNodeId } from '../file-node.js';

import type { GraphFragment, ImportReference } from '../types.js';
import type { EvidenceRecord, GraphNode, SourceRange } from '@impactgraph/domain';

// Symbol-level diffing needs a stable per-symbol fingerprint. We take it from the declaration
// text the parser already pointed at (the symbol-declaration evidence range) — no second
// parser, no execution (PRD §35).

/** FNV-1a, 32-bit. Dependency-free and byte-stable across runs and platforms. */
const hashText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/** Extract the 1-based, inclusive-start/exclusive-end text a `SourceRange` points at. */
export const sliceRange = (content: string, range: SourceRange): string => {
  const lines = content.split('\n').slice(range.startLine - 1, range.endLine);
  const lastIndex = lines.length - 1;
  const last = lines[lastIndex];
  if (last === undefined) {
    return '';
  }
  lines[lastIndex] = last.slice(0, range.endColumn - 1);
  const first = lines[0];
  if (first !== undefined) {
    lines[0] = first.slice(range.startColumn - 1);
  }
  return lines.join('\n');
};

const rangeOfNode = (
  node: GraphNode,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
): SourceRange | undefined => {
  for (const evidenceId of node.knowledge.evidenceIds) {
    const record = evidenceById.get(evidenceId);
    if (record?.source.kind === 'file' && record.source.range !== undefined) {
      return record.source.range;
    }
  }
  return undefined;
};

export interface FileSymbol {
  readonly nodeId: string;
  readonly name: string;
  readonly type: string;
  /** Fingerprint of the declaration text: equal fingerprints ⇒ the symbol did not change. */
  readonly signature: string;
}

/** Everything one file contributed to the graph, keyed for baseline-vs-current comparison. */
export interface FileFacts {
  readonly filePath: string;
  readonly symbols: readonly FileSymbol[];
  readonly imports: readonly ImportReference[];
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export const EMPTY_FILE_FACTS = (filePath: string): FileFacts => ({
  filePath,
  symbols: [],
  imports: [],
  nodeIds: [],
  edgeIds: [],
});

/**
 * Reduce a single-file fragment to comparable facts. The File node itself is excluded: a file
 * is not a symbol, and its identity is already tracked by path.
 */
export const collectFileFacts = (
  filePath: string,
  fragment: GraphFragment,
  content: string,
): FileFacts => {
  const evidenceById = new Map(fragment.evidence.map((record) => [record.id, record]));
  const symbols = fragment.nodes
    .filter((node) => node.id !== fileNodeId(filePath))
    .map((node) => {
      const range = rangeOfNode(node, evidenceById);
      const declaration =
        range === undefined ? `${node.type}:${node.name}` : sliceRange(content, range);
      return {
        nodeId: node.id,
        name: node.name,
        type: node.type,
        signature: hashText(declaration),
      };
    });
  return {
    filePath,
    symbols,
    imports: fragment.imports,
    nodeIds: fragment.nodes.map((node) => node.id),
    edgeIds: fragment.edges.map((edge) => edge.id),
  };
};
