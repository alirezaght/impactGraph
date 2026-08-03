// PRD §Z / packaging. The `.vsix` is the only artifact a user ever installs, so what it contains
// is a product invariant, not a build detail. Two rules, both learned from real breakage:
//
//   * the `better-sqlite3` native binding MUST be inside it. It is `external` to the esbuild
//     bundle, and CI packages with `vsce package --no-dependencies`, so nothing pulls it in
//     automatically — an installed extension then fails at `openSqliteIndexStore` with
//     ERR_MODULE_NOT_FOUND and the whole index is unreachable.
//   * test bundles, sourcemaps and TypeScript sources MUST NOT be inside it. They are dead weight
//     in a shipped artifact and sourcemaps expose the full pre-bundle source tree.
//
// This module is the pure predicate over an archive listing; `verify-vsix.ts` supplies the real
// listing. Keeping the rules pure is what lets them be tested without building anything.

/** Every prebuild `better-sqlite3` publishes — one per platform/arch VS Code runs on. */
export const REQUIRED_PREBUILDS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
  'win32-arm64',
  'win32-x64',
] as const;

/** Where the vendored copy lands inside the archive. `vsce` roots everything at `extension/`. */
export const VENDOR_ROOT = 'extension/dist/vendor/better-sqlite3';

export interface VsixViolation {
  readonly rule: 'missing-binding' | 'missing-runtime' | 'forbidden-entry';
  readonly entry: string;
  readonly detail: string;
}

/**
 * Entries that must never ship. Ordered most-specific first so the reported reason is the useful
 * one. `dist/**` is the bundled output and is exempt from the source rules — it IS the product.
 */
const FORBIDDEN: readonly { readonly test: (entry: string) => boolean; readonly why: string }[] = [
  {
    test: (entry) => entry.endsWith('.map'),
    why: 'sourcemap — exposes the pre-bundle source tree',
  },
  {
    test: (entry) => entry.startsWith('extension/src/') || entry.startsWith('extension/webview/'),
    why: 'TypeScript source — the bundle in dist/ is what runs',
  },
  {
    test: (entry) => /\.tsx?$/.test(entry) && !entry.endsWith('.d.ts'),
    why: 'TypeScript source — the bundle in dist/ is what runs',
  },
  {
    test: (entry) => /(^|\/)[^/]*\.test\.[cm]?js$/.test(entry) || entry.includes('/test/'),
    why: 'test bundle — not part of the shipped extension',
  },
  {
    test: (entry) => entry.startsWith('extension/.vscode-test/'),
    why: 'integration-test scaffolding',
  },
];

/**
 * Every way the archive violates the packaging contract. An empty array is the only passing
 * result; the caller reports each violation rather than a single boolean, because "the vsix is
 * wrong" is not an actionable CI failure and "it contains extension/src/extension.ts" is.
 */
export const vsixViolations = (entries: readonly string[]): readonly VsixViolation[] => {
  const violations: VsixViolation[] = [];
  const present = new Set(entries);

  for (const prebuild of REQUIRED_PREBUILDS) {
    const expected = `${VENDOR_ROOT}/prebuilds/${prebuild}.node`;
    if (!present.has(expected)) {
      violations.push({
        rule: 'missing-binding',
        entry: expected,
        detail: `no ${prebuild} native binding — the extension cannot open its SQLite index there`,
      });
    }
  }
  // The prebuilds are useless without the JS that selects one: lib/binding.js resolves
  // `../prebuilds/<platform>-<arch>.node` relative to itself.
  for (const runtime of ['package.json', 'lib/index.js', 'lib/binding.js', 'lib/database.js']) {
    const expected = `${VENDOR_ROOT}/${runtime}`;
    if (!present.has(expected)) {
      violations.push({
        rule: 'missing-runtime',
        entry: expected,
        detail: 'better-sqlite3 runtime file is missing — the binding cannot be loaded',
      });
    }
  }

  for (const entry of entries) {
    if (entry.startsWith(VENDOR_ROOT)) {
      continue; // the vendored dependency ships as published; its own layout is not ours to police
    }
    const broken = FORBIDDEN.find((rule) => rule.test(entry));
    if (broken !== undefined) {
      violations.push({ rule: 'forbidden-entry', entry, detail: broken.why });
    }
  }
  return violations;
};

/** One line per violation, grouped so a long list stays readable in CI output. */
export const formatViolations = (violations: readonly VsixViolation[]): string =>
  violations.map((violation) => `  ${violation.entry}\n      ${violation.detail}`).join('\n');
