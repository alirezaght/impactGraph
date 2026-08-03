import { describe, expect, it } from 'vitest';

import { createPythonAdapter } from './python-adapter.js';
import { createPythonModuleResolver, pythonModuleStems } from './python-modules.js';

import type { GraphFragment, IndexingContext } from '../types.js';

// Story 16.2 — the Python adapter's own facts. Fixture-level behaviour is pinned by the FastAPI
// graph golden; this suite pins the individual claims that golden rests on.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-python',
  analysisRunId: 'run-python',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const SOURCE = `from fastapi import APIRouter
from app.models import Deal as DealModel
import os.path as osp

router = APIRouter()
_private = 1


class Deal(BaseModel):
    id: str

    def touch(self) -> None:
        refresh()


@router.get("/deals/{deal_id}", response_model=Deal)
def get_deal(deal_id: str) -> Deal:
    audit.record("read", scope="deal")
    return Deal(id=deal_id)
`;

const index = (content: string, relativePath = 'app/deals.py'): Promise<GraphFragment> =>
  createPythonAdapter().indexFiles([{ relativePath, content }], CONTEXT);

describe('Python language adapter (PRD §30, Story 16.2)', () => {
  it('emits file, class, method and function nodes with CONTAINS edges', async () => {
    const fragment = await index(SOURCE);
    const byId = new Map(fragment.nodes.map((node) => [String(node.id), node]));
    expect(byId.get('file:app/deals.py')?.type).toBe('file');
    expect(byId.get('symbol:app/deals.py#Deal')?.type).toBe('class');
    expect(byId.get('symbol:app/deals.py#Deal.touch')?.type).toBe('method');
    expect(byId.get('symbol:app/deals.py#get_deal')?.type).toBe('function');
    expect(byId.get('symbol:app/deals.py#router')?.type).toBe('symbol');
    const edges = fragment.edges.map((edge) => `${edge.type} ${edge.sourceId}->${edge.targetId}`);
    expect(edges).toContain('CONTAINS file:app/deals.py->symbol:app/deals.py#Deal');
    expect(edges).toContain('CONTAINS symbol:app/deals.py#Deal->symbol:app/deals.py#Deal.touch');
  });

  it('carries deterministic provenance, evidence with a range, and the context snapshot', async () => {
    const fragment = await index(SOURCE);
    const evidenceIds = new Set(fragment.evidence.map((record) => record.id));
    for (const fact of [...fragment.nodes, ...fragment.edges]) {
      expect(fact.knowledge.provenance).toBe('static-analysis');
      expect(fact.knowledge.repositorySnapshotId).toBe(CONTEXT.repositorySnapshotId);
      expect(fact.knowledge.evidenceIds.length).toBeGreaterThan(0);
      expect(fact.knowledge.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
    const declaration = fragment.evidence.find((record) => record.kind === 'symbol-declaration');
    expect(declaration?.source).toMatchObject({ kind: 'file', filePath: 'app/deals.py' });
    expect(declaration?.source.kind === 'file' && declaration.source.range).toBeDefined();
  });

  it('records imports with their local bindings', async () => {
    const fragment = await index(SOURCE);
    expect(
      fragment.imports.map((reference) => [reference.specifier, reference.importedNames]),
    ).toEqual([
      ['fastapi', ['APIRouter']],
      ['app.models', ['DealModel']],
      ['os.path', ['osp']],
    ]);
  });

  it('records base classes, bare calls, and receiver-qualified calls in separate channels', async () => {
    const fragment = await index(SOURCE);
    expect(
      fragment.symbolReferences.map((reference) => [reference.kind, reference.targetName]),
    ).toEqual(
      expect.arrayContaining([
        ['extends', 'BaseModel'],
        ['calls', 'refresh'],
        ['calls', 'Deal'],
      ]),
    );
    const audit = fragment.callFacts.find((fact) => fact.calleeName === 'record');
    expect(audit).toMatchObject({
      receiverName: 'audit',
      stringArguments: ['read'],
      keywordStringArguments: { scope: 'deal' },
      enclosingSymbolNodeId: 'symbol:app/deals.py#get_deal',
    });
    expect(fragment.callFacts.find((fact) => fact.calleeName === 'APIRouter')?.assignedTo).toBe(
      'router',
    );
  });

  it('records decorators with their dotted name and literal arguments', async () => {
    const fragment = await index(SOURCE);
    expect(fragment.decorators).toEqual([
      expect.objectContaining({
        targetNodeId: 'symbol:app/deals.py#get_deal',
        decoratorName: 'router.get',
        stringArguments: ['/deals/{deal_id}'],
        identifierLists: { arguments: [], response_model: ['Deal'] },
      }),
    ]);
  });

  it('keeps underscore-prefixed names out of the export table', async () => {
    const fragment = await index(SOURCE);
    const exported = (fragment.exportsByFile['app/deals.py'] ?? []).map((entry) => entry.name);
    expect(exported).toEqual(['router', 'Deal', 'get_deal']);
  });

  it('detects a Python project and explains a non-match', async () => {
    const adapter = createPythonAdapter();
    const hit = await adapter.detectProject({ filePaths: ['app/main.py', 'pyproject.toml'] });
    expect(hit).toEqual({ detected: true, reason: 'Python sources and a Python manifest present' });
    const miss = await adapter.detectProject({ filePaths: ['src/index.ts'] });
    expect(miss).toEqual({ detected: false, reason: 'no Python sources found' });
  });

  it('supports symbol-level analyzeDiff through the shared implementation', async () => {
    const changeSet = await createPythonAdapter().analyzeDiff(
      { changedFiles: [{ path: 'app/deals.py', changeType: 'modified' }] },
      {
        ...CONTEXT,
        files: [
          { relativePath: 'app/deals.py', content: 'def a():\n    pass\n\ndef b():\n    pass\n' },
        ],
        previousFiles: [{ relativePath: 'app/deals.py', content: 'def a():\n    pass\n' }],
      },
    );
    expect(changeSet.fileChanges[0]?.symbolLevel).toBe(true);
    expect(changeSet.fileChanges[0]?.symbolChanges).toEqual([
      expect.objectContaining({ symbolName: 'b', kind: 'added' }),
    ]);
  });
});

describe('Python module resolution', () => {
  const files = new Set([
    'app/main.py',
    'app/models.py',
    'app/routers/__init__.py',
    'src/lib/x.py',
  ]);
  const resolve = createPythonModuleResolver(files, ['', 'src']);

  it('resolves absolute, package, source-root and relative specifiers', () => {
    expect(resolve('app/main.py', 'app.models')).toBe('app/models.py');
    expect(resolve('app/main.py', 'app.routers')).toBe('app/routers/__init__.py');
    expect(resolve('app/main.py', 'lib.x')).toBe('src/lib/x.py');
    expect(resolve('app/routers/__init__.py', '..models')).toBe('app/models.py');
  });

  it('returns undefined for modules outside the scanned files — never a guess', () => {
    expect(resolve('app/main.py', 'fastapi')).toBeUndefined();
    expect(resolve('app/main.py', 'os.path')).toBeUndefined();
  });

  it('exposes the path stems a specifier denotes', () => {
    expect(pythonModuleStems('app/main.py', 'app.routers.deals')).toEqual(['app/routers/deals']);
    expect(pythonModuleStems('app/routers/deals.py', '.helpers')).toEqual(['app/routers/helpers']);
  });
});
