import type { EvidenceRecord, GraphEdge, GraphNode } from '@impactgraph/domain';

/** A file handed to an adapter: repository-relative path + content. Content is untrusted. */
export interface RepositoryFile {
  readonly relativePath: string;
  readonly content: string;
}

/** Snapshot/run binding every emitted fact must carry (provenance-model.md). */
export interface IndexingContext {
  readonly repositorySnapshotId: string;
  readonly analysisRunId: string;
  /** ISO timestamp from the clock port — adapters never read the clock themselves. */
  readonly createdAt: string;
}

/** A recoverable per-file problem: recorded, never thrown up the pipeline (PRD §32, §34). */
export interface ParseWarning {
  readonly filePath: string;
  readonly adapterId: string;
  readonly message: string;
}

/**
 * A renamed binding: the name this file uses, and the name the target module actually exports.
 *
 * `import { DealRepository as Repo }` / `from app.models import Deal as DealModel` state BOTH
 * names, and assembly needs both — `importedNames` carries the local one (that is what the rest
 * of the file says), while the export table of the target module is keyed by the exported one.
 * Recorded as a list rather than a `Record` on purpose: every key here comes from untrusted
 * repository text, and a lookup on an object literal answers `constructor` from its prototype
 * (PRD §42.5).
 */
export interface ImportAlias {
  /** The name bound in the importing file. */
  readonly local: string;
  /** The name the target module exports under. */
  readonly exported: string;
}

/** An import/re-export dependency awaiting cross-file resolution at assembly time. */
export interface ImportReference {
  readonly fromFilePath: string;
  readonly fromFileNodeId: string;
  readonly specifier: string;
  readonly importedNames: readonly string[];
  readonly isReExport: boolean;
  /**
   * Renamed bindings only. A name absent from this list is its own exported name, which is the
   * overwhelming majority — and languages without import renaming (Java) never populate it.
   */
  readonly aliases?: readonly ImportAlias[];
  readonly evidenceId: string;
}

/**
 * A decorator observed on a class or method — the raw material for framework enrichment
 * (PRD §31). Extracted once by the language adapter; framework adapters never re-parse.
 */
export interface DecoratorFact {
  readonly targetNodeId: string;
  readonly decoratorName: string;
  /** String-literal arguments, e.g. `@Controller('deals')` → ['deals']. */
  readonly stringArguments: readonly string[];
  /** Identifier arrays from an object-literal argument, e.g. `@Module({providers:[A]})`. */
  readonly identifierLists: Readonly<Record<string, readonly string[]>>;
  readonly filePath: string;
  readonly evidenceId: string;
}

/**
 * A module-level call observed by the language adapter — raw material for call-convention
 * frameworks like Express (`const app = express()`, `app.get('/x', handler)`).
 */
export interface CallFact {
  readonly filePath: string;
  /** Variable name when the result was assigned: `const app = express()` → 'app'. */
  readonly assignedTo?: string;
  /** Receiver identifier for member calls: `app.get(...)` → 'app'; absent for bare calls. */
  readonly receiverName?: string;
  /** Called name: 'express' for `express()`, 'Router' for `express.Router()`, 'get' for `app.get`. */
  readonly calleeName: string;
  readonly stringArguments: readonly string[];
  readonly identifierArguments: readonly string[];
  /**
   * String-valued keyword arguments, for languages that have them:
   * `include_router(r, prefix="/deals")` → `{ prefix: '/deals' }`. Absent where the language has
   * no keyword arguments (TypeScript/JavaScript).
   */
  readonly keywordStringArguments?: Readonly<Record<string, string>>;
  /**
   * The symbol whose body contains this call, when the adapter records calls below module level
   * (e.g. `background_tasks.add_task(...)` inside a FastAPI endpoint). Absent for module-level
   * calls, which is all the TypeScript adapter records.
   */
  readonly enclosingSymbolNodeId?: string;
  readonly evidenceId: string;
}

/** A same-name symbol relationship resolved at assembly time. */
export interface SymbolReference {
  readonly kind: 'extends' | 'implements' | 'calls' | 'injects';
  readonly fromSymbolNodeId: string;
  readonly filePath: string;
  readonly targetName: string;
  readonly evidenceId: string;
}

