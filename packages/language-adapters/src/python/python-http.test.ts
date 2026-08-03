import { describe, expect, it } from 'vitest';

import { createPythonAdapter } from './python-adapter.js';

import type { CallFact, IndexingContext } from '../types.js';

// epic-16 — Python HTTP-client URL facts. The end of the chain is pinned by
// `packages/test-kit/goldens/fastapi-app.graph.txt`; this suite pins the boundary, which is where
// all the risk lives: a root-relative path in Python resolves against a `base_url`, so recording
// one from a client that was NOT handed this application would manufacture a wrong edge.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-py-http',
  analysisRunId: 'run-py-http',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const factsOf = async (content: string): Promise<readonly CallFact[]> => {
  const fragment = await createPythonAdapter().indexFiles(
    [{ relativePath: 'tests/test_deals.py', content }],
    CONTEXT,
  );
  return fragment.callFacts.filter((fact) => fact.receiverName === 'http:client');
};

const shapes = (facts: readonly CallFact[]): unknown[] =>
  facts.map((fact) => [
    fact.calleeName,
    fact.stringArguments[0],
    fact.keywordStringArguments?.['method'],
    fact.enclosingSymbolNodeId,
  ]);

describe('Python app-bound HTTP-client URL facts', () => {
  it('records a root-relative path through a TestClient handed this application', async () => {
    const facts = await factsOf(`from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_deals() -> None:
    client.get("/deals/")
    client.post("/deals", json={})
`);
    expect(shapes(facts)).toEqual([
      ['client.get', '/deals/', 'GET', 'symbol:tests/test_deals.py#test_list_deals'],
      ['client.post', '/deals', 'POST', 'symbol:tests/test_deals.py#test_list_deals'],
    ]);
  });

  it('records an httpx client handed the app directly, and through an ASGI transport', async () => {
    const facts = await factsOf(`import httpx

from app.main import app

direct = httpx.AsyncClient(app=app)
transport = httpx.ASGITransport(app=app)
routed = httpx.AsyncClient(transport=transport, base_url="http://test")


async def exercise() -> None:
    await direct.get("/deals")
    await routed.delete("/deals/1")
`);
    expect(shapes(facts).map((entry) => (entry as unknown[]).slice(0, 3))).toEqual([
      ['direct.get', '/deals', 'GET'],
      ['routed.delete', '/deals/1', 'DELETE'],
    ]);
  });

  it('records NOTHING for a client whose base_url names another origin', async () => {
    expect(
      await factsOf(`import httpx

registry = httpx.AsyncClient(base_url="https://registry.example.com")


async def load() -> None:
    await registry.get("/deals")
`),
    ).toEqual([]);
  });

  it('records nothing for requests, or for a bare client with no app at all', async () => {
    expect(
      await factsOf(`import httpx
import requests

session = requests.Session()
bare = httpx.Client()


def load() -> None:
    session.get("/deals")
    bare.get("/deals")
    requests.get("/deals")
`),
    ).toEqual([]);
  });

  it('records nothing for an absolute or protocol-relative URL, even app-bound', async () => {
    expect(
      await factsOf(`from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_external() -> None:
    client.get("https://registry.example.com/deals")
    client.get("//registry.example.com/deals")
    client.get("deals")
`),
    ).toEqual([]);
  });

  it('records nothing for a non-literal path — the path is not stated', async () => {
    expect(
      await factsOf(`from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
PATH = "/deals"


def test_computed(suffix: str) -> None:
    client.get(PATH)
    client.get(f"/deals/{suffix}")
`),
    ).toEqual([]);
  });

  it('never binds a local wrapper that merely takes an app= keyword', async () => {
    expect(
      await factsOf(`from app.main import app
from app.testing import TestClient

client = TestClient(app)
wrapper = SomeWrapper(app=app)


def test_lookalike() -> None:
    client.get("/deals")
    wrapper.get("/deals")
`),
    ).toEqual([]);
  });

  // §42.5 — the method name and the path both come from untrusted repository text.
  it('does not resolve a prototype-named method, and keeps a hostile path inert', async () => {
    const facts = await factsOf(`from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_hostile() -> None:
    client.constructor("/deals")
    client.toString("/deals")
    client.get("/../../../../etc/passwd")
    client.get("/__proto__")
`);
    expect(shapes(facts).map((entry) => (entry as unknown[])[1])).toEqual([
      '/../../../../etc/passwd',
      '/__proto__',
    ]);
  });
});
