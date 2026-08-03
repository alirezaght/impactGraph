// Bundles the extension host entry and the index-worker entry (Story 7.1/7.2).
// `vscode` is provided by the host; `better-sqlite3` is a native module and stays external.
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'warning',
};

await build({
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  external: ['vscode', 'better-sqlite3'],
});

await build({
  ...shared,
  entryPoints: ['src/index-worker.ts'],
  outfile: 'dist/index-worker.cjs',
  external: ['better-sqlite3'],
});

await build({
  ...shared,
  entryPoints: ['src/engine-worker.ts'],
  outfile: 'dist/engine-worker.cjs',
  external: ['better-sqlite3'],
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
