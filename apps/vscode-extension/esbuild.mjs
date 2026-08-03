// Bundles the extension host entry and the index-worker entry (Story 7.1/7.2).
// `vscode` is provided by the host; `better-sqlite3` is a native module and stays external — but
// external is not the same as absent, so it is vendored into dist/ and the require is rewritten
// to point there (see scripts/vendor-better-sqlite3.mjs for why `dist/vendor`, not node_modules).
import { build } from 'esbuild';

import { vendorBetterSqlite3 } from './scripts/vendor-better-sqlite3.mjs';

// Throws if the prebuilds are missing, so a build cannot quietly produce an unusable .vsix.
vendorBetterSqlite3({ outDir: 'dist/vendor' });

/**
 * Rewrites `require('better-sqlite3')` to the vendored copy, keeping it external so esbuild never
 * tries to bundle a native module. All three node entry points emit directly into `dist/`, so one
 * relative path is correct for every one of them.
 */
const vendorAlias = {
  name: 'vendor-better-sqlite3',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^better-sqlite3$/ }, () => ({
      path: './vendor/better-sqlite3/lib/index.js',
      external: true,
    }));
  },
};

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'warning',
  plugins: [vendorAlias],
};

await build({
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
});

await build({
  ...shared,
  entryPoints: ['src/index-worker.ts'],
  outfile: 'dist/index-worker.cjs',
});

await build({
  ...shared,
  entryPoints: ['src/engine-worker.ts'],
  outfile: 'dist/engine-worker.cjs',
});

// The webview bundle (ADR-0005): a browser IIFE with React + Cytoscape inlined. It is loaded
// through a CSP nonce from dist/webview only — no CDN, no remote font, no dynamic import.
await build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'warning',
  entryPoints: ['webview/index.tsx'],
  outfile: 'dist/webview/webview.js',
  jsx: 'automatic',
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
});

// Ship the generated config JSON Schemas for .impactgraph/ YAML validation (PRD §17).
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/schemas', { recursive: true });
cpSync('../../packages/contracts/schemas/config', 'dist/schemas', { recursive: true });
