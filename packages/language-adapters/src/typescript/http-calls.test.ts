import { describe, expect, it } from 'vitest';

import { createTypeScriptAdapter } from './typescript-adapter.js';

import type { CallFact, GraphFragment, IndexingContext } from '../types.js';

// Epic-16 Story 16.6 last open task — `fetch('/api/deals')` feeding route correlation. The end of
// the chain is pinned by `packages/test-kit/goldens/cross-stack.graph.txt`; this suite pins the
// fact shape the cross-stack adapter depends on, and everything that must NOT become a fact.

const CONTEXT: IndexingContext = {
  repositorySnapshotId: 'snap-http',
  analysisRunId: 'run-http',
  createdAt: '2026-08-02T09:00:00.000Z',
};

const index = (content: string, relativePath = 'src/api.ts'): Promise<GraphFragment> =>
  createTypeScriptAdapter().indexFiles([{ relativePath, content }], CONTEXT);

const httpFacts = (fragment: GraphFragment): readonly CallFact[] =>
  fragment.callFacts.filter((fact) => fact.receiverName === 'http:client');

describe('TypeScript fetch() URL facts (Story 16.6)', () => {
  it('records a literal URL with the declaration that contains the call', async () => {
    const fragment = await index(`export async function loadDeals(): Promise<unknown> {
  const response = await fetch('/api/deals');
  return response.json();
}
`);
    expect(
      httpFacts(fragment).map((fact) => [
        fact.calleeName,
        fact.stringArguments[0],
        fact.enclosingSymbolNodeId,
      ]),
    ).toEqual([['fetch', '/api/deals', 'symbol:src/api.ts#loadDeals']]);
  });

  it('records a nested call against the nearest declared owner, and a module-level one against the file', async () => {
    const fragment = await index(`void fetch('/api/health');

export function wire(): void {
  setTimeout(() => {
    void fetch('/api/deals');
  }, 0);
}
`);
    expect(
      httpFacts(fragment)
        .map((fact) => fact.enclosingSymbolNodeId)
        .sort(),
    ).toEqual(['file:src/api.ts', 'symbol:src/api.ts#wire']);
  });

  it('never records a URL the file does not state literally', async () => {
    const fragment = await index(`const base = '/api';
export async function load(id: string): Promise<unknown> {
  await fetch(\`/api/deals/\${id}\`); // interpolated — a shape, not a path
  await fetch(base + '/deals'); // computed
  await fetch(); // no argument at all
  return null;
}
`);
    expect(httpFacts(fragment)).toEqual([]);
  });

  it('carries evidence that exists in the same fragment', async () => {
    const fragment = await index(`export function load(): void {
  void fetch('/api/deals');
}
`);
    const evidenceIds = new Set<string>(fragment.evidence.map((record) => record.id));
    expect(httpFacts(fragment).length).toBe(1);
    expect(httpFacts(fragment).every((fact) => evidenceIds.has(fact.evidenceId))).toBe(true);
  });
});

// epic-16: import-bound clients. The claim being tested is narrow and exact — the IMPORT proves
// the callee is an HTTP client. Nothing here resolves a type.
describe('TypeScript import-bound HTTP clients (axios, $fetch)', () => {
  const shapes = (fragment: GraphFragment): unknown[] =>
    httpFacts(fragment).map((fact) => [
      fact.calleeName,
      fact.stringArguments[0],
      fact.keywordStringArguments?.['method'],
    ]);

  it('records axios verb methods with the verb the method name states', async () => {
    const fragment = await index(`import axios from 'axios';
export async function crud(): Promise<void> {
  await axios.get('/api/deals');
  await axios.post('/api/deals', { name: 'x' });
  await axios.delete('/api/deals/1');
}
`);
    expect(shapes(fragment)).toEqual([
      ['axios.get', '/api/deals', 'GET'],
      ['axios.post', '/api/deals', 'POST'],
      ['axios.delete', '/api/deals/1', 'DELETE'],
    ]);
  });

  it('follows an axios.create() instance, which is provably still axios', async () => {
    const fragment = await index(`import axios from 'axios';
const api = axios.create({ baseURL: '/' });
export const load = () => api.get('/api/deals');
`);
    expect(shapes(fragment)).toEqual([['api.get', '/api/deals', 'GET']]);
  });

  it('records $fetch and ofetch imported from ofetch, with a literal method only', async () => {
    const fragment = await index(`import { $fetch } from 'ofetch';
import { ofetch } from 'ofetch';
export async function go(verb: string): Promise<void> {
  await $fetch('/api/deals', { method: 'post' });
  await ofetch('/api/deals');
  await $fetch('/api/deals', { method: verb });
}
`);
    expect(shapes(fragment)).toEqual([
      ['$fetch', '/api/deals', 'POST'],
      ['ofetch', '/api/deals', undefined],
      ['$fetch', '/api/deals', undefined],
    ]);
  });

  it('binds a CommonJS require of axios the same way the import binds', async () => {
    const fragment = await index(`const axios = require('axios');
module.exports.load = () => axios.get('/api/deals');
`);
    expect(shapes(fragment)).toEqual([['axios.get', '/api/deals', 'GET']]);
  });

  it('leaves a wrapped client undetected — the import proves origin, not protocol', async () => {
    const fragment = await index(`import { apiClient } from './lib/api-client.js';
import { get } from './lib/helpers.js';
export async function load(): Promise<void> {
  await apiClient.get('/api/deals');
  await get('/api/deals');
}
`);
    expect(httpFacts(fragment)).toEqual([]);
  });

  it('never matches an axios-shaped name that no import bound', async () => {
    const fragment = await index(`const axios = { get: (_u: string) => undefined };
const $fetch = (_u: string) => undefined;
export function load(): void {
  axios.get('/api/deals');
  $fetch('/api/deals');
}
`);
    expect(httpFacts(fragment)).toEqual([]);
  });

  it('never matches a look-alike module or a computed require specifier', async () => {
    const fragment = await index(`import axios from './vendor/axios.js';
const other = require(process.env['MOD']);
export function load(): void {
  axios.get('/api/deals');
  other.get('/api/deals');
}
`);
    expect(httpFacts(fragment)).toEqual([]);
  });

  // §42.5 — every key here comes from untrusted repository text.
  it('does not resolve a prototype-named method through a bound client', async () => {
    const fragment = await index(`import axios from 'axios';
export function load(): void {
  void axios.constructor('/api/deals');
  void axios.toString('/api/deals');
  void axios.__proto__.get('/api/deals');
}
`);
    expect(httpFacts(fragment)).toEqual([]);
  });
});
