# Epic 11 — Git Review Engine

**Goal:** Compare an approved analysis snapshot against the actual implementation (working tree / commit) at symbol and architecture level, and report matched, missing, unexpected, divergent, unverifiable and accepted-deviation results plus requirement coverage.
**Spec:** §10.5, §23, §24, §25, §38.2, §40.5, Epic I (§45), §44 Phase 6
**Phase:** 6 · **Depends on:** Epics 02, 06 (and 08 for rule checks)

---

## Story 11.1 — Diff parsing & changed-graph reconstruction

**Acceptance criteria**

- [x] Working-tree-vs-commit and current-commit diffs are parsed into changed files (§23.2). _(`GitPort.readWorkingTreeDiff`/`readCommitDiff`; NUL-safe `--name-status -z --find-renames`, renames are ONE change, untracked files included)_
- [x] Affected graph fragments are rebuilt via `LanguageAdapter.analyzeDiff` (§30): changed/added/removed symbols, changed imports and calls, routes, data models, migrations, tests (§24). _(`analyzeDiff` now exists for real and is golden-tested — see Tasks below. The review pipeline itself still reaches the same delta through an incremental reindex of the review state; wiring it onto `analyzeDiff` is an open follow-up in workspace-engine.)_
- [x] Architectural edge changes (new/removed edges) are computed against the approved snapshot's graph. _(edge add/remove restricted to changed files, capped at 50 each)_

**Tasks**

