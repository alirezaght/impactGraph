import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import {
  createAstroFrameworkAdapter,
  createAsyncChainAdapter,
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
} from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import {
  fixtureRepoPath,
  formatMovement,
  graphGoldenPath,
  graphMovement,
  mergeMovement,
  nodeMovement,
  parseGraphNodes,
  parseGraphGolden,
  serializeGraphGolden,
} from '@impactgraph/test-kit';
import { describe, expect, it } from 'vitest';

import { indexRepository } from './index.js';

import type { RepositorySnapshot } from '@impactgraph/domain';
import type { FrameworkAdapter } from '@impactgraph/framework-adapters';
import type { MovementReport } from '@impactgraph/test-kit';

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
  // Item 5: the async chain runs before cross-stack, which reads the nodes it emits.
  createAsyncChainAdapter(),
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
  // Item 5/8 (trial follow-up): the observed notification case end to end — outbox → relay →
  // Pub/Sub topic → push subscription → push route → projection → renderer → locale keys → test.
  { name: 'notification-chain', frameworkAdapters: builtInAdapters },
  // Item 6/7 (trial follow-up): the first observed case — a nullable field crosses an HTTP boundary
  // and is dropped, defaulted, then used to skip a row in another service.
  { name: 'nullable-boundary', frameworkAdapters: builtInAdapters },
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
        createAssetAdapter(),
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

/**
 * Expected graph movement against the committed goldens, summed over all fixtures. Steady state is
 * everything unchanged; a commit that legitimately moves edges names the categories here, which is
 * the reviewable statement of what it did.
 */
const EXPECTED_GRAPH_MOVEMENT: Readonly<Record<string, number>> = {
  // 459 → 548. Two deliberate changes, in the same commit as this number:
  //
  // * Item 8: the asset adapter types every `.json` file (`config:`/`locale:`/`openapi:`/`events:`)
  //   and links it to its file node with CONTAINS, so every fixture with a manifest gains a node and
  //   an edge. Previously those files were anonymous `file` nodes with a "no adapter" warning.
  // * The `notification-chain` fixture joins the roster with the full event chain plus locale keys.
  //
  // 548 → 613: item 7 — declared fields become `field` nodes with a CONTAINS edge to their shape, and
  // DTO mapping emits FLOWS_TO/RENAMED_TO; plus the `nullable-boundary` fixture joins the roster.
  //
  // 613 → 616: item 6 — an outbound call to an ABSOLUTE url now matches a workspace route by path
  // 616 → 623: ADR-0017 — the runtime layer. Each Cloud Run service gains a CONTAINS edge to its
  // container, each container a RECEIVES_ENV edge per declared env binding, and `locals` entries
  // gain RESOLVES_TO/ROUTES_TO edges along the address they carry. All additive; nothing moved.
  // (`CALLS_ENDPOINT`), so the cross-service HTTP flow that was invisible becomes an edge.
  //
  // 623 → 632: ADR-0020 §3 — Python class-attribute fields, all in `fastapi-app`:
  // * 5 DECLARES_MEMBER edges: Deal → {id, name, visibility} (models.py, pre-existing Pydantic
  //   shape) and Listing → {id, title} (listings.py, the new SQLAlchemy model).
  // * 3 CONTAINS edges for the two new fixture files' symbols (Base, Listing,
  //   load_listings_by_ids) and 1 EXTENDS edge Listing → Base.
  //
  // 632 → 638: member resolution through inheritance, all in `fastapi-app`:
  // * 1 EXTENDS edge Deal → external-type BaseModel: an unresolved supertype is now modelled as an
  //   `unresolved-external-boundary` node instead of being dropped, so a class's member set can be
  //   told OPEN from closed (the SqlOutboundQueueRepository.list_rows field failure).
  // * The outbound.py mixin fixture: 2 file-CONTAINS (mixin, repository class), 2 class-CONTAINS
  //   (list_rows, save) and 1 EXTENDS SqlOutboundQueueRepository → OutboundAuditReadsMixin.
  unchanged: 638,
};

/** Expected NODE movement, summed over all fixtures. Steady state is everything unchanged. */
const EXPECTED_NODE_MOVEMENT: Readonly<Record<string, number>> = {
  // 479 → 485: ADR-0017 — one `container` node per Cloud Run service/job, plus the `locals`
  // entries and `service-url` entry points that make a deployment chain walkable. All additive.
  // 352 → 424 for the asset adapter and the notification-chain fixture; 424 → 479 for the `field`
  // nodes of item 7 and the `nullable-boundary` fixture.
  //
  // 485 → 495: ADR-0020 §3 — Python fields, all in `fastapi-app`: 3 `field` nodes on the
  // pre-existing Pydantic Deal (id, name, visibility) and, from the two new fixture files
  // (listings.py, queries.py), 2 file nodes, the Listing class, its 2 `field` nodes
  // (Listing.id — declared UUID — and Listing.title), the Base symbol, and the
  // load_listings_by_ids function that carries the analogous `= ANY(` SQL literal.
  //
  // 495 → 501: member resolution through inheritance, all in `fastapi-app`: the
  // `external-type:app/models.py#BaseModel` unresolved-external-boundary node (Deal's Pydantic
  // base lives outside the index — its member set is OPEN, stated instead of dropped), plus the
  // outbound.py mixin fixture's file node, 2 classes and 2 methods.
  unchanged: 501,
};

describe('graph goldens per fixture (Story 17.3, PRD §42.3)', () => {
  const movements = new Map<string, MovementReport>();
  const nodeMovements = new Map<string, MovementReport>();

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
      movements.set(
        fixture.name,
        graphMovement(parseGraphGolden(expected), parseGraphGolden(actual)),
      );
      nodeMovements.set(
        fixture.name,
        nodeMovement(parseGraphNodes(expected), parseGraphNodes(actual)),
      );
      expect(actual, mismatchHint(fixture.name, goldenFile)).toBe(expected);
    }, 30_000);
  }

  /**
   * The graph half of the acceptance record, aggregated across every fixture. A vocabulary migration
   * should show relationship changes and nothing else; an extraction change should show additions or
   * removals. Asserted, not merely printed, so an unexplained transition fails CI.
   *
   * `EXPECTED_GRAPH_MOVEMENT` is the specification: edit it deliberately in the same commit that
   * causes the movement, and CI rejects anything it does not name.
   */
  it('reports node movement across every fixture, and nothing unexplained', () => {
    const merged = mergeMovement([...nodeMovements.values()]);
    // eslint-disable-next-line no-console
    console.log(formatMovement('NODE MOVEMENT (all fixtures)', merged));
    for (const [category, total] of Object.entries(merged.totals)) {
      expect(total, `unexpected node movement: ${category}`).toBe(
        EXPECTED_NODE_MOVEMENT[category] ?? 0,
      );
    }
  });

  it('reports graph movement across every fixture, and nothing unexplained', () => {
    const merged = mergeMovement([...movements.values()]);
    // eslint-disable-next-line no-console
    console.log(formatMovement('GRAPH MOVEMENT (all fixtures)', merged));
    const combined = merged.totals;

    // Ambiguity is a hard failure: a plausible-looking pairing the classifier cannot justify would
    // be read as an acceptance record.
    expect(combined['unmatched-ambiguous'] ?? 0, 'ambiguous edge matches').toBe(0);
    for (const [category, total] of Object.entries(combined)) {
      expect(total, `unexpected graph movement: ${category}`).toBe(
        EXPECTED_GRAPH_MOVEMENT[category] ?? 0,
      );
    }
  });
});
