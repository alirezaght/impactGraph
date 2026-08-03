// Builds the @vscode/test-electron harness (Story 17.4, PRD §42.4).
//
// The extension bundles to CJS with esbuild and never runs `tsc` emit, so the tests follow the
// same path: three CJS bundles under dist/test/. `dist/test/package.json` pins commonjs so Node
// (and the extension host's `require` of --extensionTestsPath) reads the emitted .js as CJS even
// though apps/vscode-extension is an ESM package.
import { mkdirSync, writeFileSync } from 'node:fs';

import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'warning',
};

// The runner is plain Node: `vscode` is never in scope, and @vscode/test-electron stays external
// so it resolves from the extension's own node_modules.
await build({
  ...shared,
  entryPoints: ['src/test/runner.ts'],
  outfile: 'dist/test/runner.js',
  external: ['@vscode/test-electron'],
});

// Suite bundles run inside the extension host: `vscode` is host-provided, better-sqlite3 native.
for (const entry of ['index', 'untrusted']) {
  await build({
    ...shared,
    entryPoints: [`src/test/suite/${entry}.ts`],
    outfile: `dist/test/suite/${entry}.js`,
    external: ['vscode', 'better-sqlite3'],
  });
}

mkdirSync('dist/test', { recursive: true });
writeFileSync('dist/test/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