- [x] Implement Git diff reader (no repo code execution). _(`packages/git/src/diff-parsing.ts`; hostile-filename safe)_
- [x] Implement `analyzeDiff` for the TS/JS adapter. _(`packages/language-adapters/src/diff/*` — real symbol-level implementation: re-parses the NEW content of changed files with the adapter's own `indexFiles` (no second parser), fingerprints symbols from their `symbol-declaration` evidence range, and reports per-file added/removed/changed symbols, added/removed imports, `removedNodeIds`/`removedEdgeIds`, and wholesale removal for deleted files. A rename is ONE change (`previousPath`), never delete+add. Binary content, extensions outside `supportedExtensions`, and missing baseline content are reported as `symbolLevel: false` + `unverifiableReason` (§24 Unverifiable), never guessed; unparseable content degrades to a warning. Shared by the Prisma and fallback adapters too. Goldens in `src/diff/analyze-diff.test.ts` (13 tests). **Follow-up (not done here): the review pipeline in `packages/workspace-engine/src/review.ts` still uses the reindex-based delta — switching it to call `adapter.analyzeDiff` (and supplying `previousFiles` from `git show <baseline>:<path>`) is a separate task in workspace-engine/`packages/git` territory.**)_
- [x] Implement graph-delta computation (nodes/edges added/removed/modified). _(node presence + edge diff between approved and review snapshots)_
- [x] Golden tests: sample diffs → expected change sets (§42.3). _(git adapter tests: modified/untracked/deleted/renamed/commit-diff; plus `analyzeDiff` goldens in `packages/language-adapters/src/diff/analyze-diff.test.ts` — literal `GitDiff` in, expected `GraphChangeSet` out, covering added/modified/deleted/renamed, binary, unsupported-extension, missing-baseline, unparseable, and determinism)_

## Story 11.2 — Expected-vs-actual comparison

**Acceptance criteria**

- [x] Every result is categorized per §24.1: Matched, Missing (required impact unchanged with no explanation), Unexpected (changed but not in approved analysis), Divergent (changed differently than expected), Unverifiable. _(`compareImplementation` in `application/src/review-implementation/`; rejected impacts are excluded so their files surface as Unexpected)_
- [x] Comparison is symbol-level where supported, not just filenames (§24, §40.5). _(predicted symbol nodes checked for presence in the review graph; a removed symbol in a changed file is Divergent, not Matched)_
- [x] Missing required impacts are highlighted (§40.5). _(unchanged likely/possible impacts are NOT findings — only required ones go Missing)_
- [x] Users can mark a discrepancy as Accepted deviation with a recorded reason (§24.1). _(`impactgraph review accept <nodeId> "<reason>" [category]` + MCP `accept_review_deviation`; the report marks the finding with its reason and fills the §38.2 Accepted Deviations section. VS Code UI path still open — epic 09)_

**Tasks**

- [x] Implement matcher between approved `RequirementImpact`s and graph delta.
- [x] Implement divergence heuristics (expected change type vs. observed change type). _(current heuristic: removed-when-in-place-change-expected; richer change-type comparison open)_
- [x] Implement accepted-deviation records. _(reviews now persist as versioned artifacts under `.impactgraph/artifacts/reviews/`; `acceptDeviation` appends a decision — the review document is immutable, findings are never rewritten or recategorized, and a re-run review is a NEW artifact that does not inherit acceptance)_
- [x] Golden tests per category. _(compare-implementation.test.ts covers all five automatic categories + rename + rejected-decision cases)_

## Story 11.3 — Requirement coverage estimation

**Acceptance criteria**

- [x] Actual changes map back to requirements with per-requirement status (implemented / partially implemented / not found / unclear) and evidence lines, in the §25 example shape. _(`estimateCoverage`; ✓/✕/? markers per line)_
- [x] Coverage is explicitly presented as an estimate, never a proof (§25). _(section title and JSON docs say "estimate"; status derived only from findings)_
- [x] Architecture rule violations from Epic 08 are evaluated against the delta and included (§38.2). _(no longer blocked — `evaluateConfiguredRules` runs inside `runReviewPipeline` with `restrictToPaths` set to the review's changed files, so only the delta is judged; violations land in the §38.2 JSON and Markdown reports)_

**Tasks**

- [x] Implement change → requirement attribution (via impacted nodes + concept matching). _(via the approved impacts' requirementId — concept re-matching of unexpected changes open)_
- [x] Implement coverage status logic + evidence rendering.
- [x] Run rule evaluator on the delta; attach violations with evidence. _(both rule shapes evaluated: accompanying-change over the changed-file set and dependency-direction over the current graph restricted to changed paths; each violation carries ruleId, message, file paths and the offending edgeId — asserted end to end in apps/cli/src/review.test.ts (schema-change-without-migration fires, satisfied case is empty))_
- [x] Fixture test replicating the §25 example. _(coverage assertions in application + CLI e2e tests)_

## Story 11.4 — Review view & report export

**Acceptance criteria**

- [x] Review view shows all §18.7 items: approved expected impact, actual changed components, matches, missing, unexpected, new/removed edges, requirement-coverage warnings, test/infrastructure/migration discrepancies, overall status. _(Review tree: overall status, findings by category with file navigation, coverage estimates, rule violations; edge-change and test/migration/infra subsections still render in the report only)_
- [x] `Review Implementation / Review Working Tree / Review Current Commit / Open Review Report` commands work (§19); CLI `review` sets discrepancy exit codes (§20). _(CLI + extension commands done; review runs in the bundled engine worker, report opens as §38.2 markdown)_
- [x] Review report exports as Markdown and JSON with the §38.2 sections (§40.5). _(`--format markdown|json`; `cliReviewOutputSchema` v1 committed)_

**Tasks**

- [x] Build review tree view + status summary. _(`views/review-tree.ts` over the versioned review document; unit-tested mapping)_
- [x] Implement report renderers (Markdown + JSON, §38.2 section order). _(rule-violation and test/migration/infra subsections arrive with Epics 08/language-adapter work)_
- [x] Wire commands + CLI. _(CLI only; review artifacts are not yet persisted — report is emitted, persistence of reviews is an open follow-up)_
- [x] Integration test: full loop — approve analysis, make changes on fixture, review, export. _(`apps/cli/src/review.test.ts`: init→index→analyze→approve→modify→review, incl. markdown export and exit codes)_
