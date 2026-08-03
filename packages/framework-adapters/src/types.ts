import type { GraphEdge, GraphNode } from '@impactgraph/domain';
import type {
  CallFact,
  DecoratorFact,
  GraphFragment,
  ImportReference,
  IndexingContext,
  SymbolReference,
} from '@impactgraph/language-adapters';

/**
 * The already-built code graph a framework adapter reads (PRD §31). Enrichment never
 * re-parses source files — decorators and symbols were extracted by the language adapters.
 */
export interface CodeGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly decorators: readonly DecoratorFact[];
  readonly callFacts: readonly CallFact[];
  /**
   * Raw symbol relationships (`extends`, `implements`, `calls`, `injects`) as the language
   * adapters reported them — including the ones assembly could not resolve into edges because
   * the target lives outside the repository (`class Deal(BaseModel)` → pydantic). Optional: an
   * assembler that does not carry them through leaves it undefined, and adapters that need it
   * must say so in a warning rather than silently emitting nothing (PRD §34).
   */
  readonly symbolReferences?: readonly SymbolReference[];
  /** Resolve a name used in a file to a node id (imports, barrels, aliases included). */
  readonly resolveSymbol: (filePath: string, name: string) => string | undefined;
  /** Import references of one file — module specifiers included (custom detection, §Z8). */
  readonly importsOf: (filePath: string) => readonly ImportReference[];
}

export interface FrameworkDetection {
  readonly detected: boolean;
  /** What triggered the detection — manifest, dependency, or decorator evidence ids. */
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export interface FrameworkContext {
  readonly indexing: IndexingContext;
  readonly detection: FrameworkDetection;
}

/** PRD §31 — implemented as written. Adapters only ADD fragments; never mutate facts. */
export interface FrameworkAdapter {
  readonly id: string;
  readonly languageIds: readonly string[];
  detect(graph: CodeGraph): Promise<FrameworkDetection>;
  enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment>;
}
