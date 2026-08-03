import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

import { createFixtureWorkspace, createScratchDir } from './fixture-workspace.js';
import { launchWithWorkspaceTrust } from './launch.js';

// Story 17.4 entry point (`pnpm test:integration:vscode`). Downloads/launches VS Code twice:
// once trusted (the nine PRD §42.4 areas) and once with workspace trust left ON, so the §35
// restricted-mode behavior is exercised for real rather than asserted from a unit test.

/**
 * dist/test/runner.js → apps/vscode-extension. `__dirname` (not `import.meta.url`) because
 * esbuild emits this bundle as CJS, where `import.meta` is empty — see src/test/build.mjs.
 */
const extensionDevelopmentPath = resolve(__dirname, '..', '..');
const repoRoot = resolve(extensionDevelopmentPath, '..', '..');
const fixtureDir = join(repoRoot, 'packages', 'test-kit', 'fixtures', 'ts-basic');

/** A launch never blocks on GPU or the sandbox in a headless CI container. */
const platformArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];

interface Lane {
  readonly label: string;
  readonly suite: string;
  /** false → VS Code decides trust itself, which is the point of the untrusted lane. */
  readonly forceTrust: boolean;
}

const LANES: readonly Lane[] = [
  { label: 'trusted', suite: 'index', forceTrust: true },
  { label: 'untrusted', suite: 'untrusted', forceTrust: false },
];

const launchArgs = (lane: Lane, dirs: LaneDirs): string[] => [
  dirs.workspace,
  '--disable-extensions',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-updates',
  '--user-data-dir',
  dirs.userData,
  '--extensions-dir',
  dirs.extensions,
  ...(lane.forceTrust ? ['--disable-workspace-trust'] : []),
  ...platformArgs,
];

type LaneDirs = Record<'workspace' | 'userData' | 'extensions', string>;

const suitePath = (lane: Lane): string =>
  join(extensionDevelopmentPath, 'dist', 'test', 'suite', `${lane.suite}.js`);

const launchLane = async (lane: Lane, dirs: LaneDirs): Promise<void> => {
  const env = { IMPACTGRAPH_TEST_LANE: lane.label };
  if (lane.forceTrust) {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath: suitePath(lane),
      launchArgs: launchArgs(lane, dirs),
      extensionTestsEnv: env,
    });
    return;
  }
  // runTests() always injects --disable-workspace-trust, so this lane spawns the executable
  // itself — see launch.ts.
  await launchWithWorkspaceTrust({
    executable: await downloadAndUnzipVSCode(),
    extensionDevelopmentPath,
    extensionTestsPath: suitePath(lane),
    launchArgs: launchArgs(lane, dirs),
    env,
  });
};

const runLane = async (lane: Lane): Promise<void> => {
  const dirs: LaneDirs = {
    workspace: createFixtureWorkspace(fixtureDir, `ws-${lane.label}`),
    userData: createScratchDir(`user-${lane.label}`),
    extensions: createScratchDir(`ext-${lane.label}`),
  };
  process.stdout.write(`\n=== VS Code integration lane: ${lane.label} ===\n`);
  process.stdout.write(`    workspace: ${dirs.workspace}\n`);
  try {
    await launchLane(lane, dirs);
  } finally {
    for (const dir of Object.values(dirs)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
};

/**
 * Both lanes always run: they cover different behavior (§42.4 vs §35 restricted mode), and a
 * failure in one must not hide the state of the other from whoever reads the CI log.
 */
const main = async (): Promise<void> => {
  const failed: string[] = [];
  for (const lane of LANES) {
    try {
      await runLane(lane);
    } catch (error) {
      failed.push(`${lane.label}: ${String(error)}`);
      process.stderr.write(`\n=== lane '${lane.label}' FAILED ===\n${String(error)}\n`);
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `${String(failed.length)} VS Code integration lane(s) failed:\n${failed.join('\n')}`,
    );
  }
  process.stdout.write('\nVS Code integration lanes passed.\n');
};

// A hung Electron launch must fail the job, not occupy a CI runner until the workflow timeout.
const watchdog = setTimeout(
  () => {
    process.stderr.write('\nVS Code integration lane exceeded 20 minutes — aborting.\n');
    process.exit(1);
  },
  20 * 60 * 1000,
);
watchdog.unref();

main().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    process.stderr.write(`\nVS Code integration lane failed: ${String(error)}\n`);
    process.exit(1);
  },
);
