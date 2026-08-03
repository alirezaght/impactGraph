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
