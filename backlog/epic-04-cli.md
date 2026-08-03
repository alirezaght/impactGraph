# Epic 04 — CLI

**Goal:** A headless CLI over the same core engine as the extension — the first shipped surface (Milestone 1) and the CI entry point.
**Spec:** §20, §29.3, §44 Phase 1, §46
**Phase:** 1 · **Depends on:** Epic 02 (and Epics 05–06, 10–11 for later commands)

---

## Story 4.1 — CLI skeleton, config & exit codes

**Acceptance criteria**

- [x] `impactgraph init`, `index`, `status`, `config` work on a TypeScript repo.
- [x] Exit codes distinguish: success / warnings / review discrepancies / configuration error / indexing failure / provider failure / unsupported project (§20). _(`EXIT_CODES` in `contracts/cli`; no literal numbers in the app)_
- [x] Every command supports `--format json` with stable machine-readable output. _(Zod-validated before printing; JSON Schemas committed)_
- [x] `init` creates `.impactgraph/` with config + `.gitignore` for caches (§16).

**Tasks**

- [x] Scaffold `apps/cli` with arg parsing and command routing.
- [x] Implement exit-code contract as a shared enum + tests.
- [x] Implement `init` (config bootstrap) and `status` (index status from Epic 02).
- [x] JSON output snapshot tests. _(vitest `cli` project — `pnpm test:cli`; adding it to quality:gates/CI is a testing-quality follow-up)_

## Story 4.2 — `impactgraph index` & `architecture`

**Acceptance criteria**

