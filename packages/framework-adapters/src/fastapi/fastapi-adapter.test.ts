import { createPythonAdapter } from '@impactgraph/language-adapters';
import { describe, expect, it } from 'vitest';

import { createFastApiAdapter } from './fastapi-adapter.js';

import type { CodeGraph } from '../types.js';
import type {
  GraphFragment,
  IndexingContext,
  RepositoryFile,
} from '@impactgraph/language-adapters';

// PRD §31/§34 — what enrichment does when the graph does NOT give it what it needs. The happy
// path is pinned by the full-pipeline golden (`packages/test-kit/goldens/fastapi-app.graph.txt`,
// produced by `repository-intelligence/src/graph-goldens.test.ts`); these are the degradations
// that must stay visible.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-fastapi',
  analysisRunId: 'run-fastapi',
  createdAt: '2026-08-02T09:00:00.000Z',
};

/**
 * A single-file `CodeGraph` over one adapter fragment. Every case below is one file, so name
 * resolution is purely local — no cross-file assembly is involved, and deliberately so: these
 * tests pin the ADAPTER's behavior, not the assembler's.
 */
const singleFileGraph = (fragment: GraphFragment): CodeGraph => ({
  nodes: fragment.nodes,
  edges: fragment.edges,
  decorators: fragment.decorators,
  callFacts: fragment.callFacts,
  symbolReferences: fragment.symbolReferences,
  resolveSymbol: (filePath, name) => {
    const nodeId = `symbol:${filePath}#${name}`;
    return fragment.nodes.some((node) => String(node.id) === nodeId) ? nodeId : undefined;
  },
  importsOf: (filePath) =>
    fragment.imports.filter((reference) => reference.fromFilePath === filePath),
});

const assemble = async (files: readonly RepositoryFile[]): Promise<{ graph: CodeGraph }> => ({
  graph: singleFileGraph(await createPythonAdapter().indexFiles(files, CONTEXT)),
});

const enrich = (graph: CodeGraph): Promise<GraphFragment> =>
  createFastApiAdapter().enrich(graph, {
    indexing: CONTEXT,
    detection: { detected: true, evidenceIds: [], reason: 'test' },
  });

describe('FastAPI adapter (PRD §15.2, §31)', () => {
  it('reports a non-detection with the reason it checked', async () => {
    const assembled = await assemble([
      { relativePath: 'app/plain.py', content: 'def f():\n    return 1\n' },
    ]);
    const detection = await createFastApiAdapter().detect(assembled.graph);
    expect(detection).toEqual({
      detected: false,
      evidenceIds: [],
      reason: 'no FastAPI application or router construction found',
    });
  });

  it('cites the construction sites and fastapi/pydantic imports it detected on', async () => {
    const assembled = await assemble([
      {
        relativePath: 'app/main.py',
        content: 'from fastapi import FastAPI\n\napp = FastAPI()\n',
      },
    ]);
    const detection = await createFastApiAdapter().detect(assembled.graph);
    expect(detection.detected).toBe(true);
    expect(detection.reason).toContain('1 sites');
    expect(detection.evidenceIds.length).toBeGreaterThanOrEqual(2);
  });

  it('warns instead of guessing when a mounted router cannot be resolved', async () => {
    const assembled = await assemble([
      {
        relativePath: 'app/main.py',
        content: [
          'from fastapi import FastAPI',
          'from vendor.pkg import router as vendor_router',
          '',
          'app = FastAPI()',
          'app.include_router(vendor_router, prefix="/vendor")',
        ].join('\n'),
      },
    ]);
    const fragment = await enrich(assembled.graph);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      "include_router('vendor_router') could not be resolved",
    );
    expect(fragment.edges.filter((edge) => edge.type === 'CONTAINS')).toEqual([]);
  });

  it('says so when class-base facts are unavailable rather than silently skipping models', async () => {
    const assembled = await assemble([
      {
        relativePath: 'app/models.py',
        content:
          'from pydantic import BaseModel\nfrom fastapi import APIRouter\n\nrouter = APIRouter()\n\n\nclass Deal(BaseModel):\n    id: str\n',
      },
    ]);
    // An assembler that does not carry class-base facts through simply omits the field.
    const withoutBases: CodeGraph = {
      nodes: assembled.graph.nodes,
      edges: assembled.graph.edges,
      decorators: assembled.graph.decorators,
      callFacts: assembled.graph.callFacts,
      resolveSymbol: assembled.graph.resolveSymbol,
      importsOf: assembled.graph.importsOf,
    };
    const fragment = await enrich(withoutBases);
    expect(fragment.warnings.map((warning) => warning.message).join(' ')).toContain(
      'Pydantic models not enriched',
    );
    expect(fragment.nodes.filter((node) => node.type === 'schema')).toEqual([]);
  });

  it('emits only PRD §12 vocabulary with framework-convention provenance', async () => {
    const assembled = await assemble([
      {
        relativePath: 'app/main.py',
        content: [
          'from fastapi import BackgroundTasks, FastAPI',
          'from pydantic import BaseModel',
          '',
          'app = FastAPI()',
          '',
          '',
          'class Deal(BaseModel):',
          '    id: str',
          '',
          '',
          'def notify() -> None:',
          '    pass',
          '',
          '',
          '@app.get("/deals")',
          'def list_deals(tasks: BackgroundTasks):',
          '    tasks.add_task(notify)',
          '    return []',
        ].join('\n'),
      },
    ]);
    const fragment = await enrich(assembled.graph);
    const types = fragment.nodes.map((node) => `${node.category}/${node.type}`).sort();
    expect(types).toEqual([
      'application/api-endpoint',
      'application/application',
      'application/job',
      'data/schema',
    ]);
    expect(fragment.nodes.every((n) => n.knowledge.provenance === 'framework-convention')).toBe(
      true,
    );
    expect(fragment.edges.every((e) => e.knowledge.provenance === 'framework-convention')).toBe(
      true,
    );
    expect(fragment.edges.map((edge) => edge.type).sort()).toEqual([
      'CONTAINS',
      'EXPOSES',
      'EXPOSES',
      'TRIGGERS',
      'TRIGGERS',
    ]);
  });
});
