import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cliAnalyzeOutputSchema,
  cliArchitectureOutputSchema,
  cliIndexOutputSchema,
  cliStatusOutputSchema,
  cliVersionOutputSchema,
  EXIT_CODES,
} from '@impactgraph/contracts';
import { fixtureRepoPath } from '@impactgraph/test-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from './run-cli.js';

interface CliRun {
  readonly code: number;
  readonly lines: string[];
  readonly json: () => unknown;
}

describe('impactgraph CLI (Stories 4.1 + 4.2)', () => {
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
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-cli-'));
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

  it('init scaffolds .impactgraph/ with config and cache .gitignore (§16)', async () => {
    const first = await cli('init');
    expect(first.code).toBe(EXIT_CODES.success);
    expect(existsSync(join(repoDir, '.impactgraph/config.yml'))).toBe(true);
    expect(readFileSync(join(repoDir, '.impactgraph/.gitignore'), 'utf8')).toContain('cache/');

    const second = await cli('init', '--format', 'json');
    expect(second.code).toBe(EXIT_CODES.success);
    expect(second.json()).toMatchObject({ command: 'init', alreadyInitialized: true, created: [] });
  });

  it('index refuses to run before init with the configuration-error exit code', async () => {
    const result = await cli('index');
    expect(result.code).toBe(EXIT_CODES.configurationError);
  });

  it('index builds the graph; a clean re-run reuses the same immutable snapshot', async () => {
    await cli('init');
    // Commit the scaffold so the tree is clean — a dirty tree gets a unique snapshot id.
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init impactgraph'], { cwd: repoDir });
    const first = await cli('index', '--format', 'json');
    expect(first.code).toBe(EXIT_CODES.success);
    const output = cliIndexOutputSchema.parse(first.json());
    expect(output.nodeCount).toBeGreaterThan(10);
    expect(output.snapshot.branch).toBe('main');
    expect(output.snapshot.dirtyWorkingTree).toBe(false);

    const second = await cli('index', '--format', 'json');
    const reRun = cliIndexOutputSchema.parse(second.json());
    expect(reRun.snapshot.id).toBe(output.snapshot.id);
    expect(reRun.changedFileCount).toBe(0);
    expect(reRun.reusedFileCount).toBe(reRun.fileCount);
  });

  it('status reports the current generation with validated JSON output', async () => {
    await cli('init');
    const before = await cli('status', '--format', 'json');
    expect(cliStatusOutputSchema.parse(before.json())).toMatchObject({
      initialized: true,
      indexed: false,
    });

    await cli('index');
    const after = await cli('status', '--format', 'json');
    const status = cliStatusOutputSchema.parse(after.json());
    expect(status.indexed).toBe(true);
    expect(status.counts?.nodes).toBeGreaterThan(10);
    expect(after.code).toBe(EXIT_CODES.success);
  });

  it('status states freshness, categorized warnings, limitations and the producing build (item 9)', async () => {
    await cli('init');
    await cli('index');
    const result = await cli('status', '--format', 'json');
    const status = cliStatusOutputSchema.parse(result.json());
    // Freshness is derived at read time and stated by the tool, never judged by the caller.
    expect(status.freshness).toBeDefined();
    expect(typeof status.freshness?.stale).toBe('boolean');
    // The categorized report agrees with the run summary about the same fact (GAP 3).
    expect(status.indexWarnings?.totalCount).toBe(
      (status.lastRun?.warningCount ?? -1) + (status.ignoredCount ?? -1),
    );
    expect(status.limitations?.some((line) => line.includes('repositor'))).toBe(true);
    // Which build produced this answer — read from package.json, never hardcoded.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(status.server).toEqual({ name: 'impactgraph', version: manifest.version });

    const text = await cli('status');
    expect(text.lines.some((line) => line.startsWith('freshness:'))).toBe(true);
    expect(text.lines.some((line) => line.startsWith('limitation:'))).toBe(true);
  });

  it('version prints which build produced the answer, as text and validated JSON', async () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    const text = await cli('version');
    expect(text.code).toBe(EXIT_CODES.success);
    expect(text.lines).toEqual([`impactgraph ${manifest.version}`]);

    const viaFlag = await cli('--version');
    expect(viaFlag.code).toBe(EXIT_CODES.success);
    expect(viaFlag.lines).toEqual([`impactgraph ${manifest.version}`]);

    const json = await cli('version', '--format', 'json');
    expect(cliVersionOutputSchema.parse(json.json())).toEqual({
      schemaVersion: 1,
      command: 'version',
      name: 'impactgraph',
      version: manifest.version,
    });
  });

  it('architecture summarizes packages and graph composition (§20 JSON graph export)', async () => {
    await cli('init');
    await cli('index');
    const result = await cli('architecture', '--format', 'json');
    expect(result.code).toBe(EXIT_CODES.success);
    const summary = cliArchitectureOutputSchema.parse(result.json());
    expect(summary.packages.map((p) => p.name)).toContain('ts-basic');
    expect(summary.nodeCountsByType['class']).toBeGreaterThanOrEqual(3);
    expect(summary.edgeCountsByType['IMPORTS']).toBeGreaterThanOrEqual(4);

    const text = await cli('architecture');
    expect(text.lines.some((line) => line.includes('ts-basic'))).toBe(true);
  });

  it('architecture before index fails with the configuration-error exit code', async () => {
    await cli('init');
    const result = await cli('architecture');
    expect(result.code).toBe(EXIT_CODES.configurationError);
  });

  it('a non-git folder is an unsupported project (§20)', async () => {
    rmSync(join(repoDir, '.git'), { recursive: true, force: true });
    await cli('init');
    const result = await cli('index', '--format', 'json');
    expect(result.code).toBe(EXIT_CODES.unsupportedProject);
    expect(result.json()).toMatchObject({ error: { category: 'unsupportedProject' } });
  });

  it('config prints the resolved configuration', async () => {
    await cli('init');
    const result = await cli('config', '--format', 'json');
    expect(result.code).toBe(EXIT_CODES.success);
    expect(result.json()).toMatchObject({
      command: 'config',
      initialized: true,
      config: { schemaVersion: 1 },
    });
  });

  it('analyze produces an evidence-backed §46 impact report from a Markdown spec', async () => {
    await cli('init');
    await cli('index');
    writeFileSync(
      join(repoDir, 'feature.md'),
      '# Deal filtering\nDealService must filter expired deals from search results.\n',
    );
    const result = await cli('analyze', 'feature.md', '--full', '--format', 'json');
    expect(result.code).toBe(EXIT_CODES.success);
    const output = cliAnalyzeOutputSchema.parse(result.json());

    expect(output.specification.extractionMode).toBe('deterministic-fallback');
    expect(output.requirements).toHaveLength(1);
    const impacts = output.requirements[0]?.impacts ?? [];

    const direct = impacts.find((impact) => impact.name === 'DealService');
    expect(direct?.likelihood).toBe('required');
    expect(direct?.directness).toBe('direct');
    expect(direct?.evidenceFiles).toContain('src/services/deal-service.ts');

    // §46 acceptance: a relevant dependency NOT named in the specification is surfaced.
    const inherited = impacts.find((impact) => impact.name === 'BaseService');
    expect(inherited).toBeDefined();
    expect(inherited?.likelihood).toBe('likely');
    expect(inherited?.dependencyPath.length).toBeGreaterThan(1);

    // Every impact is graph-derived and evidence-backed.
    for (const impact of impacts) {
      expect(impact.dependencyPath.length).toBeGreaterThan(0);
    }

    const text = await cli('analyze', 'feature.md', '--full');
    expect(text.lines).toContain('Requirement R1');
    expect(text.lines.some((line) => line.startsWith('Required:'))).toBe(true);
    expect(text.lines.some((line) => line.startsWith('Evidence:'))).toBe(true);
  });

  it('analyze reuses the stored spec version when the file is unchanged', async () => {
    await cli('init');
    await cli('index');
    writeFileSync(join(repoDir, 'feature.md'), 'DealRepository must expose a count method.\n');
    const first = await cli('analyze', 'feature.md', '--full', '--format', 'json');
    const second = await cli('analyze', 'feature.md', '--full', '--format', 'json');
    const firstOut = cliAnalyzeOutputSchema.parse(first.json());
    const secondOut = cliAnalyzeOutputSchema.parse(second.json());
    expect(secondOut.specification.extractionMode).toBe('unchanged');
    expect(secondOut.specification.version).toBe(firstOut.specification.version);
    expect(secondOut.analysis.id).not.toBe(firstOut.analysis.id);
  });

  it('analyze fails cleanly without an index, a spec argument, or the spec file', async () => {
    await cli('init');
    const noIndex = await cli('analyze', 'feature.md');
    expect(noIndex.code).toBe(EXIT_CODES.configurationError);

    await cli('index');
    const noArg = await cli('analyze');
    expect(noArg.code).toBe(EXIT_CODES.configurationError);
    const missing = await cli('analyze', 'ghost.md');
    expect(missing.code).toBe(EXIT_CODES.configurationError);
  });

  it('unknown commands and bad flags exit with configuration errors and usage help', async () => {
    const unknown = await cli('frobnicate');
    expect(unknown.code).toBe(EXIT_CODES.configurationError);

    const badFlag = await cli('status', '--format', 'yaml');
    expect(badFlag.code).toBe(EXIT_CODES.configurationError);
    expect(badFlag.lines.some((line) => line.startsWith('Usage:'))).toBe(true);
  });
});
