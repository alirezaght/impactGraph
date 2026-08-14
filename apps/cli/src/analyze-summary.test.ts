import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cliImpactSummarySchema, EXIT_CODES } from '@impactgraph/contracts';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

// Item 9 of the trial follow-up: `impactgraph analyze` returns a BOUNDED summary by default. The
// previous default was the complete impact document, which on a real repository ran to hundreds of
// kilobytes — too large for an agent to read, so the tool's answer had to be written to a file and
// grepped. These tests pin the new default's SHAPE, its self-stated limits, and its size.

interface CliRun {
  readonly code: number;
  readonly lines: string[];
  readonly json: () => unknown;
}

describe('impactgraph analyze — the bounded summary (item 9)', () => {
  let repoDir: string;

  const cli = async (...args: string[]): Promise<CliRun> => {
    const lines: string[] = [];
    const code = await runCli([...args, '--root', repoDir], {
      defaultRoot: repoDir,
      write: (line) => lines.push(line),
    });
    return { code, lines, json: () => JSON.parse(lines.join('\n')) as unknown };
  };

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-summary-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'cli@test.dev');
    git('config', 'user.name', 'CLI Test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  // Item 9 of the trial follow-up: the DEFAULT output is the bounded summary. It leads with
  // whether the result can be trusted, and it stays small enough to read.
  it('analyze defaults to a bounded summary that states its own limitations', async () => {
    await cli('init');
    await cli('index');
    writeFileSync(
      join(repoDir, 'feature.md'),
      '# Deal filtering\n\n## Requirements\n\nR1: `DealService` must filter expired deals from search results.\n',
    );
    const json = await cli('analyze', 'feature.md', '--format', 'json');
    expect(json.code).toBe(EXIT_CODES.success);
    const summary = cliImpactSummarySchema.parse(json.json());
    // the author's own requirement list was respected (item 1)
    expect(summary.specification.extractionQuality?.strategy).toBe('structured');
    expect(summary.specification.readiness).toBeDefined();
    // Item 10: writing the spec file left the tree dirty relative to the index, and the summary
    // says so rather than presenting the analysis as current. This is the active staleness warning.
    expect(summary.freshness.stale).toBe(true);
    expect(summary.analysis.provisionalReasons.join(' ')).toContain('uncommitted changes');
    expect(summary.freshness.recommendedAction).toContain('impactgraph index');
    // the finding is present, with its basis (item 3)
    const top = summary.topImpacts.find((impact) => impact.name === 'DealService');
    expect(top?.likelihood).toBe('required');
    expect(top?.evidenceType).toBe('direct-structural');
    expect(top?.requirementLabels).toContain('R1');
    // ADR-0017 §5: the CLI runs the SAME coverage+preflight pass as the MCP server, so the summary
    // carries the plan assessment, the completeness statement, and per-impact provenance — and the
    // spec named `DealService` verbatim, so its impact is a confirmation, never a discovery.
    expect(summary.planAssessment).toBeDefined();
    expect(summary.evidenceIndependence?.statement).toContain('impacts');
    expect(summary.suppliedIdentifiers).toBeDefined();
    expect(top?.evidenceProvenance).toBe('USER_SUPPLIED');
    expect(top?.provenanceLabel).toBe('confirmation');
    // freshness and query scope are always stated (items 10, 11)
    expect(summary.freshness.state.length).toBeGreaterThan(0);
    expect(summary.impactQuery.scope).toContain('snapshot');
    expect(summary.impactQuery.limitations.length).toBeGreaterThan(0);
    // and it is bounded
    expect(JSON.stringify(summary).length).toBeLessThan(20_000);

    const text = await cli('analyze', 'feature.md');
    expect(text.lines.some((line) => line.startsWith('Top structural impacts'))).toBe(true);
    expect(text.lines.some((line) => line.startsWith('Scope:'))).toBe(true);
  });

  it('analyze honours --top, --min-likelihood and --include-lexical', async () => {
    await cli('init');
    await cli('index');
    writeFileSync(
      join(repoDir, 'feature.md'),
      '## Requirements\n\nR1: `DealService` must filter expired deals.\n',
    );
    const narrow = cliImpactSummarySchema.parse(
      (
        await cli(
          'analyze',
          'feature.md',
          '--format',
          'json',
          '--top',
          '2',
          '--min-likelihood',
          'required',
        )
      ).json(),
    );
    expect(narrow.topImpacts.length).toBeLessThanOrEqual(2);
    expect(narrow.topImpacts.every((impact) => impact.likelihood === 'required')).toBe(true);
    expect(narrow.pagination.appliedFilters.topN).toBe(2);

    const wide = cliImpactSummarySchema.parse(
      (await cli('analyze', 'feature.md', '--format', 'json', '--include-lexical')).json(),
    );
    expect(wide.pagination.appliedFilters.includeLexicalOnly).toBe(true);
    expect(wide.impactQuery.limitations.join(' ')).not.toContain(
      'Lexical-only matches were excluded',
    );
  });
});