- [x] `index` runs full and incremental indexing with progress output and honors cancellation (Ctrl-C leaves previous index valid). _(incremental by default, `--format json` summary; Ctrl-C safety comes free from the transactional generation swap — the pointer only moves on commit. Streaming TTY progress lands with Story 2.6's runner)_
- [x] `architecture` prints detected applications, packages, contexts, components; `--format json` exports the graph summary (§20, Phase 1 "JSON graph export"). _(packages/workspaces + node/edge type composition; contexts/components arrive with Epics 03/08)_

**Tasks**

- [x] Wire index runner (Epic 02, story 2.6) into CLI with TTY progress. _(`performIndexRun` accepts `onProgress`; `impactgraph index` streams phase + file counts to stderr on a TTY, silent when piped/JSON)_
- [x] Implement architecture summary renderer (text + JSON).
- [x] Integration test on fixture repo.

## Story 4.3 — `impactgraph analyze` (Milestone 1 core)

**Acceptance criteria**

- [x] `impactgraph analyze spec.md` produces requirements, open questions, and Required/Likely/Possible impact lists with evidence file paths — matching the §46 example output shape.
- [x] All impacts reference real graph nodes; results exportable as JSON (§46). _(validated `cliAnalyzeOutputSchema`; full analysis artifact persisted under `.impactgraph/artifacts/analyses/`)_
- [x] Works without any AI provider in deterministic-only mode, with reduced interpretation (§8). _(the only mode wired today; spec versions reused when the file is unchanged)_

**Tasks**

- [x] Wire specification engine (Epic 05) + impact engine (Epic 06) into `analyze`.
- [x] Implement human-readable report renderer per §46 example.
- [x] End-to-end test on reference repository: at least one relevant dependency not named in the spec is surfaced (§46 acceptance). _(BaseService surfaced from a spec that only names DealService)_

## Story 4.4 — `approve`, `export`, `review`

**Acceptance criteria**

- [x] `approve` marks an analysis version immutable/approved (§13). _(`impactgraph approve <analysisId>` — status transition only; the store rejects any other change)_
- [x] `export --analysis <id> --format markdown|json` emits the implementation context (Epic 10). _(`impactgraph export [analysisId] --format json|markdown|text`; analysis id is positional, defaults to the latest approved)_
- [x] `review --working-tree` and `review --commit HEAD` compare approved analysis vs. actual changes and set the discrepancy exit code (§20, §23.2). _(`impactgraph review [working-tree|commit]`; commit ranges are post-MVP per §23.3)_

**Tasks**

- [x] Implement approval workflow commands over analysis storage.
- [x] Wire export engine and review engine into CLI.
- [x] CI-mode test: review with discrepancies returns the documented exit code. _(exit 3 asserted in `apps/cli/src/review.test.ts`)_

## Story 4.5 — `impactgraph graph` (headless visual surface)

**Goal:** A CLI-only user can SEE their architecture. Before this, the only visual surface was the
extension webview, reachable only through an Extension Development Host.

**Acceptance criteria**

- [x] `impactgraph graph` writes a self-contained local HTML file (default `./impactgraph-graph.html`, `--out <file>` to redirect), and `--format json` emits the same view as contract-validated data (`cliGraphOutputSchema`). _(`--format json` alone writes nothing; pass `--out` to do both)_
- [x] The file references nothing remote: no CDN script, no web font, no external stylesheet, no image URL — and contains no JavaScript at all. The diagram is inline SVG, which browsers zoom and pan natively. _(asserted in `apps/cli/src/graph.test.ts`: no `http://`/`https://`/`//`, no `<script`/`<link`/`<img`, no `@import`/`@font-face`, no inline event handler, and every `url(...)` is a same-document `#fragment`)_
- [x] The file contains no source content: names, types, repository-relative paths, provenance and counts only — never a line of code, never an evidence excerpt, never an absolute path. It is safe to attach to a ticket. _(§35)_
- [x] Layout is deterministic — re-exporting an unchanged graph is byte-identical, and a committed golden makes layout drift a reviewed diff. _(`apps/cli/src/goldens/graph-export.monorepo.html.txt`; regenerate with `UPDATE_GOLDENS=graph-export`)_
- [x] The §33 budget is reused, not reinvented: at most `MAX_VISIBLE_NODES` (200, the same constant the webview enforces) drawn boxes, with truncation stated in words and both numbers. Nothing is silently dropped — every group reports its full node count. _(§33/§43.1)_
- [x] The three knowledge categories are distinguishable without colour: shape, border stroke, arrowhead shape and a spelled-out text badge. Edge direction is an arrowhead, not a colour. A legend is on the page. _(§3/§37; the whole export is greyscale so nothing can be read by hue alone)_
- [x] The diagram is never the only access path: groups, relationships and component nodes are each listed in an HTML table, with a skip link, `role="img"` labelling and captions. _(§37 tree parity)_
- [x] `--group context|application|package` selects the §18.4 grouping; `context` is the default and falls back to the owning application, labelled as such rather than inventing a context (§Z5).
- [x] Reachable over MCP as `export_graph_html`, returning the written path plus real counts (nodes shown/total, groups, byte size) so an agent can report what it produced without reading the file back. Tool-supplied paths are confined to the workspace. _(roster 39 → 40)_

**Tasks**

- [x] `packages/workspace-engine/src/reports/graph-view*.ts` — the architecture read model (groups, aggregated inter-group edges, budget) built from `loadCurrentGraph` + `contextsForGraph`/`applicationsForGraph`. No new engine query functions.
- [x] `graph-layout.ts` (deterministic layered layout), `graph-svg.ts`, `graph-style.ts`, `graph-html*.ts` — split by responsibility, each under the LOC budget.
- [x] `graph-file.ts` — the one place the file is written, shared by the CLI and the MCP tool; `allowOutsideRoot` distinguishes a human's `--out` from a tool-supplied path.
- [x] `contracts/cli/graph-export.ts` + `contracts/tools/graph-export-tools.ts`; JSON Schemas regenerated.
- [x] Tests: privacy assertions, budget announcement, golden, byte-identical re-export, three-category rendering (`apps/cli/src/graph{,-export}.test.ts`, `apps/mcp-server/src/registry-graph-flow.ts`).

## Story 4.6 — `impactgraph graph --analysis` (headless impact view)

**Goal:** A user can SEE a specification's blast radius. Story 4.5 gave the architecture a headless
visual surface; an impact analysis still had none outside the extension webview, which is gated
behind a `.vsix`. This is a second **view source** feeding the same renderer, not a second renderer.

**Acceptance criteria**

- [x] `impactgraph graph --analysis <analysisId>` writes the same kind of self-contained local HTML file (default `./impactgraph-impact.html`, so the two views never overwrite each other), and `--format json` emits the same view as contract-validated data. With no `--analysis`, behaviour is byte-for-byte what it was.
- [x] An unknown analysis id is a typed `configurationError` that **names the available ids**, rather than failing blankly. _(`--analysis` with no value is also rejected, instead of swallowing the next flag)_
- [x] Impacted components are grouped the way the architecture view groups (context / application / package), via the **same** `groupingForGraph` — an impact view that grouped differently would be answering a different question.
- [x] **Likelihood is the primary signal and reads without colour**: a four-segment meter whose filled count is the encoding, the spelled-out word, and the fraction (`REQUIRED 4/4`). Confidence is text to two decimals; impact type is text. _(§13/§37)_
- [x] **Provenance stays a separate reading** (§3): border shape, dash pattern and `FACT`/`INFERRED`/`CONFIRMED` badge. Likelihood and provenance never share a channel, so three identically-likely impacts with three different provenances are still three visibly different boxes.
- [x] **Requirement attribution** for every requirement in the specification, including those that produced no impacts — and the coverage gap is stated in words on the page and in the terminal.
- [x] **Hop counts** on every impact, with the dependency path spelled out hop by hop and each hop resolved back to the real graph edge type (looked up in both directions, since a traversal walks `symbol → file` over an edge stored as `file CONTAINS symbol`). An unresolvable hop reads `unknown`, never "deterministic". _(§43.6)_
- [x] **§14 contributing signals** published with every confidence score, with signed contributions.
- [x] **Current vs proposed never merge** (§18.4): proposed relationships aggregate on a separate `status` key and are drawn with a long dash, a source-end marker no current edge draws, and `[PROPOSED]` in the label; proposed components get their own group and never enter a real bounded context.
- [x] **Absent data reads as absent** (§Z5): `(no context assigned)` / `(no application assigned)` / `(no package assigned)`, `NOT IN SNAPSHOT` for a node the analysis cites but the resolved graph lacks, `no impacts predicted`, `no human decision`.
- [x] **Staleness is stated, never silently refreshed** (§40.2/§40.3): names are resolved against the snapshot the analysis was BOUND to; a snapshot mismatch, a superseded specification version and a non-approved status each produce a notice.
- [x] The §33 budget is the shared one — strongest claims survive the cap, truncation is announced, and **every** impact stays in the Impacts table whether or not it was drawn.
- [x] Every Story 4.5 privacy assertion re-run over the impact document, which carries far more (requirement prose, explanations, paths, signals). Evidence is a **count**: evidence ids embed line ranges and are not published.
- [x] Reachable over MCP via the **existing** `export_graph_html` with an optional `analysisId` (roster stays 40), returning `view` plus the coverage numbers so an agent cannot report a blast radius while staying quiet about uncovered requirements. Tool-supplied paths stay confined on this path too.

**Tasks**

- [x] `graph-view-model.ts` gains a `kind` discriminant and an edge `status`; `graph-render-category.ts` and `graph-view-budget.ts` extracted so both view sources share the categories and the §33 budget without importing each other.
- [x] `graph-impact-{model,cells,edges,rows,view,style,source}.ts` — the impact read model and its loader. Assembly lives in `reports/`; no new engine query functions.
- [x] `graph-layout-rows.ts` extracted from `graph-layout.ts`; the view's `kind` selects a cell size and nothing else.
- [x] `graph-svg-impact.ts`, `graph-html-impact{,-tables}.ts`; the HTML shell picks a section set by `kind`.
- [x] `contracts/cli/impact-export.ts` (+ `graph-categories.ts` to keep the two schema modules acyclic); `export_graph_html` input/output extended; JSON Schemas regenerated.
- [x] Fixture builders in `packages/test-kit/src/impact-view-builders.ts`; tests in `apps/cli/src/graph-impact{,-encoding,-view}.test.ts` and `apps/mcp-server/src/registry-graph-flow.ts`.

**Dogfooding note.** Rendered against this repository's approved analysis
`analysis-spec-packaging-and-key-flow-v1-mscxv83j`: 125 impacts on 123 components across 14 context
groups, 8 direct and 117 indirect up to 2 hops, **4 of 10 requirements** producing impacts — and
**one requirement absorbing 102 of the 125**. The requirement table made both defects legible at a
glance, which is the argument for putting attribution before the impacts table rather than after it.
