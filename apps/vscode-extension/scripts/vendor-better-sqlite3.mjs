// Copies the `better-sqlite3` runtime into `dist/vendor/` so it ships inside the `.vsix`.
//
// Why this exists: the binding is a native module, so it stays `external` to the esbuild bundle,
// and CI packages with `vsce package --no-dependencies` (correct for a pnpm workspace — vsce
// cannot walk the symlinked store). Nothing then satisfies the `better-sqlite3` require, and an
// installed extension dies at `openSqliteIndexStore`.
//
// Deliberately NOT `dist/node_modules/`: vsce's file walk ignores `node_modules` at any depth, so
// that name would be silently dropped. The bundle requires the vendored path explicitly instead of
// relying on Node's directory-walking resolution (see `vendorAlias` in esbuild.mjs).
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * What we copy. `lib/` is the loader (lib/binding.js picks a prebuild by platform/arch at runtime)
 * and `prebuilds/` holds one `.node` per target. Everything else better-sqlite3 publishes —
 * `deps/` (9.8 MB of SQLite C sources), `src/`, `binding.gyp`, `build/` — is compile-time only and
 * would roughly double the artifact for no runtime benefit.
 */
const RUNTIME_ENTRIES = ['package.json', 'lib'];

/** All eight prebuilds ship, so one universal `.vsix` installs on every platform VS Code runs on. */
const PREBUILD_SUFFIX = '.node';

export const vendorBetterSqlite3 = ({ outDir }) => {
  const source = dirname(require.resolve('better-sqlite3/package.json'));
  const target = join(outDir, 'better-sqlite3');

  rmSync(target, { recursive: true, force: true });
  mkdirSync(join(target, 'prebuilds'), { recursive: true });

  for (const entry of RUNTIME_ENTRIES) {
    cpSync(join(source, entry), join(target, entry), { recursive: true });
  }

  const prebuilds = readdirSync(join(source, 'prebuilds')).filter((file) =>
    file.endsWith(PREBUILD_SUFFIX),
  );
  if (prebuilds.length === 0) {
    throw new Error(
      `no prebuilt bindings in ${join(source, 'prebuilds')} — the .vsix would install but fail ` +
        'to open its SQLite index. Run `pnpm install` so better-sqlite3 fetches its prebuilds.',
    );
  }
  for (const file of prebuilds) {
    cpSync(join(source, 'prebuilds', file), join(target, 'prebuilds', file));
  }
  return { source, target, prebuilds };
};
