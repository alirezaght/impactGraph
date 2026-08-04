import {
  createAsyncChainAdapter,
  createAstroFrameworkAdapter,
  createCrossStackAdapter,
  createCustomDetectionAdapter,
  createExpressAdapter,
  createFastApiAdapter,
  createGenericDetectorsAdapter,
  createNestJsAdapter,
  createSpringAdapter,
  createTerraformFrameworkAdapter,
} from '@impactgraph/framework-adapters';
import {
  createAdapterRegistry,
  createAssetAdapter,
  createAstroAdapter,
  createHtmlAdapter,
  createJavaAdapter,
  createPrismaAdapter,
  createPythonAdapter,
  createSpringConfigAdapter,
  createTerraformAdapter,
  createTypeScriptAdapter,
  NOT_SPRING_CONFIG_WARNING,
} from '@impactgraph/language-adapters';
import {
  indexDatabasePath,
  openSqliteIndexStore,
  readRulesConfig,
  readWorkspaceConfig,
} from '@impactgraph/persistence';
import { indexRepository } from '@impactgraph/repository-intelligence';

import { captureSnapshot } from './snapshot.js';

import type { EngineFailure } from './failure.js';
import type { ProgressReporter } from '@impactgraph/application';
import type { RepositorySnapshot } from '@impactgraph/domain';
import type { ParseWarning } from '@impactgraph/language-adapters';
import type { IndexSummary } from '@impactgraph/repository-intelligence';

/**
 * Fallback coverage is expected degradation, not a warning; real scan/parse warnings are.
 *
 * The Spring configuration adapter claims every `.yml`/`.yaml`/`.properties` because the registry
 * dispatches by extension and cannot key on a filename, so most of what it is handed is not Spring
 * configuration at all. That case is the fallback's case wearing a different adapter id: the file
 * still gets its file-level fact, and reporting it would bury the real warnings under one line per
 * YAML file in the repository.
 */
const isExpectedDegradation = (warning: ParseWarning): boolean =>
  warning.adapterId === 'fallback' ||
  (warning.adapterId === 'spring-config' && warning.message === NOT_SPRING_CONFIG_WARNING);

export const indexWarnings = (summary: IndexSummary): string[] => [
  ...summary.scanWarnings.map((warning) => `${warning.path}: ${warning.reason}`),
  ...summary.parseWarnings
    .filter((warning) => !isExpectedDegradation(warning))
    .map((warning) => `${warning.filePath}: ${warning.message}`),
];

// §Z8: repo-specific detection from committed configuration, alongside the built-ins.
//
// ORDER MATTERS. Each adapter sees the graph as enriched by the ones before it, so `cross-stack`
// is last on purpose: the routes and topics it correlates (PRD §C13) are produced by the adapters
// above it, including the §Z8 custom rules. `packages/repository-intelligence/src/graph-goldens.
// test.ts` mirrors this roster and its order — a golden run over a different roster proves nothing
// about the shipped product.
const buildFrameworkAdapters = (rootDir: string) => {
  const rules = readRulesConfig(rootDir);
  return [
    createNestJsAdapter(),
    createExpressAdapter(),
    createFastApiAdapter(),
    createSpringAdapter(),
    createAstroFrameworkAdapter(),
    createGenericDetectorsAdapter(),
    createTerraformFrameworkAdapter(),
    createCustomDetectionAdapter(rules.ok ? (rules.value?.detections ?? []) : []),
    // Item 5: the async chain runs before `cross-stack` because the push endpoints and projections
    // it emits are nodes the cross-stack correlation then reads.
    createAsyncChainAdapter(),
    createCrossStackAdapter(),
  ];
};

export interface IndexRunOutcome {
  readonly summary: IndexSummary;
  readonly snapshot: RepositorySnapshot;
}

export type IndexRunResult =
  | { readonly ok: true; readonly value: IndexRunOutcome }
  | { readonly ok: false; readonly failure: EngineFailure };

export interface IndexRunOptions {
  /** Streamed to the caller's surface (CLI TTY line, extension progress bar) — Story 2.6. */
  readonly onProgress?: ProgressReporter;
}

const buildIndexRequest = (
  rootDir: string,
  snapshot: RepositorySnapshot,
  config:
    | {
        ignore?: readonly string[] | undefined;
        disabledFrameworks?: readonly string[] | undefined;
      }
    | null
    | undefined,
  options: IndexRunOptions,
): Parameters<typeof indexRepository>[0] => ({
  rootDir,
  snapshot,
  analysisRunId: `run-${snapshot.id}`,
  createdAt: snapshot.createdAt,
  ignoreGlobs: config?.ignore ?? [],
  disabledFrameworks: config?.disabledFrameworks ?? [],
  ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
});

/** One full index run over the workspace — shared by `index` and `review` (which reindexes). */
export const performIndexRun = async (
  rootDir: string,
  options: IndexRunOptions = {},
): Promise<IndexRunResult> => {
  const config = readWorkspaceConfig(rootDir);
  if (!config.ok) {
    return {
      ok: false,
      failure: { category: 'configurationError', message: config.error.message },
    };
  }
  const captured = await captureSnapshot(rootDir, () => new Date().toISOString());
  if (!captured.ok) {
    return { ok: false, failure: captured.failure };
  }
  const store = openSqliteIndexStore(indexDatabasePath(rootDir));
  if (!store.ok) {
    return { ok: false, failure: { category: 'indexingFailure', message: store.error.message } };
  }
  const registry = createAdapterRegistry([
    createTypeScriptAdapter(),
    createPythonAdapter(),
    createJavaAdapter(),
    createAstroAdapter(),
    createHtmlAdapter(),
    createTerraformAdapter(),
    createPrismaAdapter(),
    createSpringConfigAdapter(),
    // §item 8: `.json` assets — locale bundles, OpenAPI, JSON Schema, event definitions,
    // configuration. `.tf.json` still routes to Terraform (longest matching suffix wins).
    createAssetAdapter(),
  ]);
  if (!registry.ok) {
    return {
      ok: false,
      failure: { category: 'internalError', message: 'adapter registry misconfigured' },
    };
  }
  try {
    const indexed = await indexRepository(
      buildIndexRequest(rootDir, captured.snapshot, config.value, options),
      {
        store: store.value,
        registry: registry.value,
        frameworkAdapters: buildFrameworkAdapters(rootDir),
      },
    );
    if (!indexed.ok) {
      return {
        ok: false,
        failure: { category: 'indexingFailure', message: indexed.error.message },
      };
    }
    return { ok: true, value: { summary: indexed.value, snapshot: captured.snapshot } };
  } finally {
    await store.value.close();
  }
};
