import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cliAnalyzeOutputSchema, cliExportOutputSchema, EXIT_CODES } from '@impactgraph/contracts';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

interface CliRun {
  readonly code: number;
  readonly lines: string[];
  readonly json: () => unknown;
}

// Story 10.2 — export the §22 implementation context after the approval gate.

describe('impactgraph export (Stories 10.1/10.2/4.4, PRD §22/§38.1)', () => {
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

  const analyzeSpec = async (): Promise<string> => {
    await cli('init');
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
    writeFileSync(
      join(repoDir, 'feature.md'),
      '# Deal filtering\nDealService must filter expired deals from search results.\n',
    );
    git('add', '.');
    git('commit', '-m', 'init impactgraph + spec');
    await cli('index');
    const analyzed = await cli('analyze', 'feature.md', '--format', 'json');
    return cliAnalyzeOutputSchema.parse(analyzed.json()).analysis.id;
  };

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-export-'));
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

  it('refuses to export before approval — the human gate is never bypassed (§40.3)', async () => {
    const analysisId = await analyzeSpec();
    const byId = await cli('export', analysisId);
    expect(byId.code).toBe(EXIT_CODES.configurationError);
    const latest = await cli('export');
    expect(latest.code).toBe(EXIT_CODES.configurationError);
    const ghost = await cli('export', 'analysis-ghost');
    expect(ghost.code).toBe(EXIT_CODES.configurationError);
  });

  it('exports the schema-valid §22 context with constraints and review criteria', async () => {
    const analysisId = await analyzeSpec();
    await cli('approve', analysisId);

    const result = await cli('export', '--format', 'json');
    expect(result.code).toBe(EXIT_CODES.success);
    const output = cliExportOutputSchema.parse(result.json());
    const context = output.context;

    expect(context.approvedAnalysis['id']).toBe(analysisId);
    expect(context.requiredImpacts.map((impact) => impact.name)).toContain('DealService');
    expect(context.repositorySnapshot.branch).toBe('main');
    expect(context.architectureConstraints.map((rule) => rule.id)).toContain(
      'schema-needs-migration',
    );
    const kinds = context.reviewCriteria.map((criterion) => criterion.kind);
    expect(kinds).toContain('required-impact');
    expect(kinds).toContain('architecture-rule');
    // an existing test covering a required impact becomes an expectation
    expect(context.expectedTests.map((test) => test.path)).toContain(
      'src/services/deal-service.test.ts',
    );
  });

  it('renders all 18 §38.1 markdown sections in order', async () => {
    const analysisId = await analyzeSpec();
    await cli('approve', analysisId);

    const result = await cli('export', analysisId, '--format', 'markdown');
    expect(result.code).toBe(EXIT_CODES.success);
    const report = result.lines.join('\n');
    const sections = [
      '## 1. Specification Summary',
      '## 2. Extracted Requirements',
      '## 3. Open Questions',
      '## 4. Affected Contexts',
      '## 5. Required Impacts',
      '## 6. Likely Impacts',
      '## 7. Possible Impacts',
      '## 8. Data and Migration Impact',
      '## 9. API Impact',
      '## 10. Event and Messaging Impact',
      '## 11. Infrastructure Impact',
      '## 12. Security Impact',
      '## 13. Test Expectations',
      '## 14. Architectural Alternatives',
      '## 15. Risks',
      '## 16. User Decisions',
      '## 17. Evidence',
      '## 18. Repository Snapshot',
    ];
    let lastIndex = -1;
    for (const section of sections) {
      const index = report.indexOf(section);
      expect(index, `missing section: ${section}`).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
    expect(report).toContain('DealService');
    expect(report).toContain('estimate');

    const text = await cli('export', analysisId);
    expect(text.lines[0]).toContain('Implementation context');
  });
});
