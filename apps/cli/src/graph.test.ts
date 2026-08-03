import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cliGraphOutputSchema, EXIT_CODES } from '@impactgraph/contracts';
import { fixtureRepoPath, shouldUpdateGolden } from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

// `impactgraph graph` — the CLI-only visual surface (no VS Code, no extension host).
//
// The assertions below are the point of the feature, not decoration:
//   * PRIVACY — the file must reference nothing remote and contain no source text, because it is
//     something a user might attach to a ticket (CLAUDE.md rule 5, PRD §35).
//   * BUDGET  — §33 caps a first paint at 200 nodes and truncation must be stated, never silent.
//   * GOLDEN  — the layout is deterministic, so drift is a reviewed diff.

const GOLDEN_SCOPE = 'graph-export';
const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'goldens',
  'graph-export.monorepo.html.txt',
);

/** Source text from the monorepo fixture. None of it may ever appear in the export. */
const FIXTURE_SOURCE_TEXT = [
  'export function',
  'deal.expiresAt < now',
  'deals.filter',
  'toISOString',
  'Cross-PACKAGE import',
  'export interface Deal',
];

describe('impactgraph graph (self-contained HTML export, PRD §18.6/§33/§35)', () => {
  let repoDir: string;
  let html = '';
  let snapshotId = '';

  const cli = async (...args: string[]): Promise<{ code: number; lines: string[] }> => {
    const lines: string[] = [];
    const code = await runCli([...args, '--root', repoDir], {
      defaultRoot: repoDir,
      write: (line) => lines.push(line),
    });
    return { code, lines };
  };

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-graph-'));
    cpSync(fixtureRepoPath('monorepo'), repoDir, { recursive: true });
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
    const run = await cli('graph');
    expect(run.code).toBe(EXIT_CODES.success);
    html = readFileSync(join(repoDir, 'impactgraph-graph.html'), 'utf8');
    const json = await cli('graph', '--format', 'json');
    snapshotId = cliGraphOutputSchema.parse(JSON.parse(json.lines.join('\n'))).view.snapshotId;
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('defaults to ./impactgraph-graph.html and reports what it wrote', async () => {
    const run = await cli('graph');
    expect(run.code).toBe(EXIT_CODES.success);
    expect(run.lines[0]).toMatch(/^wrote impactgraph-graph\.html \([\d.]+ KiB\)$/);
    expect(run.lines.join('\n')).toContain('no scripts, no network, no source code');
    expect(existsSync(join(repoDir, 'impactgraph-graph.html'))).toBe(true);
  });

  it('honours --out and creates missing parent directories', async () => {
    const run = await cli('graph', '--out', join('reports', 'arch.html'));
    expect(run.code).toBe(EXIT_CODES.success);
    expect(existsSync(join(repoDir, 'reports', 'arch.html'))).toBe(true);
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

  it('contains no source content and no absolute path', () => {
    for (const snippet of FIXTURE_SOURCE_TEXT) {
      expect(html, `source text leaked: ${snippet}`).not.toContain(snippet);
    }
    expect(html).not.toContain(repoDir);
    expect(html).not.toContain(tmpdir());
    expect(html).toContain('contains no source code, no evidence text and no remote references');
  });

  it('distinguishes the three knowledge categories without relying on colour', () => {
    // text badge (§37: a label beside every visual encoding)
    expect(html).toContain('>FACT<');
    expect(html).toContain('INFERRED');
    expect(html).toContain('CONFIRMED');
    // shape + stroke channels, all three defined and distinct
    expect(html).toContain('stroke-dasharray="7 5"');
    expect(html).toContain('class="node-shape inner"');
    expect(html).toMatch(/class="node-shape" x="\d+" y="\d+" width="\d+" height="\d+" rx="0"/);
    // arrowhead shape per category, plus a marker-end on every drawn relationship
    for (const marker of ['arrow-fact', 'arrow-inferred', 'arrow-confirmed']) {
      expect(html).toContain(`<marker id="legend-${marker}"`);
    }
    expect(html).toContain('marker-end="url(#arrow-fact)"');
  });

  it('carries the whole diagram in text as well (§37 tree parity)', () => {
    expect(html).toContain('Skip the diagram and read the tables');
    expect(html).toContain('<h2 id="groups-heading">Groups</h2>');
    expect(html).toContain('<h2 id="edges-heading">Relationships</h2>');
    expect(html).toContain('<h2 id="nodes-heading">Component nodes</h2>');
    expect(html).toContain('role="img" aria-labelledby="diagram-title diagram-desc"');
  });

  it('states the node budget and never truncates silently', () => {
    expect(html).toMatch(/Showing \d+ of \d+ architecture-level nodes/);
    expect(html).toMatch(/relationships cross a group boundary and are aggregated into/);
    expect(html).toMatch(/CONTAINS edges already expressed by the boxes/);
  });

  it('re-exporting an unchanged graph is byte-identical', async () => {
    await cli('graph', '--out', 'again.html');
    expect(readFileSync(join(repoDir, 'again.html'), 'utf8')).toBe(html);
  });

  it('emits the same view as contract-validated JSON without writing a file', async () => {
    const run = await cli('graph', '--format', 'json');
    expect(run.code).toBe(EXIT_CODES.success);
    const output = cliGraphOutputSchema.parse(JSON.parse(run.lines.join('\n')));
    expect(output.command).toBe('graph');
    expect(output.writtenPath).toBeUndefined();
    expect(output.view.grouping).toBe('context');
    expect(output.view.groups.length).toBeGreaterThan(1);
    expect(output.view.edges.length).toBeGreaterThan(0);
    expect(output.view.budget.maxVisibleNodes).toBe(200);
    // aggregation keeps one knowledge category per arrow (§3)
    for (const edge of output.view.edges) {
      expect(edge.count).toBe(edge.kinds.reduce((total, kind) => total + kind.count, 0));
    }
  });

  it('supports the §18.4 grouping alternatives and rejects anything else', async () => {
    for (const grouping of ['context', 'application', 'package'] as const) {
      const run = await cli('graph', '--group', grouping, '--format', 'json');
      const output = cliGraphOutputSchema.parse(JSON.parse(run.lines.join('\n')));
      expect(output.view.grouping).toBe(grouping);
      expect(output.view.groups.length).toBeGreaterThan(0);
    }
    const bad = await cli('graph', '--group', 'sideways');
    expect(bad.code).toBe(EXIT_CODES.configurationError);
  });

  it('requires an index rather than producing an empty picture', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'impactgraph-graph-bare-'));
    try {
      const lines: string[] = [];
      const code = await runCli(['graph', '--root', bare], {
        defaultRoot: bare,
        write: (line) => lines.push(line),
      });
      expect(code).toBe(EXIT_CODES.configurationError);
      expect(lines.join('\n')).toContain('run `impactgraph index` first');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  // Layout drift is a reviewed diff: UPDATE_GOLDENS=graph-export pnpm test:cli graph
  it('matches the committed layout golden', () => {
    const normalized = html.replaceAll(snapshotId, 'snap-GOLDEN');
    if (shouldUpdateGolden(GOLDEN_SCOPE)) {
      writeFileSync(goldenPath, normalized);
    }
    expect(normalized).toBe(readFileSync(goldenPath, 'utf8'));
  });
});
