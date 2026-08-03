import { performance } from 'node:perf_hooks';

// A deliberately tiny suite runner. @vscode/test-electron only requires that the module named by
// --extensionTestsPath exports `run(): Promise<void>` and that the promise rejects on failure —
// the runner itself is our choice, and a ~90-line registry buys that without adding Mocha (and
// its @types) to the dependency tree for a single lane. Assertions are node:assert/strict.

export interface IntegrationTest {
  readonly name: string;
  readonly run: () => Promise<void> | void;
}

export interface IntegrationSuite {
  readonly name: string;
  readonly tests: readonly IntegrationTest[];
}

export interface RunSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: readonly string[];
  readonly failures: readonly string[];
}

/**
 * A skip is a reported outcome, never a silent pass: every skip prints its reason and is listed
 * again in the summary, so "green because everything was skipped" is impossible to miss.
 */
export class SkippedTest extends Error {
  public constructor(reason: string) {
    super(reason);
    this.name = 'SkippedTest';
  }
}

/** Explicitly typed so TypeScript treats a `skipTest(...)` call as never-returning. */
export const skipTest: (reason: string) => never = (reason) => {
  throw new SkippedTest(reason);
};

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const withTimeout = async (test: IntegrationTest, timeoutMs: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`test exceeded ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve(test.run()), guard]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

interface Mutable {
  passed: number;
  failed: number;
  readonly skipped: string[];
  readonly failures: string[];
}

const runTest = async (
  suite: IntegrationSuite,
  test: IntegrationTest,
  timeoutMs: number,
  totals: Mutable,
): Promise<void> => {
  const started = performance.now();
  const took = (): string => `${(performance.now() - started).toFixed(0)} ms`;
  try {
    await withTimeout(test, timeoutMs);
    totals.passed += 1;
    write(`  PASS ${test.name} (${took()})`);
  } catch (error) {
    if (error instanceof SkippedTest) {
      const entry = `${suite.name} › ${test.name} — ${error.message}`;
      totals.skipped.push(entry);
      write(`  SKIP ${test.name} — ${error.message}`);
      return;
    }
    totals.failed += 1;
    totals.failures.push(`${suite.name} › ${test.name}\n${String(error)}`);
    write(`  FAIL ${test.name} (${took()})\n${String(error)}`);
  }
};

const printSummary = (summary: RunSummary): void => {
  write(
    `\n${String(summary.passed)} passed, ${String(summary.failed)} failed, ` +
      `${String(summary.skipped.length)} skipped`,
  );
  for (const skipped of summary.skipped) {
    write(`  SKIPPED: ${skipped}`);
  }
  for (const failure of summary.failures) {
    write(`\n--- FAILURE ---\n${failure}`);
  }
};

/** Runs the suites in order (they share one window and one workspace) and reports the tally. */
export const runSuites = async (
  suites: readonly IntegrationSuite[],
  timeoutMs = 120_000,
): Promise<RunSummary> => {
  const totals: Mutable = { passed: 0, failed: 0, skipped: [], failures: [] };
  for (const suite of suites) {
    write(`\n${suite.name}`);
    for (const test of suite.tests) {
      await runTest(suite, test, timeoutMs, totals);
    }
  }
  const summary: RunSummary = { ...totals };
  printSummary(summary);
  return summary;
};

/** Turns a summary into the `run()` contract: reject when anything failed. */
export const assertGreen = (summary: RunSummary): void => {
  if (summary.failed > 0) {
    throw new Error(`${String(summary.failed)} VS Code integration test(s) failed`);
  }
};
