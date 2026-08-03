// Structural mirrors of the PRD §30 LanguageAdapter surface.
//
// They are declared here rather than imported from `@impactgraph/language-adapters` on purpose:
// test-kit is a dev-only dependency OF the adapter packages, so importing back would create a
// package cycle. A real `LanguageAdapter` satisfies these shapes structurally — if it ever
// stops doing so, the adapter's own contract test fails to compile, which is the point.

export interface ContractFile {
  readonly relativePath: string;
  readonly content: string;
}

export interface ContractIndexingContext {
  readonly repositorySnapshotId: string;
  readonly analysisRunId: string;
  readonly createdAt: string;
}

export interface ContractKnowledge {
  readonly provenance: string;
  readonly evidenceIds: readonly string[];
  readonly repositorySnapshotId: string;
}

export interface ContractNode {
  readonly id: string;
  readonly type: string;
  readonly category: string;
  readonly knowledge: ContractKnowledge;
}

export interface ContractEdge {
  readonly id: string;
  readonly type: string;
  readonly knowledge: ContractKnowledge;
}

export interface ContractWarning {
  readonly filePath: string;
  readonly message: string;
}

export interface ContractFragment {
  readonly nodes: readonly ContractNode[];
  readonly edges: readonly ContractEdge[];
  readonly evidence: readonly { readonly id: string }[];
  readonly warnings: readonly ContractWarning[];
}

export interface ContractDetectionResult {
  readonly detected: boolean;
  readonly reason?: string;
}

export interface ContractLanguageAdapter {
  readonly id: string;
  readonly supportedExtensions: readonly string[];
  detectProject(context: {
    readonly filePaths: readonly string[];
  }): Promise<ContractDetectionResult>;
  indexFiles(
    files: readonly ContractFile[],
    context: ContractIndexingContext,
  ): Promise<ContractFragment>;
}

/** One invariant's verdict. `failures` is empty for both `passed` and `skipped`. */
export interface ContractCheckResult {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly failures: readonly string[];
  /** Why a check was skipped, or what it observed — surfaced so skips are never silent. */
  readonly detail?: string;
}

export interface LanguageAdapterContractOptions {
  /** Fixture repository the files come from (PRD §42.2) — used in failure messages only. */
  readonly fixtureName: string;
  readonly context: ContractIndexingContext;
  /** Files the adapter is expected to claim and parse. At least one. */
  readonly matchingFiles: readonly ContractFile[];
  /** Paths of a repository this adapter should NOT detect. */
  readonly nonMatchingPaths: readonly string[];
  /** Hostile-but-valid content (the `malicious` fixture) — must not abort the run (§42.5). */
  readonly hostileFiles: readonly ContractFile[];
  /** Files whose extensions are outside `supportedExtensions`. */
  readonly foreignFiles: readonly ContractFile[];
  /** Content this adapter's parser genuinely cannot parse, when such content exists. */
  readonly unparseableFile?: ContractFile;
  /** Set for catch-all adapters (the fallback) that legitimately detect every repository. */
  readonly expectDetectionForNonMatching?: boolean;
}
