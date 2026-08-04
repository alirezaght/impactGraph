import { createEvidenceRecord, createGraphEdge, createGraphNode } from '@impactgraph/domain';

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
import type {
  CreateEvidenceRecordInput,
  CreateGraphEdgeInput,
  CreateGraphNodeInput,
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  KnowledgeEnvelopeInput,
} from '@impactgraph/domain';

/** Deterministic-fact envelope: confidence 1.0 backed by the direct-observation signal. */
export const deterministicEnvelope = (
  context: IndexingContext,
  evidenceIds: readonly string[],
  provenance: 'static-analysis' | 'configuration' | 'framework-convention' = 'static-analysis',
): KnowledgeEnvelopeInput => ({
  provenance,
  evidenceIds,
  confidence: { value: 1, signals: [{ type: 'direct-observation', contribution: 1 }] },
  createdAt: context.createdAt,
  repositorySnapshotId: context.repositorySnapshotId,
  analysisRunId: context.analysisRunId,
});

/**
 * Accumulates one fragment. Domain factory rejections become parser warnings — an invalid
 * record costs one fact, never the run (PRD §32, §34).
 */
export class FragmentBuilder {
  private readonly adapterId: string;
  private readonly nodes: GraphNode[] = [];
  private readonly edges: GraphEdge[] = [];
  private readonly evidence: EvidenceRecord[] = [];
  /** Same-id lookup so a conflicting re-add is caught here rather than silently downstream. */
  private readonly evidenceById = new Map<string, EvidenceRecord>();
  private readonly importRefs: ImportReference[] = [];
  private readonly symbolRefs: SymbolReference[] = [];
  private readonly decoratorFacts: DecoratorFact[] = [];
  private readonly moduleCalls: CallFact[] = [];
  private readonly exports: Record<string, ExportedSymbol[]> = {};
  private readonly warningList: ParseWarning[] = [];

  public constructor(adapterId: string) {
    this.adapterId = adapterId;
  }

  public addNode(input: CreateGraphNodeInput, filePath: string): GraphNode | undefined {
    const result = createGraphNode(input);
    if (!result.ok) {
      this.warn(filePath, `invalid node '${input.id}': ${result.error.issues[0]?.message ?? ''}`);
      return undefined;
    }
    this.nodes.push(result.value);
    return result.value;
  }

  public addEdge(input: CreateGraphEdgeInput, filePath: string): GraphEdge | undefined {
    const result = createGraphEdge(input);
    if (!result.ok) {
      this.warn(filePath, `invalid edge '${input.id}': ${result.error.issues[0]?.message ?? ''}`);
      return undefined;
    }
    this.edges.push(result.value);
    return this.edges[this.edges.length - 1];
  }

  /**
   * Edge ids added so far.
   *
   * Exposed for the one case that genuinely needs it: an adapter whose later pass can produce an edge
   * an earlier pass in the SAME run already emitted (cross-stack matches a path-relative URL and an
   * absolute one to the same route). Edge ids are unique per graph, so the duplicate has to be
   * detected before it reaches graph construction — and only the builder knows what it holds.
   */
  public addedEdgeIds(): ReadonlySet<string> {
    return new Set(this.edges.map((edge) => edge.id));
  }

  public addEvidence(input: CreateEvidenceRecordInput, filePath: string): string | undefined {
    const result = createEvidenceRecord(input);
    if (!result.ok) {
      this.warn(
        filePath,
        `invalid evidence '${input.id}': ${result.error.issues[0]?.message ?? ''}`,
      );
      return undefined;
    }
    // Two records under one id is a fragment stating one fact twice: assembly deduplicates by id,
    // so the loser vanishes silently and a fact may end up citing evidence that describes
    // something else. Re-adding an IDENTICAL record is fine (two detectors legitimately citing
    // the same thing) and is collapsed; a conflicting one keeps the first and warns.
    const existing = this.evidenceById.get(result.value.id);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(result.value)) {
        return existing.id; // two detectors citing the identical thing — collapse, lose nothing
      }
      // Conflicting content under one id. Keep BOTH (dropping one would lose a real fact) and
      // warn: the id scheme of whichever adapter produced them is not distinguishing them, and
      // downstream deduplication would otherwise silently pick one.
      this.warn(filePath, `conflicting evidence records share id '${result.value.id}'`);
    }
    this.evidenceById.set(result.value.id, result.value);
    this.evidence.push(result.value);
    return result.value.id;
  }

  public addImport(reference: ImportReference): void {
    this.importRefs.push(reference);
  }

  public addSymbolReference(reference: SymbolReference): void {
    this.symbolRefs.push(reference);
  }

  public addDecorator(fact: DecoratorFact): void {
    this.decoratorFacts.push(fact);
  }

  public addCallFact(fact: CallFact): void {
    this.moduleCalls.push(fact);
  }

  public addExport(filePath: string, exported: ExportedSymbol): void {
    (this.exports[filePath] ??= []).push(exported);
  }

  public warn(filePath: string, message: string): void {
    this.warningList.push({ filePath, adapterId: this.adapterId, message });
  }

  public build(): GraphFragment {
    return {
      nodes: this.nodes,
      edges: this.edges,
      evidence: this.evidence,
      imports: this.importRefs,
      symbolReferences: this.symbolRefs,
      decorators: this.decoratorFacts,
      callFacts: this.moduleCalls,
      exportsByFile: this.exports,
      warnings: this.warningList,
    };
  }
}

/** Merge fragments from several adapters into one (used by orchestration and analyzeDiff). */
export const mergeFragments = (fragments: readonly GraphFragment[]): GraphFragment => ({
  nodes: fragments.flatMap((f) => f.nodes),
  edges: fragments.flatMap((f) => f.edges),
  evidence: fragments.flatMap((f) => f.evidence),
  imports: fragments.flatMap((f) => f.imports),
  symbolReferences: fragments.flatMap((f) => f.symbolReferences),
  decorators: fragments.flatMap((f) => f.decorators),
  callFacts: fragments.flatMap((f) => f.callFacts),
  exportsByFile: Object.assign({}, ...fragments.map((f) => f.exportsByFile)) as Readonly<
    Record<string, readonly ExportedSymbol[]>
  >,
  warnings: fragments.flatMap((f) => f.warnings),
});