export interface ExportedSymbol {
  readonly name: string;
  readonly nodeId: string;
}

/**
 * Language-neutral facts produced by one adapter run (PRD §30, §C14). Within-file edges are
 * final; cross-file relationships travel as references for the assembly stage to resolve.
 */
export interface GraphFragment {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly evidence: readonly EvidenceRecord[];
  readonly imports: readonly ImportReference[];
  readonly symbolReferences: readonly SymbolReference[];
  readonly decorators: readonly DecoratorFact[];
  readonly callFacts: readonly CallFact[];
  /** Exported symbols per file path — the resolution table for named imports. */
  readonly exportsByFile: Readonly<Record<string, readonly ExportedSymbol[]>>;
  readonly warnings: readonly ParseWarning[];
}

export interface RepositoryContext {
  readonly filePaths: readonly string[];
}

export interface DetectionResult {
  readonly detected: boolean;
  readonly reason?: string;
}

/** Mirrors the application `ChangeType` port value (PRD §24): a rename is ONE change. */
export type FileChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  readonly path: string;
  readonly changeType: FileChangeType;
  /** Set for renames only — the baseline path the file moved from. */
  readonly previousPath?: string;
}

export interface GitDiff {
  readonly changedFiles: readonly ChangedFile[];
}

/**
 * analyzeDiff input: the diff, the current contents of surviving changed files, and — when the
 * caller can supply them — the same files' contents at the review baseline. Without baseline
 * content the adapter reports the file as not comparable at symbol level; it never guesses.
 */
export interface AnalysisContext extends IndexingContext {
  readonly files: readonly RepositoryFile[];
  /** Baseline contents keyed by their BASELINE path (the pre-rename path for renames). */
  readonly previousFiles?: readonly RepositoryFile[];
}

/** One symbol-level difference between the baseline and the current parse of a file. */
export interface SymbolChange {
  readonly filePath: string;
  readonly symbolName: string;
  readonly nodeType: string;
  readonly kind: 'added' | 'removed' | 'changed';
  /** Node id in the new graph; absent when the symbol was removed. */
  readonly nodeId?: string;
  /** Node id in the baseline graph; absent when the symbol was added. */
  readonly previousNodeId?: string;
}

export interface ImportChange {
  readonly filePath: string;
  readonly specifier: string;
  readonly isReExport: boolean;
  readonly kind: 'added' | 'removed';
}

/** Per-file verdict: either a symbol-level comparison, or an explicit "cannot tell" (§24). */
export interface FileChangeAnalysis {
  readonly path: string;
  readonly previousPath?: string;
  readonly changeType: FileChangeType;
  /** false ⇒ the review engine must classify this file's requirements as Unverifiable. */
  readonly symbolLevel: boolean;
  readonly unverifiableReason?: string;
  readonly symbolChanges: readonly SymbolChange[];
  readonly importChanges: readonly ImportChange[];
}

/**
 * Graph consequences of a diff (PRD §24, §30).
 *
 * Application order: drop every fact whose file path is in `invalidatedFilePaths`, drop the
 * nodes/edges named in `removedNodeIds`/`removedEdgeIds`, then apply `fragment`.
 * `removedFilePaths` is the subset of invalidated paths with no replacement facts at all
 * (deleted files and the pre-rename path of a rename).
 */
export interface GraphChangeSet {
  readonly invalidatedFilePaths: readonly string[];
  readonly removedFilePaths: readonly string[];
  readonly fragment: GraphFragment;
  readonly removedNodeIds: readonly string[];
  readonly removedEdgeIds: readonly string[];
  readonly fileChanges: readonly FileChangeAnalysis[];
  /** Union of `fragment.warnings` and warnings raised while parsing baseline content. */
  readonly warnings: readonly ParseWarning[];
}

/** PRD §30 — the contract every language adapter implements. Static analysis only. */
export interface LanguageAdapter {
  readonly id: string;
  readonly supportedExtensions: readonly string[];
  detectProject(context: RepositoryContext): Promise<DetectionResult>;
  indexFiles(files: readonly RepositoryFile[], context: IndexingContext): Promise<GraphFragment>;
  analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet>;
}
