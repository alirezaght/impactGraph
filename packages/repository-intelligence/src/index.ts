// @impactgraph/repository-intelligence — deterministic repository discovery and indexing
// (PRD §C15.1). Never executes repository code; never emits llm-inferred provenance.

export type {
  ScanOptions,
  ScannedFile,
  ScanWarning,
  ManifestEntryPoint,
  PackageInfo,
  ScanResult,
} from './scanner/scanner.js';
export { scanWorkspace } from './scanner/scanner.js';
export { DEFAULT_IGNORE_GLOBS, SECRET_FILE_GLOBS, createIgnoreMatcher } from './scanner/ignore.js';
export type { IgnoreMatcher } from './scanner/ignore.js';
export type { AssembledGraph } from './assembly/assemble.js';
export { assembleGraph } from './assembly/assemble.js';
export { buildPackageFacts } from './assembly/package-facts.js';
export { buildDiscoveryFacts } from './assembly/discovery-facts.js';
export { buildDependencyFacts } from './assembly/dependency-facts.js';
export { enrichWithFrameworks } from './assembly/framework-enrichment.js';
export type {
  IndexRepositoryRequest,
  IndexRepositoryDeps,
  IndexSummary,
} from './index-repository.js';
export { indexRepository } from './index-repository.js';
export type {
  WorkerIndexRequest,
  ParentToWorkerMessage,
  WorkerToParentMessage,
} from './runner/protocol.js';
export { INDEX_WORKER_PROTOCOL_VERSION } from './runner/protocol.js';
export type { IndexRunOutcome, IndexRunnerHandle } from './runner/client.js';
export { startIndexWorker, indexWorkerEntryPath } from './runner/client.js';
export { runIndexWorker } from './runner/worker-main.js';
