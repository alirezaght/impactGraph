import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { NEVER_CANCELLED, operationCancelled } from '@impactgraph/application';
import { err, ok } from '@impactgraph/domain';
import {
  createFallbackAdapter,
  deserializeFragment,
  serializeFragment,
} from '@impactgraph/language-adapters';

import { assembleGraph } from './assembly/assemble.js';
import { buildDependencyFacts } from './assembly/dependency-facts.js';
import { buildDiscoveryFacts } from './assembly/discovery-facts.js';
import { enrichWithFrameworks } from './assembly/framework-enrichment.js';
import { createModuleResolver } from './assembly/module-resolvers.js';
import { buildPackageFacts } from './assembly/package-facts.js';
import { scanWorkspace } from './scanner/scanner.js';

import type { ScanWarning } from './scanner/scanner.js';
import type {
  CancellationToken,
  IndexStorePort,
  OperationCancelled,
  ProgressReporter,
  StorageError,
} from '@impactgraph/application';
import type { RepositorySnapshot, Result } from '@impactgraph/domain';
import type { FrameworkAdapter } from '@impactgraph/framework-adapters';
import type {
  AdapterRegistry,
  GraphFragment,
  IndexingContext,
  LanguageAdapter,
  ParseWarning,
  RepositoryFile,
} from '@impactgraph/language-adapters';

export interface IndexRepositoryRequest {
  readonly rootDir: string;
  readonly snapshot: RepositorySnapshot;
  readonly analysisRunId: string;
  /** ISO timestamp from the clock port. */
  readonly createdAt: string;
  readonly ignoreGlobs?: readonly string[];
  /** Framework adapters disabled by workspace configuration (Story 3.1). */
  readonly disabledFrameworks?: readonly string[];
  /** Reuse cached parse results for unchanged files (default true, PRD §32). */
  readonly incremental?: boolean;
  /** Checked between files; cancellation persists partial progress safely (PRD §32). */
  readonly cancellation?: CancellationToken;
  readonly onProgress?: ProgressReporter;
}

export interface IndexRepositoryDeps {
  readonly store: IndexStorePort;
  readonly registry: AdapterRegistry;
  /** Framework enrichment runs after assembly, additive only (PRD §31). */
  readonly frameworkAdapters?: readonly FrameworkAdapter[];
}

export interface IndexSummary {
  readonly fileCount: number;
  readonly changedFileCount: number;
  readonly reusedFileCount: number;
  readonly ignoredCount: number;
  readonly packageCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly evidenceCount: number;
  readonly scanWarnings: readonly ScanWarning[];
  readonly parseWarnings: readonly ParseWarning[];
}

interface HashedFile extends RepositoryFile {
  readonly contentHash: string;
}

const readFiles = (
  scanned: readonly { relativePath: string; absolutePath: string }[],
  warnings: ParseWarning[],
): HashedFile[] => {
  const files: HashedFile[] = [];
  for (const entry of scanned) {
    try {
      const content = readFileSync(entry.absolutePath, 'utf8');
      files.push({
        relativePath: entry.relativePath,
        content,
        contentHash: createHash('sha256').update(content).digest('hex'),
      });
    } catch {
      warnings.push({
        filePath: entry.relativePath,
        adapterId: 'scanner',
        message: 'unreadable file skipped',
      });
    }
  }
  return files;
};

interface ParsePlan {
  readonly reused: GraphFragment[];
  readonly toParse: HashedFile[];
}

/**
 * The fragment cache is keyed by (path, content hash), so a hit IS the unchanged-file check:
 * identical content → identical facts, rebound to the new snapshot. Misses — new, modified,
 * or never-successfully-cached files — get parsed. This also makes interrupted runs resumable:
 * fragments cached before a failure are reused by the next run (PRD §32).
 */
const planReuse = async (
  files: readonly HashedFile[],
  store: IndexStorePort,
  context: IndexingContext,
): Promise<ParsePlan> => {
  const cached = await store.getCachedFragments(
    files.map((file) => ({ filePath: file.relativePath, contentHash: file.contentHash })),
  );
  const payloads = cached.ok ? cached.value : {};
  const reused: GraphFragment[] = [];
  const reusedPaths = new Set<string>();
  for (const file of files) {
    const payload = payloads[file.relativePath];
    const fragment = payload === undefined ? undefined : deserializeFragment(payload, context);
    if (fragment !== undefined) {
      reused.push(fragment);
      reusedPaths.add(file.relativePath);
    }
  }
  return { reused, toParse: files.filter((file) => !reusedPaths.has(file.relativePath)) };
};

const CACHE_BATCH_SIZE = 25;

interface ParseRun {
  readonly request: IndexRepositoryRequest;
  readonly deps: IndexRepositoryDeps;
  readonly fallback: LanguageAdapter;
  readonly context: IndexingContext;
  readonly totalFiles: number;
}

/**
 * Parse per file so each result is individually cacheable; cache in batches so a cancelled or
 * crashed run still resumes from what it parsed (PRD §32). Cancellation is checked between
 * files — responsive well within the ~500 ms budget.
 */
