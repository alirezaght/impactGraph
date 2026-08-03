# Extension packaging and assisted API-key entry

## Packaging

The packaged `.vsix` must contain the `better-sqlite3` native binding so the installed
extension can open its SQLite index. `openSqliteIndexStore` currently fails in an installed
extension because the binding is external to the esbuild bundle and lives in `node_modules`,
which packaging excludes.

The `.vsix` must also exclude test bundles, sourcemaps, and TypeScript sources.

## Assisted key entry

`configureModelProvider` must offer to open the Anthropic console key page in a browser before
prompting for the key, so the user does not have to find the URL. The key must continue to be
stored only in SecretStorage; no configuration file may ever hold it.
