import { readFileSync } from 'node:fs';

import { expect } from 'vitest';

import type { CallTool, CallToolError } from './registry-flows.js';

// §18.6/§21 — `export_graph_html` through the tool boundary, which is the path an agent actually
// uses. The privacy invariants are re-asserted HERE and not only in the CLI suite: an agent will
// hand this file to a human, and a file that quietly phoned home or embedded source would defeat
// the product's premise (CLAUDE.md rule 5).

/** Source text from the ts-basic fixture. None of it may appear in the exported file. */
const FIXTURE_SOURCE_TEXT = ['export function', 'export class', 'return ', 'import {'];

/** Every privacy invariant, re-asserted over whichever document the tool just wrote. */
const expectSelfContained = (html: string, byteSize: unknown): void => {
  // byteSize is the file size in UTF-8 bytes, not the JS string length (§, ×, — are multi-byte)
  expect(Buffer.byteLength(html, 'utf8')).toBe(byteSize);
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
};

/**
 * §18.4/§18.5 through the tool boundary: the same tool, a second view. An agent handing a human a
 * blast-radius report must not be able to overstate it, so the tool returns the coverage numbers and
 * the document itself must carry likelihood in words and every impact in a table.
 */
const expectImpactExport = async (
  tool: CallTool,
  toolError: CallToolError,
  analysisId: string,
): Promise<void> => {
  const written = await tool('export_graph_html', { analysisId, path: 'reports/impact.html' });
  expect(written['view']).toBe('impact');
  expect(written['analysisId']).toBe(analysisId);
  expect(written['impacts']).toEqual(expect.any(Number));
  // the coverage gap is reported, so an agent cannot present a partial analysis as complete
  expect(written['requirementsTotal']).toEqual(expect.any(Number));
  expect(written['requirementsWithoutImpacts']).toEqual(expect.any(Number));
  expect(written['snapshotMatchesAnalysis']).toEqual(expect.any(Boolean));

  const html = readFileSync(written['path'] as string, 'utf8');
  expectSelfContained(html, written['byteSize']);
  // likelihood reads without colour, and provenance is still a separate reading
  expect(html).toMatch(/(REQUIRED|LIKELY|POSSIBLE|UNLIKELY) [1-4]\/4/);
  expect(html).toContain('class="meter-on"');
  expect(html).toContain('Legend — likelihood, the primary signal');
  // requirement attribution, hop counts and the §14 signals are all present
  expect(html).toContain('<h2 id="requirements-heading">Requirements</h2>');
  expect(html).toContain('Confidence signals (§14)');
  expect(html).toMatch(/(direct|indirect) · \d+ hops?/);
  // evidence identifiers embed line ranges and are never published — only their count
  expect(html).not.toMatch(/ev:[a-z-]+:/);

  // an unknown id names the ids that would have worked rather than failing blankly
  const unknown = await toolError('export_graph_html', { analysisId: 'analysis-nope' });
  expect(unknown).toContain("analysis not found: 'analysis-nope'");
  expect(unknown).toContain(analysisId);
  // and the write is still confined to the workspace on the impact path too
  expect(await toolError('export_graph_html', { analysisId, path: '../escaped.html' })).toContain(
    'refusing to write outside the workspace',
  );
};

export const expectGraphHtmlExport = async (
  tool: CallTool,
  toolError: CallToolError,
  analysisId: string,
): Promise<void> => {
  const written = await tool('export_graph_html', { path: 'reports/architecture.html' });
  expect(written['path']).toMatch(/reports[/\\]architecture\.html$/);
  expect(written['byteSize']).toEqual(expect.any(Number));
  expect(written['view']).toBe('architecture');
  expect(written['grouping']).toBe('context');
  expect(written['maxVisibleNodes']).toBe(200);
  // real counts, so the agent can report what it produced without reading the file back
  expect(written['groups']).toBeGreaterThan(0);
  expect(written['nodesTotal']).toBeGreaterThanOrEqual(written['nodesShown'] as number);
  expect(written['architectureNodes']).toBeGreaterThanOrEqual(written['nodesShown'] as number);

  expectSelfContained(readFileSync(written['path'] as string, 'utf8'), written['byteSize']);

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

  // the SAME tool, the second view — §18.4/§18.5 rather than a forty-first tool
  await expectImpactExport(tool, toolError, analysisId);
};
