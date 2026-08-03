import { readFileSync } from 'node:fs';

import { expect } from 'vitest';

import type { CallTool, CallToolError } from './registry-flows.js';

// §18.6/§21 — `export_graph_html` through the tool boundary, which is the path an agent actually
// uses. The privacy invariants are re-asserted HERE and not only in the CLI suite: an agent will
// hand this file to a human, and a file that quietly phoned home or embedded source would defeat
// the product's premise (CLAUDE.md rule 5).

/** Source text from the ts-basic fixture. None of it may appear in the exported file. */
const FIXTURE_SOURCE_TEXT = ['export function', 'export class', 'return ', 'import {'];

export const expectGraphHtmlExport = async (
  tool: CallTool,
  toolError: CallToolError,
): Promise<void> => {
  const written = await tool('export_graph_html', { path: 'reports/architecture.html' });
  expect(written['path']).toMatch(/reports[/\\]architecture\.html$/);
  expect(written['byteSize']).toEqual(expect.any(Number));
  expect(written['grouping']).toBe('context');
  expect(written['maxVisibleNodes']).toBe(200);
  // real counts, so the agent can report what it produced without reading the file back
  expect(written['groups']).toBeGreaterThan(0);
  expect(written['nodesTotal']).toBeGreaterThanOrEqual(written['nodesShown'] as number);
  expect(written['architectureNodes']).toBeGreaterThanOrEqual(written['nodesShown'] as number);

  const html = readFileSync(written['path'] as string, 'utf8');
  // byteSize is the file size in UTF-8 bytes, not the JS string length (§, ×, — are multi-byte)
  expect(Buffer.byteLength(html, 'utf8')).toBe(written['byteSize']);
  expect(html).not.toContain('http://');
  expect(html).not.toContain('https://');
  expect(html).not.toMatch(/<script|<link|<img|<iframe/i);
  expect(html).not.toMatch(/@import|@font-face/i);
  for (const snippet of FIXTURE_SOURCE_TEXT) {
    expect(html, `source text leaked: ${snippet}`).not.toContain(snippet);
  }
  // the three knowledge categories stay distinguishable without colour (§3/§37)
  expect(html).toContain('>FACT<');
  expect(html).toContain('>INFERRED<');
  expect(html).toContain('>CONFIRMED<');
  expect(html).toContain('stroke-dasharray="7 5"');

  // the grouping alternatives are reachable, and the budget is stated rather than applied silently
  const byPackage = await tool('export_graph_html', { group: 'package' });
  expect(byPackage['grouping']).toBe('package');
  expect(byPackage['path']).toMatch(/impactgraph-graph\.html$/);
  expect(readFileSync(byPackage['path'] as string, 'utf8')).toMatch(
    /Showing \d+ of \d+ architecture-level nodes/,
  );

  // an agent cannot steer the write out of the workspace
  expect(await toolError('export_graph_html', { path: '../escaped.html' })).toContain(
    'refusing to write outside the workspace',
  );
  expect(await toolError('export_graph_html', { path: '/tmp/escaped.html' })).toContain(
    'refusing to write outside the workspace',
  );
  expect(await toolError('export_graph_html', { group: 'sideways' })).toContain('invalid input');
};
