import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  analysisGoldenPath,
  CROSS_STACK_EVALUATIONS,
  fixtureRepoPath,
  reviewGoldenPath,
  serializeAnalysisGolden,
  serializeReviewGolden,
} from '@impactgraph/test-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveAnalysis } from './decisions.js';
import { performIndexRun } from './indexing.js';
import { runReviewPipeline } from './review.js';
import { buildAnalysisForSpecification, submitSpecification } from './specifications.js';
import { initializeWorkspace } from './workspace.js';

import type { ImplementationReview } from '@impactgraph/domain';
import type { ImpactAnalysis, KnowledgeGraph, NodeId } from '@impactgraph/domain';
import type { GoldenImpact } from '@impactgraph/test-kit';

// Story 16.7 / PRD §C16 — the OTHER half of cross-stack analysis.
//
// `repository-intelligence/src/graph-goldens.test.ts` proves the graph: one Astro + FastAPI +
// Spring + Terraform repository becomes one graph, with a single `topic:deal-events` node that
// three languages publish to. That is necessary and not sufficient. §C12 asks for a system that
// REASONS across stacks, so this suite runs the real pipeline end to end on the same fixture and
// pins what it concludes:
//
//   1. an impact analysis of a specification written about the Python API must reach the Terraform
//      Cloud Run service and the TypeScript client that calls it;
//   2. a review of a diff that touches three stacks must produce findings in three stacks.
//
// Both are pinned as goldens the same way `analysis-goldens.test.ts` pins the ts-basic ones, and
// both are ALSO asserted against hand-written cross-stack ground truth — a golden proves the
// output has not changed, only ground truth proves it was ever right.
//
// Regenerate deliberately, and only this fixture:
//   UPDATE_GOLDENS=cross-stack pnpm test:analyzers cross-stack-goldens

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const FIXTURE = 'cross-stack';

/** UPDATE_GOLDENS: unset = compare; `cross-stack` (comma-separated) = rewrite; `1`/`all` = all. */
const shouldUpdate = (): boolean => {
  const flag = process.env['UPDATE_GOLDENS'];
  if (flag === undefined || flag.length === 0) {
    return false;
  }
  return flag === '1' || flag === 'all' || flag.split(',').some((e) => e.trim() === FIXTURE);
};

const compareOrWrite = (serialized: string, path: string, what: string): void => {
  if (shouldUpdate()) {
    writeFileSync(path, serialized);
    return;
  }
  expect(
    existsSync(path),
    `missing golden ${path} — regenerate with UPDATE_GOLDENS=${FIXTURE}`,
  ).toBe(true);
  expect(
    serialized,
    `${what} golden drift — if intended, regenerate JUST THIS FIXTURE with ` +
      `UPDATE_GOLDENS=${FIXTURE} and justify every changed line`,
  ).toBe(readFileSync(path, 'utf8'));
};

const goldenFor = (analysis: ImpactAnalysis, graph: KnowledgeGraph): string => {
  const impacts: GoldenImpact[] = analysis.requirementImpacts.map((impact) => ({
    requirementId: impact.requirementId,
    nodeName: graph.nodes.get(impact.nodeId as NodeId)?.name ?? impact.nodeId,
    likelihood: impact.likelihood,
    impactType: impact.impactType,
    directness: impact.directness,
    confidence: impact.confidence,
    signalTypes: impact.confidenceSignals.map((signal) => signal.type),
  }));
  return serializeAnalysisGolden({
    impacts,
    warningCodes: analysis.warnings.map((warning) => warning.code),
  });
};

const reviewGolden = (review: ImplementationReview): string =>
  serializeReviewGolden({
    findings: review.findings.map((finding) => ({
      category: finding.category,
      nodeName: finding.nodeName,
      nodeId: finding.nodeId,
      requirementId: finding.requirementId,
    })),
    coverage: review.coverage.map((item) => ({
      requirementId: item.requirementId,
      status: item.status,
    })),
  });

interface Analyzed {
  readonly serialized: string;
  readonly names: ReadonlySet<string>;
}

/** Which stack a changed file belongs to, by extension — the crudest possible honest test. */
const STACK_BY_EXTENSION = new Map<string, string>([
  ['.py', 'python'],
  ['.ts', 'typescript'],
  ['.astro', 'astro'],
  ['.java', 'java'],
  ['.tf', 'terraform'],
]);

const stackOf = (filePath: string): string | undefined =>
  STACK_BY_EXTENSION.get(filePath.slice(filePath.lastIndexOf('.')));

