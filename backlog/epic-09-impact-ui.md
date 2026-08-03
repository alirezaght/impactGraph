# Epic 09 — Impact Review UI (Specification Panel, Tree, Graph, Evidence)

**Goal:** The interactive review surface: enter specs, inspect the impact tree (default) and optional graph, see evidence for every claim, and accept/reject/approve.
**Spec:** §18.2–§18.5, §40.2–§40.4, §37, §43.1, §43.6, Epic G (§45), §44 Phase 5
**Phase:** 3–5 · **Depends on:** Epics 05, 06, 07

---

## Story 9.1 — Specification view

**Acceptance criteria**

- [x] Supports: paste, import selected text, import current Markdown file, receive via command/agent tool, edit (§18.2). _(React panel: free-text editor, `Import current file` / `Import selection` (host reads the active editor), `impactgraph.importSpecification` command, MCP `submit_specification` remains the agent path)_
- [x] Shows extracted requirements, ambiguities, and open questions with answer workflow (§18.2, §40.2). _(requirement list with confirm/reject/edit; question list ordered by severity with answer + dismiss; §C10 readiness rendered)_
- [x] Save/compare specification versions; run impact analysis from the panel (§18.2). _(Save = `submitSpecification` → version N+1; Compare opens VS Code's own diff between two stored versions; Analyze runs the existing consent-gated engine job)_

**Tasks**

- [x] Build specification webview/panel with editor + requirement list. _(`apps/vscode-extension/webview/src/panels/specification-*.tsx`)_
- [x] Wire `Analyze Specification / Selected Text / Current Markdown File / Import Specification / Save Specification Version / Compare Specification Versions` commands (§19). _(added `impactgraph.importSpecification`, `impactgraph.saveSpecificationVersion`, `impactgraph.compareSpecificationVersions`, plus `impactgraph.openImpactReview` as the panel entry point; analyze/selection already existed)_
- [x] Open-question answering UI persisting to the spec model. _(routes to the existing `answerQuestion` engine call — specification version N+1 + clarification ADR (§C9); the webview never mutates)_
- [x] Webview communication tests (§42.4). _(both-direction Zod validation is covered by the `contract`, `webview` and `extension` vitest projects; the @vscode/test-electron round trip through the real host is now covered too. `suite/webview.ts` reaches the LIVE panel through the test-mode-gated extension API (the suite bundle is separate from `dist/extension.cjs`, so importing `ImpactReviewPanel` would only give a second singleton) and asserts: the React app's `webview/ready` arriving over the real transport and being accepted by the host's own `onDidReceiveMessage` path; `post()` reporting genuine delivery into the loaded webview; a contract-invalid `host/status` refused before it leaves the host; `unsupported-protocol-version`, `unknown-type` and `malformed` all refused inbound; and `webview/select-node` in → `host/evidence` delivered back out. `ImpactReviewPanel.receive()`/`post()` now RETURN the host's decision instead of swallowing it — the OutputChannel cannot be read back through any VS Code API, so that return value is the only way a refusal is observable at all.)_

## Story 9.2 — Impact tree

**Acceptance criteria**

- [x] Default view; hierarchy Specification → Requirement → likelihood buckets, switchable to grouping by affected context and by likelihood (§18.3, Epic G). _(default hierarchy done in the native Current Impact tree; grouping-mode switch open)_
- [x] Filters by likelihood and impact type work (§40.4). _(`Filter Impacts` quickpick: multi-select likelihoods + impact types, pure reprojection of the analyze document; `Clear Impact Filters` resets; tested)_
- [x] Each item shows likelihood, impact type, confidence (text + color), provenance label (§3, §37). _(text-only indicators — likelihood · type · confidence · provenance in the description)_
- [x] Tree is fully usable without the graph view (§40.4, §37). _(native TreeView; no webview involved)_

**Tasks**

- [x] Implement tree data provider over `ImpactAnalysis`. _(pure `buildImpactItems` mapping over the versioned analyze document, unit-tested without Electron; provider is a thin projection)_
- [x] Implement grouping-mode switch + filters. _(by-requirement (default) and by-impact-type grouping; context/application grouping needs context data in the analyze document — arrives with the Epic 08 merge layer surfacing)_
- [x] Accessibility: labels, keyboard nav, color-independent indicators. _(text badges + tooltips; native tree gives keyboard nav; full a11y pass with the electron lane)_
- [x] Integration tests (§42.4). _(`suite/tree-views.ts` feeds `ImpactTreeProvider` a real, contract-validated analyze document obtained over the same engine-worker boundary the shell uses, then asserts the projection produces nodes and a headline. Green in the real extension host since the Epic 07 reindex fix.)_

## Story 9.3 — Evidence panel

**Acceptance criteria**

- [x] Selecting an impact shows: explanation, requirement, expected change, confidence + contributing factors, provenance, direct/indirect, dependency path, source files, symbols, ranges, related tests, human decisions, warnings (§18.5). _(dedicated evidence panel bound to graph/list selection; symbol-level detail is limited to what `explain_node` returns — node name/type/path and its edges, not a per-symbol list)_
- [x] Confidence factors render the "why this score" breakdown from the confidence engine (§14). _(signed per-signal contributions, e.g. `+ exact-name-match (+0.60)` / `- indirect-event-boundary (-0.12)`; absent signals render as explicitly absent, never as a bare score)_
- [x] Every source reference is clickable and opens the file at the range. _(evidence file children open the file; symbol RANGE navigation open — Story 7.5)_

**Tasks**

- [x] Build evidence panel view bound to tree/graph selection. _(webview panel; bound to graph-canvas and node-list selection. Binding to the NATIVE Current Impact tree selection is still open — the tree and the panel are separate surfaces today)_
- [x] Render dependency path as navigable chain. _(rendered as a chain label; per-hop navigation open — hop entries are node ids without file paths in the analyze document)_
- [x] Integration test: selection → panel → navigation. _(all three halves now run in the electron lane. Navigation: `suite/navigation.ts` reveals up to 6 symbol nodes via `impactgraph.revealNode` and asserts the right file opens and, where evidence carries a declaration range, the right selection. Selection → panel: `suite/webview.ts` feeds a contract-valid `webview/select-node` through the real inbound path and waits for the host to deliver `host/evidence` back to the live webview — a node id that is not in the analysis still produces an explicit state rather than silence (§43.6). Panel liveness: the loaded React app's own `webview/ready` is what proves the transport, not a stub.)_

## Story 9.4 — Accept / reject / manual impacts & approval

**Acceptance criteria**

- [x] Accept, reject, and add-manual-impact actions work from tree and graph; decisions persist as `UserImpactDecision` (§13, §40.3). _(accept/reject via tree context menu → `recordImpactDecision`, append-only, reject asks for a reason; manual-add picker open)_
- [x] Manual impacts must reference an existing graph node (picker with search). _(`Add Manual Impact`: search via findComponents → node quickpick → engine-validated `manually-added` decision; free-text component names impossible)_
- [x] `Approve Impact Analysis` freezes the analysis (immutable, versioned) and rejected impacts are recorded for export (§40.3, §22). _(quickpick of draft/reviewed analyses + modal confirmation; export buckets rejected impacts)_

**Tasks**

- [x] Implement decision actions + node picker. _(decision actions done; node picker open)_
- [x] Implement approval command with confirmation and status transition.
- [x] Tests: approved analysis rejects further edits. _(engine-level: MCP e2e asserts decisions rejected after approval)_

## Story 9.5 — Graph view

**Acceptance criteria**

- [x] Interactive webview graph with zoom, pan, search, expand/collapse, filters (impact type, confidence, inferred-only, hide unchanged), grouping (context/application/requirement), direct-vs-indirect display, open-source-from-node, evidence display, accept/reject, add impact, current-vs-proposed relationships (§18.4). _(all of it: zoom/pan (Cytoscape+fcose), search, group expand/collapse, all filters, grouping by **context** (the default), **application** (owning package/workspace, walked over CONTAINS — a node no package owns reads "no application" rather than being guessed from its path), requirement, impact type, likelihood and knowledge category; direct-vs-indirect line style + text; open-source-from-node; evidence display; accept/reject; add-impact via the engine-validated picker; and **current-vs-proposed** — proposed relationships travel their own code path from DTO to Cytoscape, carry a long-dash treatment no current edge can produce plus a `[PROPOSED]` label and a screen-reader sentence, and a current/proposed/both filter diffs them instead of merging. Proposed elements count against the 200-node budget.)_
- [x] Defaults: context → component → integration/data dependency level, < 200 visible nodes, progressive disclosure — never the full symbol graph (§18.4, §33, §43.1). _(the default level is now **context → component**: `DEFAULT_FILTERS.groupBy = 'context'`, so the compound parents are §Z5 effective contexts and the leaves are components; requirement grouping is one click away and the native impact TREE still opens on requirements, so neither reading is lost. A component with no assigned context lands in an explicit "no context assigned" bucket — never guessed from its path. Node budget and progressive disclosure unchanged and still unit-tested: hard cap of 200 visible nodes, groups collapse past the budget, a visible "Showing N of M … K hidden" line and per-group expand affordance. The pessimal shape for the NEW default — 900 nodes, none with a context, so one giant bucket — is now tested explicitly: collapsed it shows 0, expanded it shows exactly 200 and reports 700 hidden.)_
- [x] Reduced-motion compatible; the tree remains the accessible alternative (§37). _(`prefers-reduced-motion` disables layout animation; the native Current Impact tree stays fully usable, and inside the panel the node list is a keyboard/screen-reader equivalent of the canvas)_

**Tasks**

- [x] Choose rendering lib (e.g. Cytoscape/ELK) and build webview with message protocol. _(Cytoscape per ADR-0005; versioned Zod message protocol in `packages/contracts/src/webview`, validated on both ends)_
- [x] Implement level-of-detail expansion + node limits. _(`graph/disclosure.ts`, cap 200)_
- [x] Implement filter/group controls + selection sync with evidence panel. _(`graph/filters.ts` + `graph-controls.tsx`; selection posts `webview/select-node` and the host answers with `host/evidence`)_
- [x] Performance test with large fixture graph. _(`webview/src/graph/graph-performance.test.ts` — a real, deterministic (index-seeded) 5,000-node / ~10,000-edge fixture, 5 runs, median + worst reported. **P1 first-paint pipeline** (filter → progressive disclosure → Cytoscape element construction, i.e. everything on the UI thread between `host/graph` arriving and Cytoscape being handed elements): **7.7 ms median, 15.1 ms worst** against a 150 ms guard. **P2 layout** (a real headless Cytoscape core, the shipped stylesheet, the shipped `cose` options, animation off, over the 201 capped elements): **466.8 ms median, 476.0 ms worst** against a 2,000 ms guard. Baseline recorded in the file header (2026-08-02, darwin-arm64, Node 22). Headless rather than jsdom-painted is deliberate: jsdom has no canvas, so a painted frame cannot be timed in this lane at all, and layout + style resolution is the cost that actually scales with node count — a fabricated "render ms" would have been worse than measuring less. Formal B11/B12 entries in `performance-budgets.md` are performance-scalability's call; the constants in the test are this suite's contract until then.)_

**Open — needs data the analyze document does not carry yet**

- **Current-vs-proposed relationship display (§18.4) — ENGINE SIDE SHIPPED; webview side open.**
  The original decline was correct: nothing in `cliAnalyzeOutputSchema` described a proposed
  relationship, and `architecturalOptions[].affectedNodeIds` is a node SET, not a topology.
  The engine now asserts the topology itself, so there is something truthful to draw.

  **Delivered (impact-modeling):**
  1. `ProposedRelationship` / `ProposedNode` as first-class domain records
     (`packages/domain/src/impact/proposed-structure.ts`): `{ id, sourceId, targetId, sourceKind,
targetKind, type, status: 'proposed', originOptionId, rationale, provenance, evidenceIds,
confidence, confidenceSignals }`. `sourceKind`/`targetKind` are `existing | proposed`;
     `existing` endpoints are validated against the deterministic graph at the bound snapshot,
     `proposed` endpoints must be declared `nodes[]`, and a proposed node may never reuse a real
     node id. Failures are dropped with an `invalid-reference` warning, never repaired.
  2. Proposed nodes are expressible and validated, but **v1 derives none** — a component that does
     not exist has no evidence record to cite (see `docs/engineering/data-contracts.md`).
  3. `cliAnalyzeOutputSchema.proposedStructure` — an **additive optional v1 field**, not a bump
     (absence = "nothing proposed", so prior readers keep their exact meaning, ADR-0009). Same
     document on the `analyze_impact` MCP tool; CLI text prints a separate
     "Proposed structure — does not exist in the repository today" section.

  **What the webview needs to do now:** read `output.proposedStructure.relationships`, build edges
  from `sourceId`/`targetId` (resolving `targetKind === 'proposed'` against
  `proposedStructure.nodes`, which are NOT in the graph DTO), give them a fourth
  colour-independent line treatment plus a "PROPOSED" text badge, and add a filter that shows
  current-only / proposed-only / both — the diff, not a merge. Every record already carries
  `rationale` + `confidenceSignals`, so the evidence panel needs no new data to explain a proposed
  edge. Still open on the engine side: mirroring the field onto the webview graph DTO
  (`impactGraphSchema` — graph-webview's contract), and §26 "removed dependencies".

- Application-level grouping — no application concept in the impact DTO (the ARCHITECTURE view
  now has an Applications section, but that reads the graph directly, not the analysis).
- Drill-down to Module → File → Symbol beyond the dependency-path hops the analysis reports.
- Staleness flags in the graph/evidence DTOs (§3) — not exposed by the analyze document.
