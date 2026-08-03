import {
  parseEvidenceRecord,
  parseGraphEdge,
  parseGraphNode,
  serializeEvidenceRecord,
  serializeGraphEdge,
  serializeGraphNode,
} from '@impactgraph/domain';

import type {
  CallFact,
  DecoratorFact,
  ExportedSymbol,
  GraphFragment,
  ImportReference,
  IndexingContext,
  ParseWarning,
  SymbolReference,
} from './types.js';
import type { EvidenceRecord, GraphEdge, GraphNode } from '@impactgraph/domain';

// Fragment cache serialization (PRD §32). Cached fragments are keyed by content hash, so on a
// hit the facts are re-derived from IDENTICAL content — rebinding them to the new snapshot/run
// is exactly what re-parsing would produce (deterministic IDs, deterministic facts), minus the
// parse cost. Every record still goes back through the domain factories on load.

const FRAGMENT_PAYLOAD_VERSION = 3; // v3: + callFacts channel

interface FragmentPayload {
  readonly schemaVersion: number;
  readonly nodes: unknown[];
  readonly edges: unknown[];
  readonly evidence: unknown[];
  readonly imports: ImportReference[];
  readonly symbolReferences: SymbolReference[];
  readonly decorators: DecoratorFact[];
  readonly callFacts: CallFact[];
  readonly exportsByFile: Record<string, ExportedSymbol[]>;
  readonly warnings: ParseWarning[];
}

export const serializeFragment = (fragment: GraphFragment): string =>
  JSON.stringify({
    schemaVersion: FRAGMENT_PAYLOAD_VERSION,
    nodes: fragment.nodes.map(serializeGraphNode),
    edges: fragment.edges.map(serializeGraphEdge),
    evidence: fragment.evidence.map(serializeEvidenceRecord),
    imports: fragment.imports,
    symbolReferences: fragment.symbolReferences,
    decorators: fragment.decorators,
    callFacts: fragment.callFacts,
    exportsByFile: fragment.exportsByFile,
    warnings: fragment.warnings,
  });

type Rebinder<T> = (raw: unknown, context: IndexingContext) => T | undefined;

const rebindKnowledgeRecord =
  <T>(parse: (value: unknown) => { ok: boolean; value?: T }): Rebinder<T> =>
  (raw, context) => {
    if (typeof raw !== 'object' || raw === null) {
      return undefined;
    }
    const record = raw as { knowledge?: Record<string, unknown> };
    const rebound = {
      ...record,
      knowledge: {
        ...record.knowledge,
        repositorySnapshotId: context.repositorySnapshotId,
        analysisRunId: context.analysisRunId,
        createdAt: context.createdAt,
      },
    };
    const parsed = parse(rebound);
    return parsed.ok ? parsed.value : undefined;
  };

const rebindEvidence: Rebinder<EvidenceRecord> = (raw, context) => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const parsed = parseEvidenceRecord({
    ...raw,
    repositorySnapshotId: context.repositorySnapshotId,
    createdAt: context.createdAt,
  });
  return parsed.ok ? parsed.value : undefined;
};

const rebindNode = rebindKnowledgeRecord<GraphNode>(parseGraphNode);
const rebindEdge = rebindKnowledgeRecord<GraphEdge>(parseGraphEdge);

const rebindAll = <T>(
  raws: readonly unknown[],
  rebind: Rebinder<T>,
  context: IndexingContext,
): T[] | undefined => {
  const records: T[] = [];
  for (const raw of raws) {
    const record = rebind(raw, context);
    if (record === undefined) {
      return undefined; // any invalid record invalidates the whole cache entry → reparse
    }
    records.push(record);
  }
  return records;
};

/**
 * Load a cached fragment, rebinding every fact to the current snapshot/run. Returns undefined
 * on any validation failure — the caller treats that as a cache miss and re-parses.
 */
export const deserializeFragment = (
  payload: string,
  context: IndexingContext,
): GraphFragment | undefined => {
  let parsed: FragmentPayload;
  try {
    parsed = JSON.parse(payload) as FragmentPayload;
  } catch {
    return undefined;
  }
  if (parsed.schemaVersion !== FRAGMENT_PAYLOAD_VERSION) {
    return undefined;
  }
  const nodes = rebindAll(parsed.nodes, rebindNode, context);
  const edges = rebindAll(parsed.edges, rebindEdge, context);
  const evidence = rebindAll(parsed.evidence, rebindEvidence, context);
  if (nodes === undefined || edges === undefined || evidence === undefined) {
    return undefined;
  }
  return {
    nodes,
    edges,
    evidence,
    imports: parsed.imports,
    symbolReferences: parsed.symbolReferences,
    decorators: parsed.decorators,
    callFacts: parsed.callFacts,
    exportsByFile: parsed.exportsByFile,
    warnings: parsed.warnings,
  };
};
