import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRepositorySnapshot } from '@impactgraph/domain';
import {
  createAdapterRegistry,
  createPythonAdapter,
  createTypeScriptAdapter,
} from '@impactgraph/language-adapters';
import { openSqliteIndexStore } from '@impactgraph/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import { indexRepository } from '../index.js';

import type { IndexStorePort, StoredGraph } from '@impactgraph/application';
import type { RepositorySnapshot } from '@impactgraph/domain';

// epic-16 line 140 — `from m import x as y` and `import { x as y }` must resolve to the DEFINING
// symbol, not vanish. Before the fix the assembler looked the LOCAL name up in the target file's
// export table, so every renamed cross-file reference silently lost its edge and left only an
// "unresolved" warning. These cases are written as the negative space that matters: an alias
// pointing at a name the target does NOT export must still resolve to nothing.

const unwrap = <T>(result: { ok: boolean; value?: T }, what: string): T => {
  if (!result.ok) {
    throw new Error(`${what} failed`);
  }
  return result.value as T;
};

const snapshotFor = (id: string): RepositorySnapshot =>
  unwrap(
    createRepositorySnapshot({
      id,
      repositoryIdentity: `/tmp/${id}`,
      head: { kind: 'branch', branch: 'main', commitSha: 'abc123' },
      dirtyWorkingTree: false,
      indexVersion: 1,
      createdAt: '2026-08-01T10:00:00.000Z',
    }),
    'snapshot',
  );

interface Indexed {
  readonly graph: StoredGraph;
  readonly parseWarnings: readonly { readonly message: string }[];
}

const open: IndexStorePort[] = [];
const dirs: string[] = [];

const indexFiles = async (
  id: string,
  files: Readonly<Record<string, string>>,
): Promise<Indexed> => {
  const dir = mkdtempSync(join(tmpdir(), 'impactgraph-alias-'));
  dirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(dir, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  const storeDir = mkdtempSync(join(tmpdir(), 'impactgraph-alias-db-'));
  dirs.push(storeDir);
  const store = unwrap(openSqliteIndexStore(join(storeDir, 'index.sqlite')), 'store');
  open.push(store);
  const registry = unwrap(
    createAdapterRegistry([createTypeScriptAdapter(), createPythonAdapter()]),
    'registry',
  );
  const snapshot = snapshotFor(id);
  const run = unwrap(
    await indexRepository(
      {
        rootDir: dir,
        snapshot,
        analysisRunId: `run-${id}`,
        createdAt: '2026-08-01T10:00:00.000Z',
      },
      { store, registry, frameworkAdapters: [] },
    ),
    'indexRepository',
  );
  const graph = unwrap(await store.loadGraph(snapshot.id), 'loadGraph');
  return { graph, parseWarnings: run.parseWarnings };
};

const edgeSummaries = (graph: StoredGraph, type: string): readonly string[] =>
  graph.edges
    .filter((edge) => edge.type === type)
    .map((edge) => `${edge.sourceId}->${edge.targetId}`)
    .sort();

afterEach(async () => {
  await Promise.all(open.splice(0).map((store) => store.close()));
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('aliased cross-file imports resolve to the defining symbol (epic-16 line 140)', () => {
  it('TypeScript `import { X as Y }` resolves an EXTENDS reference to X', async () => {
    const { graph } = await indexFiles('snap-alias-ts', {
      'package.json': JSON.stringify({ name: 'alias-ts', version: '1.0.0' }),
      'src/base.ts': 'export class BaseRepository {\n  all(): string[] {\n    return [];\n  }\n}\n',
      'src/user.ts':
        "import { BaseRepository as Repo } from './base';\n\nexport class DealRepository extends Repo {}\n",
    });
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      'symbol:src/user.ts#DealRepository->symbol:src/base.ts#BaseRepository',
    ]);
  });

  it('TypeScript re-export renaming (`export { a as b } from`) resolves through the barrel', async () => {
    const { graph } = await indexFiles('snap-alias-ts-barrel', {
      'package.json': JSON.stringify({ name: 'alias-barrel', version: '1.0.0' }),
      'src/base.ts': 'export class BaseRepository {}\n',
      'src/index.ts': "export { BaseRepository as PublicRepository } from './base';\n",
      'src/user.ts':
        "import { PublicRepository } from './index';\n\nexport class DealRepository extends PublicRepository {}\n",
    });
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      'symbol:src/user.ts#DealRepository->symbol:src/base.ts#BaseRepository',
    ]);
  });

  it('Python `from m import X as Y` resolves an EXTENDS reference to X', async () => {
    const { graph } = await indexFiles('snap-alias-py', {
      'pyproject.toml': '[project]\nname = "alias-py"\nversion = "1.0.0"\n',
      'app/__init__.py': '',
      'app/models.py': 'class Deal:\n    """The defining symbol."""\n',
      'app/api.py':
        'from app.models import Deal as DealModel\n\n\nclass Summary(DealModel):\n    pass\n',
    });
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      'symbol:app/api.py#Summary->symbol:app/models.py#Deal',
    ]);
  });

  it('an alias of a name the target does not export never resolves to a defining symbol — it warns and stays an open boundary', async () => {
    const { graph, parseWarnings } = await indexFiles('snap-alias-missing', {
      'package.json': JSON.stringify({ name: 'alias-missing', version: '1.0.0' }),
      'src/base.ts': 'export class BaseRepository {}\n',
      'src/user.ts':
        "import { NotThere as Repo } from './base';\n\nexport class DealRepository extends Repo {}\n",
    });
    // The unresolved base is never guessed into a defining symbol: the only EXTENDS edge points at
    // the explicit `unresolved-external-boundary` node that keeps the class's member set open.
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      'symbol:src/user.ts#DealRepository->external-type:src/user.ts#Repo',
    ]);
    expect(graph.nodes.find((node) => node.id === 'external-type:src/user.ts#Repo')?.type).toBe(
      'unresolved-external-boundary',
    );
    expect(
      parseWarnings.some((warning) => warning.message.includes("unresolved extends target 'Repo'")),
    ).toBe(true);
  });

  it('a non-renamed import is unaffected — the local name IS the exported name', async () => {
    const { graph } = await indexFiles('snap-alias-plain', {
      'package.json': JSON.stringify({ name: 'alias-plain', version: '1.0.0' }),
      'src/base.ts': 'export class BaseRepository {}\n',
      'src/user.ts':
        "import { BaseRepository } from './base';\n\nexport class DealRepository extends BaseRepository {}\n",
    });
    expect(edgeSummaries(graph, 'EXTENDS')).toEqual([
      'symbol:src/user.ts#DealRepository->symbol:src/base.ts#BaseRepository',
    ]);
  });
});
