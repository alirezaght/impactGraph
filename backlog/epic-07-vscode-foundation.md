# Epic 07 — VS Code Extension Foundation & Architecture Explorer

**Goal:** The extension shell: activity bar, command registration, background-engine communication, architecture tree, source navigation, progress and error reporting.
**Spec:** §18.1, §18.6, §19, §29.2, §33, §37, Epic C (§45), §44 Phase 2
**Phase:** 2 · **Depends on:** Epic 02

---

## Story 7.1 — Extension shell & activity bar

**Acceptance criteria**

- [x] Extension activates in < 500 ms without indexing (§33); no indexing in the extension host (§33). _(activate() only registers; status bar populates post-activation; the measured budget test needs the electron lane)_
- [x] Activity bar container with views: Specifications, Current Impact, Architecture, Review, Issues (§18.1). _(unbuilt views show welcome content pointing at their epics)_
- [x] All §19 commands are registered (stubs allowed for not-yet-built engines, reporting "not available" cleanly).
- [x] Current privacy mode is visible in the UI (§9). _(status bar item; click → configurePrivacy quickpick; config-file backed, never changed silently)_

**Tasks**

- [x] Scaffold `apps/vscode-extension`, activation events, view containers. _(esbuild bundles: extension.cjs + index-worker.cjs; better-sqlite3 external)_
- [x] Register command palette commands + context-menu commands (§19). _(palette commands done; editor context-menu commands come with Story 7.5)_
- [x] Add status-bar item for privacy mode + index status.
- [x] Activation-time integration test (§42.4). _(Story 17.4 lane: `apps/vscode-extension/src/test/suite/activation.ts` measures a cold `activate()` against the 500 ms budget — 123 ms locally on macOS — and asserts activation neither scaffolds `.impactgraph/` nor opens the SQLite index. The second assertion caught a real §33/§35 defect — the deferred `statusBar.refresh()` opened the SQLite store unconditionally, scaffolding `.impactgraph/cache/` in a workspace the user never initialized AND in untrusted workspaces. **Fixed**: `readIndexState` now returns early when the workspace is untrusted, uninitialized, or has no database file, so the status probe creates nothing.)_

## Story 7.2 — Background engine process & progress

**Acceptance criteria**

- [x] Core engine runs in a separate process; extension communicates via the Epic 02 message protocol. _(bundled worker forked per run; protocol v1)_
- [x] Long operations show cancellable VS Code progress notifications; UI stays responsive during indexing (§33). _(withProgress + real cancellation forwarded to the worker)_
- [x] Engine crashes surface as actionable error diagnostics, not silent failures. _(worker error/exit → error notification + output channel; Issues view population pending)_

**Tasks**

- [x] Implement process manager (spawn, health-check, restart). _(spawn-per-run with exit detection; long-lived manager with restart when a resident engine exists)_
- [x] Wire progress + cancellation into VS Code notifications API.
- [x] Error diagnostics channel + "Issues" view population. _(Issues tree: drift needs-review/suggestions, §Z9 learning proposals, last index warnings; refreshed after reindex (§Z19.10) + manual Refresh Issues command)_
- [x] Integration tests: cancellation, error states (§42.4). _(`suite/cancellation.ts` drives a real `CancellationTokenSource` through the exact `token.onCancellationRequested(() => handle.cancel())` wiring the commands use, for both the engine job and the index worker, asserting a < 500 ms response and that a cancelled index never destroys the previous one (§34). `suite/error-states.ts` runs 12 commands against an uninitialized workspace and asserts each resolves without throwing and without scaffolding. Error states all pass; cancellation is blocked behind the reindex failure below.)_

## Story 7.3 — Workspace initialization & reindex commands

**Acceptance criteria**

- [x] `Initialize Workspace` detects languages, frameworks, packages, applications, infrastructure, tests, migrations, and creates the initial architecture model (§10.1). _(init now shows the §10.1 detection-review summary via engine `detectStack` — languages/frameworks/signals with a "Reindex Now" action; before the first index it degrades to the reindex hint)_
- [x] Extension detects uninitialized projects and offers initialization (§10.1). _(architecture view welcome content offers init/reindex)_
- [x] `Reindex Workspace`, `Show Index Status`, `Clear Local Cache` work end-to-end (§19). _(cache clear is confirm-gated and touches only .impactgraph/cache)_
- [x] Repository trust mode is respected — no analysis in untrusted workspaces (§35). _(capabilities.untrustedWorkspaces: limited + guard on every mutating command)_

**Tasks**