describe('cross-stack impact and review on the cross-stack fixture (PRD §C16)', () => {
  let repoDir: string;
  let firstAnalysisId: string | undefined;
  const analyzed = new Map<string, Analyzed>();

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'impactgraph-cross-stack-'));
    cpSync(fixtureRepoPath(FIXTURE), repoDir, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repoDir });
    };
    git('init', '-b', 'main');
    git('config', 'user.email', 'goldens@test.dev');
    git('config', 'user.name', 'Goldens');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'fixture');
    const initialized = initializeWorkspace(repoDir);
    if (!initialized.ok) {
      throw new Error(initialized.error.message);
    }
    git('add', '.');
    git('commit', '-m', 'init impactgraph');
    const indexed = await performIndexRun(repoDir);
    if (!indexed.ok) {
      throw new Error(indexed.failure.message);
    }
    for (const sample of CROSS_STACK_EVALUATIONS) {
      const submitted = await submitSpecification({
        rootDir: repoDir,
        specName: sample.specFileName,
        rawText: sample.specText,
      });
      if (!submitted.ok) {
        throw new Error(`${sample.name}: ${submitted.error.message}`);
      }
      const built = await buildAnalysisForSpecification(repoDir, submitted.value.specification);
      if (!built.ok) {
        throw new Error(`${sample.name}: ${built.error.message}`);
      }
      const { analysis, graph } = built.value;
      analyzed.set(sample.name, {
        serialized: goldenFor(analysis, graph),
        names: new Set(
          analysis.requirementImpacts.map(
            (impact) => graph.nodes.get(impact.nodeId as NodeId)?.name ?? impact.nodeId,
          ),
        ),
      });
      firstAnalysisId ??= analysis.id;
    }
  }, 180_000);

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  for (const sample of CROSS_STACK_EVALUATIONS) {
    it(`'${sample.name}' matches its committed impact golden`, () => {
      const actual = analyzed.get(sample.name);
      expect(actual).toBeDefined();
      compareOrWrite(
        actual?.serialized ?? '',
        analysisGoldenPath(FIXTURE, slug(sample.name)),
        `cross-stack impact for '${sample.name}'`,
      );
    });

    it(`'${sample.name}' surfaces the components the specification names`, () => {
      const names = analyzed.get(sample.name)?.names ?? new Set<string>();
      for (const expected of sample.groundTruth.directImpacts) {
        expect([...names], `ground-truth direct impact '${expected}' missing`).toContain(expected);
      }
    });

    it(`'${sample.name}' reaches across the stack boundary (§C12, §C16)`, () => {
      const names = analyzed.get(sample.name)?.names ?? new Set<string>();
      // The whole point of the fixture: the specification text names ONE stack, and the analysis
      // has to reach the others. A per-stack loop so a failure says WHICH boundary was not crossed.
      for (const [stack, expectedNames] of Object.entries(sample.crossStackNames)) {
        for (const expected of expectedNames) {
          expect(
            [...names],
            `analysis did not reach the ${stack} stack — '${expected}' is missing`,
          ).toContain(expected);
        }
      }
    });

    it(`'${sample.name}' still does not reach its documented gaps`, () => {
      const names = analyzed.get(sample.name)?.names ?? new Set<string>();
      for (const absent of sample.unreachedNames ?? []) {
        expect(
          [...names],
          `'${absent}' is now reached — good, but delete the documented gap in ` +
            'packages/test-kit/src/evaluation.ts deliberately rather than widening it silently',
        ).not.toContain(absent);
      }
    });
  }

  it('a review of a diff touching three stacks reports findings in three stacks (§C16)', async () => {
    expect(firstAnalysisId).toBeDefined();
    const approved = await approveAnalysis(repoDir, firstAnalysisId ?? '');
    expect(approved.ok).toBe(true);

    // One change per stack, deliberately mixing predicted and unpredicted work:
    // Python (the endpoint the approved analysis is about), TypeScript (its front-end caller),
    // Java (a publisher the analysis never mentioned) and Terraform (the infrastructure).
    appendFileSync(
      join(repoDir, 'api/app/main.py'),
      '\n\n@app.get("/api/deals/{deal_id}/expiry")\ndef deal_expiry(deal_id: str) -> dict[str, str]:\n    return {"expiresAt": "2030-01-01"}\n',
    );
    appendFileSync(
      join(repoDir, 'web/src/lib/api.ts'),
      '\nexport async function loadExpiry(): Promise<unknown> {\n  const response = await fetch("/api/deals/expiry");\n  return response.json();\n}\n',
    );
    // Java has no append point — a new method goes before the class's closing brace.
    const javaPath = join(repoDir, 'service/src/main/java/com/example/deals/DealEventBridge.java');
    const java = readFileSync(javaPath, 'utf8');
    writeFileSync(
      javaPath,
      `${java.slice(0, java.lastIndexOf('}'))}
    public void publishExpiry(String payload) {
        pubSubTemplate.publish("deal-expiry", payload);
    }
}
`,
    );
    writeFileSync(
      join(repoDir, 'infra/expiry.tf'),
      'resource "google_pubsub_topic" "deal_expiry" {\n  name = "deal-expiry"\n}\n',
    );

    const reviewed = await runReviewPipeline(repoDir, 'working-tree');
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) {
      return;
    }
    const serialized = reviewGolden(reviewed.value.review);
    compareOrWrite(serialized, reviewGoldenPath(FIXTURE, 'working-tree'), 'cross-stack review');

    // The claim under test: the findings are not confined to one language. A review that only
    // ever reports the stack the specification was written in is the failure §C16 exists to catch.
    const stacksTouched = new Set(
      reviewed.value.review.findings.flatMap((finding) => finding.filePaths.map(stackOf)),
    );
    stacksTouched.delete(undefined);
    expect([...stacksTouched].sort()).toContain('python');
    expect([...stacksTouched].sort()).toContain('terraform');
    expect(
      stacksTouched.size,
      `review findings only covered ${[...stacksTouched].sort().join(', ')}`,
    ).toBeGreaterThanOrEqual(3);
  }, 180_000);
});
