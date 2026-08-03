import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import {
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
  createAstroAdapter,
  createHtmlAdapter,
  createJavaAdapter,
  createPrismaAdapter,
  createPythonAdapter,
  createSpringConfigAdapter,
  createTerraformAdapter,
  createTypeScriptAdapter,
} from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { fixtureRepoPath, graphGoldenPath, serializeGraphGolden } from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import { indexRepository } from './index.js';

import type { RepositorySnapshot } from '@impactgraph/domain';
import type { FrameworkAdapter } from '@impactgraph/framework-adapters';

// Story 17.3 / PRD §42.3 — one committed golden per TS/JS fixture pins the exact set of
// deterministic nodes and edges the indexer produces. The analyzers suite runs in CI, so a
// mismatch against the committed file IS the CI diff. Volatile fields are excluded by the
// serializer; adapters mirror the production roster in workspace-engine's indexing assembly.

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const FIXED_TIME = '2026-08-01T10:00:00.000Z';

const buildSnapshot = (fixture: string): RepositorySnapshot =>
  unwrap(
    createRepositorySnapshot({
      id: `snap-golden-${fixture}`,
      repositoryIdentity: `/fixtures/${fixture}`,
      head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
      dirtyWorkingTree: false,
      indexVersion: 1,
      createdAt: FIXED_TIME,
    }),
    'snapshot',
  );

// The §Z8 rules the internal-pubsub fixture exists for (mirrors the rules.yml used in the
// workspace-engine custom-detection suite) — without them the fixture is just plain TS files.
const PUBSUB_RULES = [
  {
    id: 'internal-pubsub-consumer',
    language: 'typescript' as const,
    match: { imports: ['@company/messaging'], decorators: ['Subscribe'] },
    produces: {
      nodeCategory: 'integration',
      nodeType: 'subscription',
      nameArgument: 0,
      edgeType: 'SUBSCRIBES_TO',
    },
  },
  {
    id: 'internal-pubsub-publisher',
    language: 'typescript' as const,
    match: { imports: ['@company/messaging'], calls: ['publishTo'] },
    produces: {
      nodeCategory: 'integration',
      nodeType: 'topic',
      nameArgument: 0,
      edgeType: 'PUBLISHES',
    },
  },
];

// Mirrors `buildFrameworkAdapters` in packages/workspace-engine/src/indexing.ts, ORDER INCLUDED:
// each adapter sees the graph as enriched by the ones before it, and `cross-stack` correlates
// nodes the others produce, so it runs last there and last here.
const builtInAdapters = (): FrameworkAdapter[] => [
  createNestJsAdapter(),
  createExpressAdapter(),
  createFastApiAdapter(),
  createSpringAdapter(),
  createAstroFrameworkAdapter(),
  createGenericDetectorsAdapter(),
  createTerraformFrameworkAdapter(),
  createCrossStackAdapter(),
];

const FIXTURES: readonly { name: string; frameworkAdapters: () => FrameworkAdapter[] }[] = [
  { name: 'ts-basic', frameworkAdapters: builtInAdapters },
  { name: 'express-app', frameworkAdapters: builtInAdapters },
  { name: 'nestjs-app', frameworkAdapters: builtInAdapters },
  { name: 'fastapi-app', frameworkAdapters: builtInAdapters },
  { name: 'java-spring', frameworkAdapters: builtInAdapters },
  { name: 'astro-site', frameworkAdapters: builtInAdapters },
  { name: 'html-site', frameworkAdapters: builtInAdapters },
  { name: 'terraform-gcp', frameworkAdapters: builtInAdapters },
  { name: 'cross-stack', frameworkAdapters: builtInAdapters },
  // Monorepo (§42.2): pins that workspace-resolved imports (`@fixture/core`) become real edges.
  // A single-package analysis loses them entirely, so this golden is the regression net for
  // cross-package resolution.
  { name: 'monorepo', frameworkAdapters: builtInAdapters },
  {
    name: 'internal-pubsub',
    frameworkAdapters: () => [
      ...builtInAdapters().filter((adapter) => adapter.id !== 'cross-stack'),
      createCustomDetectionAdapter(PUBSUB_RULES),
      createCrossStackAdapter(),
    ],
  },
];

const indexFixture = async (
  name: string,
  frameworkAdapters: FrameworkAdapter[],
): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'impactgraph-golden-'));
  const store = unwrap(openSqliteIndexStore(join(dir, 'index.sqlite')), 'store');
  try {
    const registry = unwrap(
      createAdapterRegistry([
        createTypeScriptAdapter(),
        createPythonAdapter(),
        createJavaAdapter(),
        createAstroAdapter(),
        createHtmlAdapter(),
        createTerraformAdapter(),
        createPrismaAdapter(),
        createSpringConfigAdapter(),
      ]),
      'registry',
    );
    const snapshot = buildSnapshot(name);
    unwrap(
      await indexRepository(
        {
          rootDir: fixtureRepoPath(name),
          snapshot,
          analysisRunId: `run-golden-${name}`,
          createdAt: FIXED_TIME,
        },
        { store, registry, frameworkAdapters },
      ),
      'indexRepository',
    );
    const graph = unwrap(await store.loadGraph(snapshot.id), 'loadGraph');
    return serializeGraphGolden(graph);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

const mismatchHint = (name: string, goldenFile: string): string =>
  [
    `Indexed graph for fixture '${name}' no longer matches its committed golden`,
    `(${goldenFile}).`,
    'If this change is intentional, regenerate JUST THIS FIXTURE with',
    `UPDATE_GOLDENS=${name} pnpm test:analyzers graph-goldens`,
    '(UPDATE_GOLDENS=1 rewrites every fixture — avoid it while other work is in flight)',
    'and justify every changed line in your PR — never blanket-regenerate to silence a failure',
    '(docs/engineering/testing-strategy.md §3).',
  ].join(' ');

/** UPDATE_GOLDENS: unset = compare only; `<fixture>` (comma-separated) = rewrite those; `1`/`all` = rewrite every one. */
const shouldUpdate = (name: string): boolean => {
  const flag = process.env['UPDATE_GOLDENS'];
  if (flag === undefined || flag.length === 0) {
    return false;
  }
  if (flag === '1' || flag === 'all') {
    return true;
  }
  return flag.split(',').some((entry) => entry.trim() === name);
};

describe('graph goldens per fixture (Story 17.3, PRD §42.3)', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: indexed graph matches the committed golden`, async () => {
      const actual = await indexFixture(fixture.name, fixture.frameworkAdapters());
      const goldenFile = graphGoldenPath(fixture.name);
      // Scoped regeneration: UPDATE_GOLDENS=<fixture> rewrites one file. `1`/`all` still
      // rewrites everything, but a targeted value is the safe default — a blanket regeneration
      // silently adopts whatever unrelated in-flight work happens to be on disk, which is how a
      // golden gets "reviewed into existence" by nobody.
      if (shouldUpdate(fixture.name)) {
        writeFileSync(goldenFile, actual);
      }
      const expected = readFileSync(goldenFile, 'utf8');
      expect(actual, mismatchHint(fixture.name, goldenFile)).toBe(expected);
    }, 30_000);
  }
});
