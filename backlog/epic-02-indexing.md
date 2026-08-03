# Epic 02 — Repository Indexing

**Goal:** An incremental, cancellable, non-blocking indexer that turns a repository into graph facts: files, symbols, imports, calls, routes, data models, tests — without ever executing repository code.
**Spec:** §15.1, §30, §32, §33, §34, §35, §40.1
**Phase:** 1 · **Depends on:** Epic 01

---

## Story 2.1 — Workspace scanner & ignore handling

**Acceptance criteria**

- [x] Scanner discovers workspaces, packages, source roots, test roots, build config, entry points (§15.1). _(source/test roots = conventional dirs that exist on disk — src, lib, app, test, tests, `__tests__`, spec — as repository `directory` nodes (`static-analysis`) with package CONTAINS root; the closed §12.1 roster has no source-root/test-root type, so both kinds share `directory` and are told apart by path. Build config = manifest-adjacent tsconfig.json / vite.config.\* / esbuild.\* / webpack.config.\* / Makefile / Dockerfile → CONFIGURES edge file → package (`configuration`). Entry points = package.json main/module/bin/exports paths that exist → package EXPOSES file (`configuration`); declared-but-absent targets, e.g. build output, are skipped, never guessed. tsconfig `rootDir`/`include` is NOT used as root evidence — the scanner parses tsconfig only for path aliases and no new config parsing was added.)_
- [x] Default ignores (node_modules, dist, build, coverage, generated, .terraform) plus user-configured globs are respected; ignored paths never appear in results (§40.1).
- [x] `.env` and common secret files are excluded by default (§35).
- [x] Symlinks, oversized files and path traversal are handled safely (§42.5). _(directory symlinks never traversed; file symlinks confined to root; size cap with warning)_

**Tasks**

- [x] Implement recursive scanner with glob-based ignore engine.
- [x] Detect package manifests / lock files to identify packages and workspaces. _(package.json incl. workspaces; lock files pending)_
- [x] Add safety limits (max file size, symlink cycle detection).
- [x] Unit tests incl. malicious fixture (symlink loop, huge file).

## Story 2.2 — File hashing & incremental index

**Acceptance criteria**

- [x] Files are content-hashed; unchanged files are skipped on re-index (§32). _(sha256; fragment cache keyed by (path, content hash) — a hit skips parsing entirely)_
- [x] Incremental update for a small change completes in < 3 s on a pre-indexed repo (§33, target not hard guarantee). _(measured: one changed file on a 5,000-file synthetic repo re-indexes in well under 1 s — load.test.ts)_
- [x] A failed re-index preserves the previous valid index (§34). _(current-snapshot pointer moves only inside the successful transaction; tested with a simulated crash)_
- [x] Partial progress persists safely; indexing is resumable. _(fragments cached immediately after parsing; a retry after a failed run re-parses nothing)_

**Tasks**

