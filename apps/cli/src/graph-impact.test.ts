import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cliAnalyzeOutputSchema, cliGraphOutputSchema, EXIT_CODES } from '@impactgraph/contracts';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

// `impactgraph graph --analysis <id>` end to end: analyze a specification, then render its blast
// radius as one self-contained local HTML file.
//
// The privacy assertions from the architecture export are re-run HERE, over the impact document,
// because this is the file with far more in it: requirement prose, explanations, dependency paths
// and confidence signals. That is exactly the surface where source text or a remote reference could
// slip in unnoticed (CLAUDE.md rule 5, PRD §35).
//
// What these tests deliberately do NOT assert: how many impacts the engine produces, or what any
// confidence value is. Confidence weighting and traversal are mid-review; pinning a number here
// would pin the wrong thing. The assertions are on STRUCTURE — that whatever the engine produced is
// attributed, hop-counted, provenance-marked and completely accounted for.

/** Source text from the ts-basic fixture. None of it may ever appear in the export. */
const FIXTURE_SOURCE_TEXT = [
  'export function',
  'export class DealService',
  'extends BaseService',
  'this.repository.findAll()',
  'deal.includes(term)',
  'DEFAULT_LIMIT',
];

describe('impactgraph graph --analysis (impact export, PRD §18.4/§18.5/§33/§35)', () => {
  let repoDir: string;
  let analysisId = '';
  let html = '';

  const cli = async (...args: string[]): Promise<{ code: number; lines: string[] }> => {
    const lines: string[] = [];
    const code = await runCli([...args, '--root', repoDir], {
      defaultRoot: repoDir,
      write: (line) => lines.push(line),
    });
    return { code, lines };
  };

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-impact-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    for (const args of [
      ['init', '-b', 'main'],
      ['config', 'user.email', 'cli@test.dev'],
      ['config', 'user.name', 'CLI Test'],
      ['config', 'commit.gpgsign', 'false'],
      ['add', '.'],
      ['commit', '-m', 'fixture'],
    ]) {
      execFileSync('git', args, { cwd: repoDir });
    }
    await cli('init');
    await cli('index');
    writeFileSync(
      join(repoDir, 'feature.md'),
      [
        '# Deal expiry visibility',
        '',
        'DealService must filter expired deals from search results.',
        '',
        'DealRepository must expose a count method.',
        '',
        'A nonexistent QuantumLedger component must be introduced.',
        '',
      ].join('\n'),
    );
    const analyzed = await cli('analyze', 'feature.md', '--full', '--format', 'json');
    // `warningsFound` is expected: the spec deliberately names a component that does not exist, so
    // the analysis raises `unknown-concept` — which is precisely what the export must surface.
    expect([EXIT_CODES.success, EXIT_CODES.warningsFound]).toContain(analyzed.code);
    analysisId = cliAnalyzeOutputSchema.parse(JSON.parse(analyzed.lines.join('\n'))).analysis.id;
    const run = await cli('graph', '--analysis', analysisId);
    expect(run.code).toBe(EXIT_CODES.success);
    html = readFileSync(join(repoDir, 'impactgraph-impact.html'), 'utf8');
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('writes its own default file, so the two views never overwrite each other', async () => {
    const run = await cli('graph', '--analysis', analysisId);
    expect(run.code).toBe(EXIT_CODES.success);
    expect(run.lines[0]).toMatch(/^wrote impactgraph-impact\.html \([\d.]+ KiB\)$/);
    expect(existsSync(join(repoDir, 'impactgraph-impact.html'))).toBe(true);
    // and the architecture export still lands on its own filename, unchanged
    await cli('graph');
    expect(existsSync(join(repoDir, 'impactgraph-graph.html'))).toBe(true);
  });

  it('reports the analysis, the likelihood spread and the coverage gap in the terminal', async () => {
    const run = await cli('graph', '--analysis', analysisId);
    const text = run.lines.join('\n');
    expect(text).toContain(`analysis: ${analysisId} (draft)`);
    expect(text).toMatch(/impacts: \d+ on \d+ components — required \d+, likely \d+/);
    expect(text).toMatch(/reach: \d+ direct, \d+ indirect up to \d+ hops/);
    expect(text).toMatch(/requirements: \d+ of \d+ produced impacts/);
  });

  it('references nothing remote: no URL, no script, no external asset', () => {
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('//');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<img|<iframe|<object|<embed|<use\b/i);
    expect(html).not.toMatch(/@import|@font-face/i);
    expect(html).not.toMatch(/javascript:|data:/i);
    // no inline event handlers — the export is not merely script-src-free, it is script-free
    expect(html).not.toMatch(/<[^>]+\son(?:click|load|error|mouseover|focus)\s*=/i);
    // every url(...) is a same-document fragment reference to an inline SVG marker
    for (const reference of html.match(/url\([^)]*\)/g) ?? []) {
      expect(reference).toMatch(/^url\(#[a-z-]+\)$/);
    }
  });

  it('contains no source content, no evidence identifier and no absolute path', () => {
    for (const snippet of FIXTURE_SOURCE_TEXT) {
      expect(html, `source text leaked: ${snippet}`).not.toContain(snippet);
    }
    expect(html).not.toContain(repoDir);
    expect(html).not.toContain(tmpdir());
    // evidence ids embed line ranges, so only their COUNT is published
    expect(html).not.toMatch(/ev:[a-z-]+:/);
    expect(html).toContain('contains no source code, no evidence text and no remote references');
  });

  it('leads with likelihood, spelled out and metered, never colour alone', () => {
    expect(html).toContain(
      '<h2 id="likelihood-heading">Legend — likelihood, the primary signal</h2>',
    );
    expect(html).toMatch(/(REQUIRED|LIKELY|POSSIBLE|UNLIKELY) [1-4]\/4/);
    expect(html).toContain('class="meter-on"');
    expect(html).toMatch(/conf \d\.\d\d/);
    // no colour carries meaning anywhere in the document
    expect(html).not.toMatch(/fill="(?!none|currentColor)[^"]*#/);
    expect(html).not.toMatch(/stroke="(?!none|currentColor)[^"]*#/);
  });

  it('keeps provenance readable beside likelihood, without colour', () => {
    expect(html).toContain('>FACT<');
    expect(html).toContain('INFERRED');
    expect(html).toContain('CONFIRMED');
    expect(html).toContain('stroke-dasharray="7 5"');
    expect(html).toMatch(/class="node-shape" x="\d+" y="\d+" width="232" height="92" rx="0"/);
  });

  it('attributes every impact to a requirement and states its hop count', () => {
    expect(html).toContain('<h2 id="requirements-heading">Requirements</h2>');
    expect(html).toContain('DealService must filter expired deals from search results.');
    // the requirement no repository component can satisfy is named, not omitted
    expect(html).toContain('QuantumLedger');
    expect(html).toContain('Confidence signals (§14)');
    expect(html).toMatch(/(direct|indirect) · \d+ hops?/);
  });

  it('carries the whole diagram in text as well (§37 tree parity)', () => {
    expect(html).toContain('Skip the diagram and read the tables');
    for (const heading of [
      'requirements-heading',
      'groups-heading',
      'edges-heading',
      'impacts-heading',
    ]) {
      expect(html).toContain(`<h2 id="${heading}">`);
    }
    expect(html).toContain('role="img" aria-labelledby="diagram-title diagram-desc"');
    expect(html).toContain('Impact diagram: components a specification is predicted to touch');
  });

  it('states the budget and accounts for every impact, drawn or not', () => {
    expect(html).toMatch(/Showing \d+ of \d+ components across \d+ of \d+ context groups/);
    expect(html).toMatch(/\d+ impacts are direct concept matches/);
  });

  it('re-exporting an unchanged analysis is byte-identical', async () => {
    await cli('graph', '--analysis', analysisId, '--out', 'again.html');
    expect(readFileSync(join(repoDir, 'again.html'), 'utf8')).toBe(html);
  });

  it('emits the same view as contract-validated JSON without writing a file', async () => {
    const run = await cli('graph', '--analysis', analysisId, '--format', 'json');
    expect(run.code).toBe(EXIT_CODES.success);
    const output = cliGraphOutputSchema.parse(JSON.parse(run.lines.join('\n')));
    expect(output.view.kind).toBe('impact');
    expect(output.writtenPath).toBeUndefined();
    const facts = output.view.impact;
    if (facts === undefined) {
      throw new Error('an impact view must carry its §18.5 payload');
    }
    expect(facts.analysisId).toBe(analysisId);
    expect(facts.impacts.length).toBe(facts.totals.impactCount);
    // requirement attribution covers the whole specification, not only what matched
    expect(facts.requirements.length).toBeGreaterThanOrEqual(3);
    const attributed = new Set(facts.requirements.map((entry) => entry.id));
    for (const impact of facts.impacts) {
      // every impact carries its §14 signals and a hop count derived from its own path
      expect(impact.signals.length).toBeGreaterThan(0);
      expect(impact.dependencyPath.length).toBeGreaterThan(0);
      expect(impact.hops).toBe(impact.dependencyPath.length - 1);
      expect(attributed.has(impact.requirementId)).toBe(true);
    }
  });

  it('supports the §18.4 grouping alternatives for the impact view too', async () => {
    for (const grouping of ['context', 'application', 'package'] as const) {
      const run = await cli(
        'graph',
        '--analysis',
        analysisId,
        '--group',
        grouping,
        '--format',
        'json',
      );
      const output = cliGraphOutputSchema.parse(JSON.parse(run.lines.join('\n')));
      expect(output.view.grouping).toBe(grouping);
      expect(output.view.kind).toBe('impact');
    }
  });

  it('fails on an unknown analysis id by naming the ids that would have worked', async () => {
    const run = await cli('graph', '--analysis', 'analysis-does-not-exist');
    expect(run.code).toBe(EXIT_CODES.configurationError);
    const text = run.lines.join('\n');
    expect(text).toContain("analysis not found: 'analysis-does-not-exist'");
    expect(text).toContain('available:');
    expect(text).toContain(analysisId);
  });

  it('rejects an empty --analysis rather than silently rendering the architecture', async () => {
    const run = await cli('graph', '--analysis');
    expect(run.code).toBe(EXIT_CODES.configurationError);
    expect(run.lines.join('\n')).toContain('--analysis expects an analysis id');
  });

  it('without --analysis behaves exactly as before: the architecture view', async () => {
    const run = await cli('graph', '--format', 'json');
    const output = cliGraphOutputSchema.parse(JSON.parse(run.lines.join('\n')));
    expect(output.view.kind).toBe('architecture');
    expect(output.view.impact).toBeUndefined();
    // and no edge carries a proposed status in a pure architecture document
    expect(output.view.edges.every((edge) => edge.status === undefined)).toBe(true);
  });
});
