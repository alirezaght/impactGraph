import { relative } from 'node:path';

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

import { readRepositoryRoster, unusableMemberState } from './registered-repositories.js';
import { captureSnapshot } from './snapshot.js';

import type { EngineFailure } from './failure.js';
import type { RepositoryRoster } from './registered-repositories.js';
import type { ProgressReporter } from '@impactgraph/application';
import type { RepositoryIndexStateDto } from '@impactgraph/contracts';
import type { RepositorySnapshot } from '@impactgraph/domain';
import type { ParseWarning } from '@impactgraph/language-adapters';
import type { AdditionalRoot, IndexSummary } from '@impactgraph/repository-intelligence';

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
  /** What this run indexed, per roster member — the root plus every registered repository. */
  readonly repositories: readonly RepositoryIndexStateDto[];
}

/** Registered, enabled, present members other than the root — the extra roots this run scans. */
const additionalRootsOf = (rootDir: string, roster: RepositoryRoster): AdditionalRoot[] => {
  const roots: AdditionalRoot[] = [];
  for (const member of roster.members) {
    const path = member.resolvedPath;
    if (member.enabled && member.present && path !== undefined && path !== rootDir) {
      roots.push({ name: member.name, rootDir: path, relativePrefix: relative(rootDir, path) });
    }
  }
  return roots;
};

/** Per-member outcome of THIS run, from the scanner's per-root counts. */
const runRepositoryStates = (
  rootDir: string,
  roster: RepositoryRoster,
  summary: IndexSummary,
): readonly RepositoryIndexStateDto[] => {
  const counts = new Map(
    (summary.rootFileCounts ?? []).map((entry) => [entry.name, entry.fileCount]),
  );
  return roster.members.map((member) => {
    if (member.resolvedPath === rootDir) {
      return { name: member.name, indexed: true, fileCount: counts.get('.') ?? summary.fileCount };
    }
    const fileCount = counts.get(member.name);
    if (fileCount === undefined || member.resolvedPath === undefined) {
      return unusableMemberState(member);
    }
    return {
      name: member.name,
      path: relative(rootDir, member.resolvedPath),
      indexed: true,
      fileCount,
    };
  });
};

export type IndexRunResult =
  | { readonly ok: true; readonly value: IndexRunOutcome }
  | { readonly ok: false; readonly failure: EngineFailure };

export interface IndexRunOptions {
  /** Streamed to the caller's surface (CLI TTY line, extension progress bar) — Story 2.6. */
  readonly onProgress?: ProgressReporter;
}

interface IndexRequestInput {
  readonly rootDir: string;
  readonly snapshot: RepositorySnapshot;
  readonly config:
    | {
        ignore?: readonly string[] | undefined;
        disabledFrameworks?: readonly string[] | undefined;
      }
    | null
    | undefined;
  readonly options: IndexRunOptions;
  readonly additionalRoots: readonly AdditionalRoot[];
}

const buildLanguageRegistry = (): ReturnType<typeof createAdapterRegistry> =>
  createAdapterRegistry([
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

const buildIndexRequest = (input: IndexRequestInput): Parameters<typeof indexRepository>[0] => ({
  rootDir: input.rootDir,
  snapshot: input.snapshot,
  analysisRunId: `run-${input.snapshot.id}`,
  createdAt: input.snapshot.createdAt,
  ignoreGlobs: input.config?.ignore ?? [],
  additionalRoots: input.additionalRoots,
  disabledFrameworks: input.config?.disabledFrameworks ?? [],
  ...(input.options.onProgress === undefined ? {} : { onProgress: input.options.onProgress }),
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
  const roster = readRepositoryRoster(rootDir);
  if (!roster.ok) {
    return { ok: false, failure: roster.error };
  }
  const captured = await captureSnapshot(rootDir, () => new Date().toISOString());
  if (!captured.ok) {
    return { ok: false, failure: captured.failure };
  }
  const store = openSqliteIndexStore(indexDatabasePath(rootDir));
  if (!store.ok) {
    return { ok: false, failure: { category: 'indexingFailure', message: store.error.message } };
  }
  const registry = buildLanguageRegistry();
  if (!registry.ok) {
    return {
      ok: false,
      failure: { category: 'internalError', message: 'adapter registry misconfigured' },
    };
  }
  try {
    const indexed = await indexRepository(
      buildIndexRequest({
        rootDir,
        snapshot: captured.snapshot,
        config: config.value,
        options,
        additionalRoots: additionalRootsOf(rootDir, roster.value),
      }),
      {
        store: store.value,
        registry: registry.value,
        frameworkAdapters: buildFrameworkAdapters(rootDir),
      },
    );
    return toRunResult(rootDir, roster.value, captured.snapshot, indexed);
  } finally {
    await store.value.close();
  }
};

const toRunResult = (
  rootDir: string,
  roster: RepositoryRoster,
  snapshot: RepositorySnapshot,
  indexed: Awaited<ReturnType<typeof indexRepository>>,
): IndexRunResult =>
  indexed.ok
    ? {
        ok: true,
        value: {
          summary: indexed.value,
          snapshot,
          repositories: runRepositoryStates(rootDir, roster, indexed.value),
        },
      }
    : { ok: false, failure: { category: 'indexingFailure', message: indexed.error.message } };