- [x] Implement hash store keyed by snapshot. _(file_hashes table, migration #2)_
- [x] Implement changed-file detection and graph-fragment invalidation (remove stale nodes/edges for a file, insert new ones). _(generation model: each run persists a complete graph under its snapshot; deleted/renamed files simply have no fragments in the new generation)_
- [x] Implement transactional index swap (new index becomes current only on success).
- [x] Tests: modify/delete/rename file scenarios; interrupt mid-index.

## Story 2.3 — Language adapter interface

**Acceptance criteria**

- [x] `LanguageAdapter` interface matches §30 (`detectProject`, `indexFiles`, `analyzeDiff`) and lives in `packages/language-adapters`.
- [x] Core indexer works purely against the interface; adding an adapter requires no core change (§6.1, §43.4). _(indexRepository takes an AdapterRegistry; fallback covers the rest)_
- [x] Unsupported files are reported clearly, not silently dropped (§34). _(fallback adapter emits File nodes + explicit warnings)_

**Tasks**

- [x] Define interface + registration/discovery mechanism.
- [x] Implement adapter dispatch by file extension with conflict rules. _(duplicate extension claims rejected at construction)_
- [x] Implement "unsupported file" reporting channel. _(ParseWarning stream on every fragment + summary)_
- [x] Contract-test suite any adapter must pass (§42.1). _(`packages/test-kit/src/adapter-contract.ts` — `runLanguageAdapterContractChecks(adapter, options)` + the documented `LANGUAGE_ADAPTER_CONTRACT_CHECKS` roster: explainable `detectProject` for a matching fixture / non-throwing for a non-matching one, §12.1–12.2 vocabulary only, deterministic provenance + resolvable evidence + context snapshot on every fact, byte-identical re-indexing, hostile `malicious`-fixture content never aborting the run, and no facts beyond file level outside `supportedExtensions`. Shipped as pure assertion FUNCTIONS rather than a `describe`/`it` block because test-kit declares no test-framework dependency and is a dev dependency of the adapter packages (importing them back would be a package cycle); adapter shapes are mirrored structurally in `adapter-contract-types.ts`. Applied and passing for the TypeScript, Prisma, and fallback adapters in `packages/language-adapters/src/adapter-contract.test.ts` (27 tests); inapplicable checks return `skipped` with a reason and the expected skip list is pinned, so skips are never silent.)_

## Story 2.4 — TypeScript/JavaScript adapter: symbols & imports

**Acceptance criteria**

- [x] TS and JS share one adapter (§30); parsing is static only — repository code is never executed (§35, §40.1).
- [x] Imports and symbol definitions (classes, interfaces, functions, methods, exported consts) appear as graph nodes/edges with `static-analysis` provenance.
- [x] Parser failures on single files are recovered; warnings recorded (§32). _(hostile-content test: one bad file costs one file)_

**Tasks**

- [x] Choose parser (ts-morph / TypeScript compiler API / tree-sitter) — decision recorded as ADR. _(ADR-0008: TS compiler API, syntactic only)_
- [x] Extract file → symbol CONTAINS edges and IMPORTS edges.
- [x] Extract EXTENDS / IMPLEMENTS relationships. _(resolved cross-file at assembly, incl. through barrels)_
- [x] Handle path aliases (tsconfig paths) and index barrel files.
- [x] Golden tests against a fixture repo (§42.3). _(`test-kit/fixtures/ts-basic`)_

## Story 2.5 — TS/JS adapter: calls, routes, data models, tests

**Acceptance criteria**

- [x] Direct function/method call relationships produce CALLS edges (best-effort static resolution; unresolved calls recorded as warnings, never guessed). _(bare identifier calls + `new X()`; property-access calls need the type checker and are skipped, never guessed)_
- [x] Generic route detection (e.g. exported handlers) and data-model detection (e.g. Prisma schema, ORM entities) produce typed nodes. _(exported handlers under api|routes/ → api-endpoint (framework-convention); Prisma models → data/table nodes (configuration))_
- [x] Test files are detected and linked to tested modules via TESTS edges where derivable. _(naming convention types the file node as test; its imports become TESTS edges)_

**Tasks**

- [x] Implement call-graph extraction with confidence-safe resolution rules.
- [x] Implement Prisma/ORM schema parsing → data nodes + READS_FROM/WRITES_TO where statically visible. _(data nodes done; READS_FROM/WRITES_TO from prisma-client property calls needs type resolution — deferred)_
- [x] Implement test detection (naming conventions, test-runner config) and association heuristics (marked `framework-convention` provenance). _(naming conventions + import association; test-runner-config detection deferred)_
- [x] Golden tests for each extraction on fixtures.

## Story 2.6 — Index orchestration: progress, cancellation, process isolation

**Acceptance criteria**

- [x] Indexing runs outside the extension host process (§33) — as a worker/child process usable by both CLI and extension. _(fork-based worker with typed protocol v1; parent verifies the on-disk result; CLI currently runs in-process by choice)_
- [x] Indexing is cancellable and reports structured progress (§32). _(cancellation checked between files, partial parse results cached in batches so a cancelled run resumes; scanning/parsing/assembling/persisting phases streamed)_
- [x] Index status (last run, snapshot, warnings, counts) is queryable (`Show Index Status` command / `impactgraph status`). _(run record persisted in index_state; status shows last run duration + warning count)_

**Tasks**

- [x] Implement index runner process with message protocol (start/progress/cancel/done/error).
- [x] Implement status persistence and query API.
- [x] Load-test on a 5,000-file monorepo fixture: initial index < 2 min target (§33). _(measured ~1 s — two orders of magnitude inside the budget)_
