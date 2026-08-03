import { defineConfig } from 'vitest/config';

// Analyzer fixture repos and LOC-checker fixtures contain intentionally weird code —
// never collect tests from them.
const sharedExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/coverage/**',
  '**/.vscode-test/**',
  '**/fixtures/**',
];

// Vitest 3 projects — one project per test suite in docs/engineering/testing-strategy.md.
// All root scripts run with --passWithNoTests: product source does not exist yet and the
// setup must be green on day one (only the `quality` project has tests today).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/domain/**/*.test.ts'],
          exclude: sharedExclude,
        },
      },
      {
        test: {
          name: 'application',
          environment: 'node',
          include: ['packages/application/**/*.test.ts'],
          exclude: sharedExclude,
        },
      },
      {
        test: {
          name: 'contract',
          environment: 'node',
          include: ['packages/contracts/**/*.test.ts'],
          exclude: sharedExclude,
        },
      },
      {
        test: {
          name: 'analyzers',
          environment: 'node',
          include: [
            'packages/{repository-intelligence,language-adapters,framework-adapters,git,persistence,ai-inference,workspace-engine}/**/*.test.ts',
          ],
          exclude: sharedExclude,
        },
      },
      {
        // React + Cytoscape UI (ADR-0005). `root` points at the extension package so `jsdom`
        // and `react` resolve from its own node_modules.
        root: 'apps/vscode-extension',
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'webview',
          environment: 'jsdom',
          include: ['webview/**/*.test.{ts,tsx}'],
          exclude: sharedExclude,
        },
      },
      {
        test: {
          name: 'cli',
          environment: 'node',
          include: ['apps/cli/**/*.test.ts', 'apps/mcp-server/**/*.test.ts'],
          exclude: sharedExclude,
        },
      },
      {
        // Extension-host units that need no Electron: pure tree/report mapping only.
        // src/test/** is the @vscode/test-electron lane (`pnpm test:integration:vscode`) — it
        // imports `vscode` and only runs inside a real extension host, never under Vitest.
        test: {
          name: 'extension',
          environment: 'node',
          include: ['apps/vscode-extension/src/**/*.test.ts'],
          exclude: [...sharedExclude, 'apps/vscode-extension/src/test/**'],
        },
      },
      {
        test: {
          name: 'quality',
          environment: 'node',
          // test-kit joins the tooling lane: it is test infrastructure, not product code, and it
          // was previously covered by NO project — its own modules could not be tested at all.
          include: ['scripts/quality/**/*.test.ts', 'packages/test-kit/**/*.test.ts'],
          exclude: sharedExclude,
        },
      },
    ],
  },
});
