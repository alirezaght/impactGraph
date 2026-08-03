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