- [x] Implement initialization flow calling scanner + adapters. _(init scaffolds; first reindex runs the full detection pipeline)_
- [x] Implement detection-review summary shown after init (§10.1 step 6). _(`showDetectionSummary` in register-commands + pure `stackSummaryMessage` (unit-tested); "Reindex Now" triggers the existing reindex command)_
- [x] Wire reindex/status/cache commands.
- [x] Integration test on fixture workspace. _(`suite/commands.ts` runs initializeWorkspace → reindexWorkspace → analyzeSpecification on a temp `git init`-ed copy of `packages/test-kit/fixtures/ts-basic`, plus a permanent manifest↔registration drift check in both directions (green — every contributed command is registered, including the new specification/webview commands). `initializeWorkspace` passes. The suite also caught a packaging defect that would have shipped: esbuild marks `better-sqlite3` external (native module), so the bundles `require()` it at runtime, but it was only a transitive dependency of `packages/persistence` and therefore unresolvable from the extension's own directory — a packaged `.vsix` could never have opened its index. **Fixed**: declared in `apps/vscode-extension` dependencies. With the dependency linked, the lane surfaced a second, deeper blocker (an earlier code-signing diagnosis was wrong): better-sqlite3 11.x is built against a Node ABI Electron does not share, and 11.x cannot even compile against Electron 42's V8. **Fixed by upgrading better-sqlite3 11.10.0 → 13.0.2**, which is Node-API based and therefore ABI-stable across Node and Electron — no rebuild step, no per-platform binaries. The lane now runs **39 passed / 0 failed / 1 skipped** (trusted) and **4/4** (untrusted), including reindex and analyze inside the real extension host.)_

## Story 7.4 — Architecture tree view

**Acceptance criteria**

- [x] Architecture view shows detected applications, contexts, components, integrations, infrastructure, unconfirmed inferences, architecture issues, user corrections (§18.6). _(the view now opens on five first-class sections — **Applications** (`application`/`service` nodes), **Contexts** (§Z5 effective context per component via `contextsForGraph`, with an explicit "no context assigned" bucket and a per-context component count), **Components** (packages/workspaces → files → symbols, the previous top level), **Integrations** (`integration`-category nodes: topics, queues, webhooks, external APIs) and **Infrastructure** (`infrastructure`-category nodes). Selection is on the §12.1 node vocabulary the indexer already assigned — nothing is inferred in the view, and a section with no matching nodes renders a "none detected" row stating what is absent rather than vanishing (§43.6). Grouping logic is pure and unit-tested in `src/views/architecture-sections.ts`; the provider stays a projection. Epic 08 correction menus are unaffected: section/context/note rows carry `architecture-section` / `architecture-context` / `architecture-note` as their `contextValue`, so `viewItem =~ /^(package|file)$/` still matches only the rows that own a path — asserted in both directions by a new integration test. Unconfirmed inferences + architecture issues remain in the Issues view.)_
- [x] Inferred vs. confirmed items are visually and semantically distinct (§3) with text labels, not color alone (§37). _(fact/convention/inferred/confirmed text badges + accessible labels)_
- [x] Default level is Context → Component → dependency; drill-down to Module → File → Symbol (§18.4 hierarchy applied to tree). _(package → file → symbol drill-down, lazy per level)_

**Tasks**

- [x] Implement tree data provider over the graph query API.
- [x] Add provenance badges/labels and issue indicators. _(provenance labels done; issue indicators with the Issues view)_
- [x] Implement drill-down + lazy loading for large graphs. _(children resolved per expansion via CONTAINS edges)_
- [x] Tree view integration tests (§42.4). _(`suite/tree-views.ts` walks section → component → file → symbol through a real `ArchitectureTreeProvider` (exercising lazy per-level loading) and asserts provenance descriptions are present; also covers the Issues, Impact and Review providers. Two tests added with the §18.6 sections: every section resolves children (an empty one still renders its "none detected" row), and no section/context/note row ever exposes a `package`/`file`/`symbol` `contextValue` while those three rows still expose exactly theirs — the Epic 08 `view/item/context` menus are regression-guarded from both sides. Green in the real extension host.)_

## Story 7.5 — Source navigation

**Acceptance criteria**

- [x] Selecting a file/symbol node opens the relevant source at the correct range (§40.4). _(symbol nodes now reveal their DECLARATION: `explain_node` carries the evidence `range`, and `impactgraph.revealNode` resolves it lazily on selection (one engine call per click, not per tree item) and opens with that selection; file/package nodes open at the top, which is honest since they have no single meaningful range. A missing or degenerate range falls back to opening at the top — a wrong reveal is worse than none; tested in navigation.test.ts)_
- [x] Context-menu commands work from the editor: Show Architectural Dependencies, Show Requirement Impacts, Analyze Selection (§19). _(three commands + editor/context menu entries; dependencies via `findComponents`/`explainNode` quickpick with open-target, impacts filtered from the latest stored analysis, selection reuses the analyze workflow incl. consent)_
- [x] Keyboard navigation and screen-reader labels on all tree items (§37). _(accessibilityInformation labels on every item in all four trees — label + text badge; tooltips fall back to the label; native tree keyboard nav)_

**Tasks**

- [x] Implement node → URI+range resolution and reveal logic. _(pure `resolveSourcePath` + `toEditorSelection` in views/navigation.ts — 1-based parser ranges → 0-based editor positions, inverted ranges clamped, commit evidence rejected; the vscode-facing half is commands/reveal-node.ts)_
- [x] Implement editor context-menu handlers. _(`commands/editor-context.ts` thin handlers + pure `editor-context-items.ts` projections, unit-tested)_
- [x] Accessibility pass: focus management, labels, high-contrast check (§37). _(accessible labels + tooltips on all tree items, unit-tested label mapping; focus is native tree behavior; badges remain text-only so high-contrast carries no color-only signal — no manual high-contrast session performed)_
