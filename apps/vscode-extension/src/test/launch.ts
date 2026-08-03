import { spawn } from 'node:child_process';

// `runTests()` from @vscode/test-electron hard-codes `--disable-workspace-trust` into every
// launch (runTest.js), so the untrusted lane cannot go through it: the workspace would always be
// trusted and PRD §35 restricted-mode behavior would never be exercised. That lane therefore
// spawns the downloaded executable directly, with the same base arguments runTests uses minus
// the trust override. The trusted lane keeps using runTests — no reason to reimplement it twice.

/** The launch flags @vscode/test-electron applies to every run, minus the trust override. */
const BASE_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
  '--no-cached-data',
];

export const launchWithWorkspaceTrust = (options: {
  readonly executable: string;
  readonly extensionDevelopmentPath: string;
  readonly extensionTestsPath: string;
  readonly launchArgs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      options.executable,
      [
        ...options.launchArgs,
        ...BASE_ARGS,
        `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
        `--extensionTestsPath=${options.extensionTestsPath}`,
      ],
      { env: { ...process.env, ...options.env }, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`VS Code exited with code ${String(code)}`));
    });
  });
