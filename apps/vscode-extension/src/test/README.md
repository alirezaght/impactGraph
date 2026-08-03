# VS Code integration tests (`@vscode/test-electron`)

Story 17.4 / PRD §42.4. Owning agent: `testing-quality` (harness + lanes),
`vscode-integration` (the shell under test).

Run: `pnpm test:integration:vscode` (root) → `pnpm --filter ./apps/vscode-extension run
test:integration:vscode`. **Never** part of `pnpm quality:gates` or a git hook — it downloads and
launches Electron. CI lane: `test-vscode-integration` (xvfb, slow lane).

## How it is built

The extension bundles to CJS with esbuild, so the tests do too — there is no `tsc` emit step.
`src/test/build.mjs` produces three CJS bundles under `dist/test/`:

| Bundle                         | Runs in          | Entry                         |
| ------------------------------ | ---------------- | ----------------------------- |
| `dist/test/runner.js`          | plain Node       | `src/test/runner.ts`          |
| `dist/test/suite/index.js`     | VS Code ext host | `src/test/suite/index.ts`     |
| `dist/test/suite/untrusted.js` | VS Code ext host | `src/test/suite/untrusted.ts` |

`dist/test/package.json` pins `{"type":"commonjs"}` so Node treats the emitted `.js` as CJS even
though the package itself is ESM. The suite entries export `run()`, the contract
`--extensionTestsPath` expects.

## Runner (`runner.ts`)

Two launches, each with a throwaway user-data dir, extensions dir and workspace:

1. **trusted lane** — `--disable-workspace-trust`, runs `suite/index.js` (the nine §42.4 areas).
2. **untrusted lane** — trust left on, runs `suite/untrusted.js` (PRD §35 restricted-mode
   behavior). Self-protecting: if VS Code trusts the workspace anyway, the lane skips loudly
   instead of passing vacuously.

The fixture workspace is a **copy** of `packages/test-kit/fixtures/ts-basic` into a temp dir,
`git init`-ed and committed (the engine requires a git repository). The fixture itself is never
modified.

## Test harness (`harness.ts`)

A ~90-line registry — no Mocha, no new dependency. Suites are plain data
(`{ name, tests: [{ name, run }] }`), assertions are `node:assert/strict`, and `skipTest(reason)`
records an explicit, printed skip. `run()` rejects when anything failed, which is what makes the
CI lane blocking.

## Suite order matters

Suites share one VS Code window and one workspace, so the order in `suite/index.ts` is part of the
contract: `activation` (must observe a pristine, un-activated extension) → `error-states` (must
observe an _uninitialized_ workspace) → `commands` (initializes and indexes) → everything else.

## Conventions

- Assert on command ids, files on disk and engine state — **never** on notification text
  (locale-fragile) and never on internal webview state.
- Commands that `await showInformationMessage(...)` never resolve in a headless run: fire them
  with `fireCommand()` and wait on observable state, then `dismissNotifications()`.
- Files here are `*.ts`, not `*.test.ts`: the `extension` vitest project owns `*.test.ts` under
  `src/`, and these must import `vscode`, which the repo-wide test lint override forbids.
- `skipTest(reason)` is the only acceptable way to not run an assertion, and the reason must say
  what would enable it. Never delete or loosen an assertion to make the lane green.
- **Reaching the running shell's own state.** These suites are bundled separately from
  `dist/extension.cjs` (`build.mjs`), so importing a module from `src/` here yields a **second
  copy** with its own module-level state — `ImpactReviewPanel.current()` imported directly would
  always be `undefined`, and the shell's activation `context` is unreachable. Constructing a fresh
  provider (as `tree-views.ts` does) is the right move when the thing under test is a pure
  projection. When the LIVE instance is the point, go through `extension.exports`
  (`src/extension-api.ts`), which is populated **only** under `ExtensionMode.Test` — see the note
  in that file for why the gate is not optional.

## Known environment constraints

- **`better-sqlite3` must resolve from `apps/vscode-extension`.** The extension bundles
  (`dist/extension.cjs`, `dist/index-worker.cjs`, `dist/engine-worker.cjs`) all
  `require("better-sqlite3")` at runtime, but it is only a dependency of
  `packages/persistence` — so Node cannot resolve it from the extension's own directory, on any
  platform. Until it is declared as a dependency of the extension, everything downstream of
  `Reindex Workspace` fails in this lane. `ensureIndexed()` re-runs the worker directly and puts
  the real reason in the failure message rather than a bare timeout.
- **Native ABI, resolved.** This lane originally failed with
  `NODE_MODULE_VERSION 137 … requires 146` — better-sqlite3 built for the local Node cannot load
  in Electron, and `fork()` from the extension host does not escape it (`ELECTRON_RUN_AS_NODE=1`).
  An earlier diagnosis blamed macOS hardened-runtime Team IDs; that was wrong. Fixed by upgrading
  better-sqlite3 11 → 13, which is **Node-API** based and therefore ABI-stable across Node and
  Electron — no rebuild step, no per-platform binaries. If a future dependency change reintroduces
  a non-Node-API native module, these suites are where it will surface first. See ADR-0006.
- **The untrusted lane cannot use `runTests()`**: `@vscode/test-electron@3.1.0` hard-codes
  `--disable-workspace-trust` into every launch, so that lane spawns the downloaded executable
  directly (`launch.ts`). If VS Code ever trusts the workspace anyway, the suite skips loudly
  instead of passing vacuously.
