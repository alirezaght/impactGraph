import { describe, expect, it } from 'vitest';

import { REQUIRED_PREBUILDS, VENDOR_ROOT, vsixViolations } from './vsix-contents.js';

// The packaging contract of the shipped `.vsix`. These rules exist because an installed extension
// failed at `openSqliteIndexStore`: the binding was external to the bundle and `vsce package
// --no-dependencies` shipped nothing to satisfy it.

/** A minimal archive that satisfies every rule — each test perturbs one thing. */
const wellFormed = (): string[] => [
  'extension/package.json',
  'extension/dist/extension.cjs',
  'extension/dist/index-worker.cjs',
  'extension/dist/webview/webview.js',
  'extension/dist/schemas/config.schema.json',
  `${VENDOR_ROOT}/package.json`,
  `${VENDOR_ROOT}/lib/index.js`,
  `${VENDOR_ROOT}/lib/binding.js`,
  `${VENDOR_ROOT}/lib/database.js`,
  ...REQUIRED_PREBUILDS.map((target) => `${VENDOR_ROOT}/prebuilds/${target}.node`),
];

describe('vsix packaging contract', () => {
  it('accepts an archive carrying the bundle and the vendored binding', () => {
    expect(vsixViolations(wellFormed())).toEqual([]);
  });

  it('rejects an archive with no native binding at all — the original failure', () => {
    const withoutBinding = wellFormed().filter((entry) => !entry.startsWith(VENDOR_ROOT));
    const violations = vsixViolations(withoutBinding);
    expect(violations.filter((v) => v.rule === 'missing-binding')).toHaveLength(
      REQUIRED_PREBUILDS.length,
    );
    expect(violations.some((v) => v.rule === 'missing-runtime')).toBe(true);
  });

  it('rejects an archive missing a single platform, so one OS is not silently broken', () => {
    const withoutWindows = wellFormed().filter(
      (entry) => entry !== `${VENDOR_ROOT}/prebuilds/win32-x64.node`,
    );
    const violations = vsixViolations(withoutWindows);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('missing-binding');
    expect(violations[0]?.entry).toBe(`${VENDOR_ROOT}/prebuilds/win32-x64.node`);
    expect(violations[0]?.detail).toContain('win32-x64');
  });

  it('rejects prebuilds shipped without the loader that selects one', () => {
    const withoutLoader = wellFormed().filter((entry) => entry !== `${VENDOR_ROOT}/lib/binding.js`);
    const violations = vsixViolations(withoutLoader);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('missing-runtime');
    expect(violations[0]?.entry).toBe(`${VENDOR_ROOT}/lib/binding.js`);
    expect(violations[0]?.detail).toContain('binding cannot be loaded');
  });

  it.each([
    ['extension/dist/extension.cjs.map', 'sourcemap'],
    ['extension/dist/webview/webview.js.map', 'sourcemap'],
    ['extension/src/extension.ts', 'TypeScript source'],
    ['extension/webview/index.tsx', 'TypeScript source'],
    ['extension/src/commands/provider-config.ts', 'TypeScript source'],
    ['extension/dist/test/suite.js', 'test bundle'],
    ['extension/dist/harness.test.js', 'test bundle'],
    ['extension/.vscode-test/user-data/log.txt', 'integration-test scaffolding'],
  ])('rejects %s', (entry, why) => {
    const violations = vsixViolations([...wellFormed(), entry]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('forbidden-entry');
    expect(violations[0]?.entry).toBe(entry);
    expect(violations[0]?.detail).toContain(why);
  });

  it('leaves the vendored dependency alone — its own layout is not ours to police', () => {
    // better-sqlite3 publishes .d.ts and its own sources; excluding them is the vendor step's
    // job, and a stray file inside the vendor root must not be reported as OUR violation.
    const violations = vsixViolations([
      ...wellFormed(),
      `${VENDOR_ROOT}/lib/database.d.ts`,
      `${VENDOR_ROOT}/src/better_sqlite3.cpp`,
    ]);
    expect(violations).toEqual([]);
  });

  it('does not mistake the shipped bundle for a test bundle', () => {
    // `dist/extension.cjs` and the schema JSON must survive every rule.
    expect(vsixViolations(wellFormed())).toEqual([]);
  });
});
