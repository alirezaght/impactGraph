import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cliAnalyzeOutputSchema, cliReviewOutputSchema, EXIT_CODES } from '@impactgraph/contracts';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

interface CliRun {
  readonly code: number;
  readonly lines: string[];
  readonly json: () => unknown;
}

// Story 11.4 end-to-end loop: init → index → analyze → approve → change fixture → review.

describe('impactgraph approve + review (Story 11.4, PRD §24/§25/§38.2)', () => {
  let repoDir: string;

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repoDir });
  };

  const cli = async (...args: string[]): Promise<CliRun> => {
    const lines: string[] = [];
    const code = await runCli([...args, '--root', repoDir], {
      defaultRoot: repoDir,
      write: (line) => lines.push(line),
    });
    return { code, lines, json: () => JSON.parse(lines.join('\n')) as unknown };
  };

  /** init → commit → index → analyze the DealService spec → return the analysis id. */
  const analyzeFixtureSpec = async (): Promise<string> => {
    await cli('init');
    writeFileSync(
      join(repoDir, 'feature.md'),
      '# Deal filtering\nDealService must filter expired deals from search results.\n',
    );
    git('add', '.');
    git('commit', '-m', 'init impactgraph + spec');
    await cli('index');
    const analyzed = await cli('analyze', 'feature.md', '--full', '--format', 'json');
    return cliAnalyzeOutputSchema.parse(analyzed.json()).analysis.id;
  };

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-review-'));
    cpSync(fixtureRepoPath('ts-basic'), repoDir, { recursive: true });
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

  it('runs the full loop: approve, implement, review — matched impacts, no discrepancies', async () => {
    const analysisId = await analyzeFixtureSpec();

    // review before approval is a configuration error, not a crash
    const premature = await cli('review');
    expect(premature.code).toBe(EXIT_CODES.configurationError);

    const approved = await cli('approve', analysisId, '--format', 'json');
    expect(approved.code).toBe(EXIT_CODES.success);
    expect(approved.json()).toMatchObject({ command: 'approve', analysisId, status: 'approved' });

    // approval freezes: a second approve is rejected (§40.3)
    const again = await cli('approve', analysisId);
    expect(again.code).toBe(EXIT_CODES.configurationError);

    // "implement" the predicted impact by changing the predicted file
    appendFileSync(
      join(repoDir, 'src/services/deal-service.ts'),
      '\nexport const filterExpired = true;\n',
    );

    const review = await cli('review', 'working-tree', '--format', 'json');
    expect(review.code).toBe(EXIT_CODES.success);
    const output = cliReviewOutputSchema.parse(review.json());
    expect(output.discrepanciesFound).toBe(false);
    expect(output.analysis.id).toBe(analysisId);
    expect(output.changedFiles).toContain('src/services/deal-service.ts');
    const matched = output.findings.filter((finding) => finding.category === 'matched');
    expect(matched.map((finding) => finding.nodeName)).toContain('DealService');
    expect(output.findings.filter((f) => f.category === 'missing')).toHaveLength(0);
    expect(output.coverage[0]?.status).toBe('implemented');
    expect(output.coverage[0]?.evidence.some((line) => line.marker === 'confirmed')).toBe(true);
    // item 7: the review always explains its own confidence and scope
    expect(output.breakdown?.confidence?.reasons.length).toBeGreaterThan(0);
    expect(output.breakdown?.scope.limitations.length).toBeGreaterThan(0);

    const text = await cli('review', 'working-tree');
    const rendered = text.lines.join('\n');
    expect(rendered).toContain('Confidence:');
    expect(rendered).toContain('Limitations:');
  });

  it('reports missing required impacts (unchanged tree) and unexpected files with exit code 3', async () => {
    const analysisId = await analyzeFixtureSpec();
    await cli('approve', analysisId);

    // nothing implemented yet → the required impact is missing (§24.1)
    const unimplemented = await cli('review', 'working-tree', '--format', 'json');
    expect(unimplemented.code).toBe(EXIT_CODES.reviewDiscrepancies);
    const missing = cliReviewOutputSchema.parse(unimplemented.json());
    expect(missing.findings.some((finding) => finding.category === 'missing')).toBe(true);

    // an unpredicted new component surfaces as unexpected — untracked files included (§24.1)
    appendFileSync(
      join(repoDir, 'src/services/deal-service.ts'),
      '\nexport const filterExpired = true;\n',
    );
    writeFileSync(join(repoDir, 'src/rogue.ts'), 'export const rogue = 1;\n');
    const withRogue = await cli('review', 'working-tree', '--format', 'json');
    expect(withRogue.code).toBe(EXIT_CODES.reviewDiscrepancies);
    const output = cliReviewOutputSchema.parse(withRogue.json());
    const unexpected = output.findings.filter((finding) => finding.category === 'unexpected');
    expect(unexpected.some((finding) => finding.filePaths.includes('src/rogue.ts'))).toBe(true);
    // .impactgraph/ internals never count as implementation changes
    expect(output.changedFiles.every((path) => !path.startsWith('.impactgraph/'))).toBe(true);
  });

  it('reviews the current commit and exports the §38.2 markdown report', async () => {
    const analysisId = await analyzeFixtureSpec();
    await cli('approve', analysisId);

    appendFileSync(
      join(repoDir, 'src/services/deal-service.ts'),
      '\nexport const filterExpired = true;\n',
    );
    git('add', '.');
    git('commit', '-m', 'implement deal filtering');

    const commitReview = await cli('review', 'commit', '--format', 'json');
    expect(commitReview.code).toBe(EXIT_CODES.success);
    const output = cliReviewOutputSchema.parse(commitReview.json());
    expect(output.target).toBe('commit');
    expect(output.findings.some((finding) => finding.category === 'matched')).toBe(true);

    const markdown = await cli('review', 'commit', '--format', 'markdown');
    const report = markdown.lines.join('\n');
    for (const section of [
      '# Implementation Review',
      '## Summary',
      '## Approved Specification',
      '## Matched',
      '## Missing',
      '## Unexpected',
      '## Divergent',
      '## Unverifiable',
      '## Accepted Deviations',
      '## Requirement Coverage (estimate — not proof, §25)',
      '## Rule Violations',
      '## Architectural Edge Changes',
      '## Scope and Confidence',
    ]) {
      expect(report).toContain(section);
    }
    expect(report).toContain('✓');
    expect(report).toContain('Confidence: **');
  });

  it('evaluates §27 accompanying-change rules on the review delta (Story 8.4)', async () => {
    const analysisId = await analyzeFixtureSpec();
    await cli('approve', analysisId);
    writeFileSync(
      join(repoDir, '.impactgraph/rules.yml'),
      [
        'schemaVersion: 1',
        'rules:',
        '  - id: schema-needs-migration',
        '    type: accompanying-change',
        '    whenChanged: prisma/schema.prisma',
        '    requireChanged: prisma/migrations/**',
        '',
      ].join('\n'),
    );
    appendFileSync(join(repoDir, 'prisma/schema.prisma'), '\n// add a field\n');

    const violated = await cli('review', 'working-tree', '--format', 'json');
    expect(violated.code).toBe(EXIT_CODES.reviewDiscrepancies);
    const output = cliReviewOutputSchema.parse(violated.json());
    expect(output.ruleViolations.map((violation) => violation.ruleId)).toContain(
      'schema-needs-migration',
    );
    expect(output.ruleViolations[0]?.filePaths).toContain('prisma/schema.prisma');

    // adding the required migration satisfies the rule (the schema change itself stays
    // an Unexpected finding — that is the comparison engine's verdict, not the rule's)
    mkdirSync(join(repoDir, 'prisma/migrations/20260801000000_add_field'), { recursive: true });
    writeFileSync(
      join(repoDir, 'prisma/migrations/20260801000000_add_field/migration.sql'),
      'ALTER TABLE deals ADD COLUMN added INT;\n',
    );
    const satisfied = await cli('review', 'working-tree', '--format', 'json');
    expect(cliReviewOutputSchema.parse(satisfied.json()).ruleViolations).toEqual([]);
  });

  it('feeds aliases.yml into concept matching (Story 8.1, PRD §17)', async () => {
    await cli('init');
    writeFileSync(
      join(repoDir, '.impactgraph/aliases.yml'),
      'schemaVersion: 1\naliases:\n  deal engine: DealService\n',
    );
    writeFileSync(
      join(repoDir, 'alias-feature.md'),
      'The `deal engine` must hide expired deals.\n',
    );
    git('add', '.');
    git('commit', '-m', 'aliases + spec');
    await cli('index');
    const result = await cli('analyze', 'alias-feature.md', '--full', '--format', 'json');
    expect(result.code).toBe(EXIT_CODES.success);
    const output = cliAnalyzeOutputSchema.parse(result.json());
    const names = output.requirements[0]?.impacts.map((impact) => impact.name) ?? [];
    expect(names).toContain('DealService');
  });

  it('rejects an unknown review target and a missing approve argument', async () => {
    await cli('init');
    const badTarget = await cli('review', 'branch-range');
    expect(badTarget.code).toBe(EXIT_CODES.configurationError);
    const noArg = await cli('approve');
    expect(noArg.code).toBe(EXIT_CODES.configurationError);
    const ghost = await cli('approve', 'analysis-ghost');
    expect(ghost.code).toBe(EXIT_CODES.configurationError);
  });
});