const parseAndCache = async (
  toParse: readonly HashedFile[],
  run: ParseRun,
): Promise<Result<GraphFragment[], OperationCancelled>> => {
  const cancellation = run.request.cancellation ?? NEVER_CANCELLED;
  const fragments: GraphFragment[] = [];
  let batch: { filePath: string; contentHash: string; payload: string }[] = [];
  const flush = async (): Promise<void> => {
    if (batch.length > 0) {
      await run.deps.store.cacheFragments(batch);
      batch = [];
    }
  };
  for (const [index, file] of toParse.entries()) {
    if (cancellation.isCancellationRequested) {
      await flush(); // partial progress persists — the retry reuses it
      return err(operationCancelled(`indexing cancelled after ${String(index)} files`));
    }
    run.request.onProgress?.({
      phase: 'parsing',
      filesProcessed: run.totalFiles - toParse.length + index,
      totalFiles: run.totalFiles,
    });
    const adapter = run.deps.registry.adapterFor(file.relativePath) ?? run.fallback;
    const fragment = await adapter.indexFiles([file], run.context);
    fragments.push(fragment);
    batch.push({
      filePath: file.relativePath,
      contentHash: file.contentHash,
      payload: serializeFragment(fragment),
    });
    if (batch.length >= CACHE_BATCH_SIZE) {
      await flush();
    }
  }
  await flush();
  return ok(fragments);
};

/**
 * scan → hash → parse changed files (adapters) → assemble → persist atomically, bound to one
 * snapshot. Unchanged files reuse cached fragments; the current-generation pointer moves only
 * when the whole update commits (PRD §32, §34; repository-analysis.md).
 */
export const indexRepository = async (
  request: IndexRepositoryRequest,
  deps: IndexRepositoryDeps,
): Promise<Result<IndexSummary, StorageError | OperationCancelled>> => {
  const startedAt = Date.now();
  request.onProgress?.({ phase: 'scanning', filesProcessed: 0, totalFiles: 0 });
  const scan = scanWorkspace(request.rootDir, { ignoreGlobs: request.ignoreGlobs ?? [] });
  const context: IndexingContext = {
    repositorySnapshotId: request.snapshot.id,
    analysisRunId: request.analysisRunId,
    createdAt: request.createdAt,
  };

  const readWarnings: ParseWarning[] = [];
  const files = readFiles(scan.files, readWarnings);
  const plan =
    (request.incremental ?? true)
      ? await planReuse(files, deps.store, context)
      : { reused: [], toParse: files };

  const fallback = createFallbackAdapter();
  const parsed = await parseAndCache(plan.toParse, {
    request,
    deps,
    fallback,
    context,
    totalFiles: files.length,
  });
  if (!parsed.ok) {
    return parsed;
  }
  const fragments = [
    ...plan.reused,
    ...parsed.value,
    buildPackageFacts(scan.packages, scan.files, context),
    buildDiscoveryFacts(scan.packages, scan.files, context),
    buildDependencyFacts(scan.packages, context),
  ];

  request.onProgress?.({
    phase: 'assembling',
    filesProcessed: files.length,
    totalFiles: files.length,
  });
  const assembled = assembleGraph(fragments, context, createModuleResolver(files));
  const graph = await enrichWithFrameworks(
    assembled,
    deps.frameworkAdapters ?? [],
    context,
    request.disabledFrameworks ?? [],
  );

  request.onProgress?.({
    phase: 'persisting',
    filesProcessed: files.length,
    totalFiles: files.length,
  });
  return persistAndSummarize({ request, deps, scan, files, plan, graph, readWarnings, startedAt });
};

interface PersistInput {
  readonly request: IndexRepositoryRequest;
  readonly deps: IndexRepositoryDeps;
  readonly scan: ReturnType<typeof scanWorkspace>;
  readonly files: readonly HashedFile[];
  readonly plan: ParsePlan;
  readonly graph: Awaited<ReturnType<typeof enrichWithFrameworks>>;
  readonly readWarnings: readonly ParseWarning[];
  readonly startedAt: number;
}

const persistAndSummarize = async (
  input: PersistInput,
): Promise<Result<IndexSummary, StorageError>> => {
  const { request, deps, scan, files, plan, graph, readWarnings, startedAt } = input;
  const persisted = await deps.store.applyIndexUpdate({
    snapshot: request.snapshot,
    nodes: graph.nodes,
    edges: graph.edges,
    evidence: graph.evidence,
    fileHashes: files.map((file) => ({
      filePath: file.relativePath,
      contentHash: file.contentHash,
    })),
    markCurrent: true,
  });
  if (!persisted.ok) {
    return err(persisted.error);
  }
  const parseWarnings = [...readWarnings, ...graph.warnings];
  await deps.store.saveRunRecord({
    snapshotId: request.snapshot.id,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    fileCount: files.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    warningCount: scan.warnings.length + parseWarnings.length,
    warnings: [
      ...scan.warnings.map((warning) => `${warning.path}: ${warning.reason}`),
      ...parseWarnings.map((warning) => `${warning.filePath}: ${warning.message}`),
    ].slice(0, 50),
  });
  return ok({
    fileCount: files.length,
    changedFileCount: plan.toParse.length,
    reusedFileCount: plan.reused.length,
    ignoredCount: scan.ignoredCount,
    packageCount: scan.packages.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    evidenceCount: graph.evidence.length,
    scanWarnings: scan.warnings,
    parseWarnings,
  });
};
