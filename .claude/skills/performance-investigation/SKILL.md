---
name: performance-investigation
description: Use when something in ImpactGraph is slow, memory-heavy, or misses a PRD §33 budget — activation time, indexing duration, incremental updates, impact-tree latency, graph rendering, cancellation lag. Covers benchmark fixtures, before/after measurement, worker profiling, SQLite query analysis, and render performance. Triggers on "slow", budget regressions, profiling requests, and /review-performance findings.
---

# Performance Investigation

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md`. Owning agent:
`performance-scalability`. Findings feed `/review-performance` and
`.claude/templates/performance-budget.md`. Reference: `docs/engineering/performance-budgets.md`.

## Purpose

Turn "it feels slow" into a measured, attributed, budget-referenced finding — and verify every
optimization with before/after numbers on the same fixture. **No intuition-based claims** (main
skill §7): a performance statement without a measurement is not a finding.

## The budgets (PRD §33 — product targets, not hard guarantees)

- Extension activation **< 500 ms** without indexing
- **No indexing in the extension host process**
- Incremental update for a small change **< 3 s** where practical
- Initial index of **5,000 source files < 2 min** on a typical development machine
- Impact-tree first results **< 15 s** for a pre-indexed repository
- UI remains responsive during indexing
- Graph view defaults to **< 200 visible nodes**; large results use progressive disclosure
- Our own budget (main skill §7): cancellation takes effect **< 500 ms**

**A regression against any budget is a blocking finding** — it blocks the PR or release the same
way a failing gate does, until fixed or a budget change is agreed via ADR.

## When to use

Budget breach or suspicion; a `/review-performance` request; before/after validation of an
optimization; sizing questions ("will this survive the monorepo fixture?"); memory growth.

## When NOT to use

- Wrong _results_ → `production-debugging` (correctness first; never optimize a wrong answer).
- Writing the optimized code → the owning package's skill; this skill produces the evidence.
- Choosing budgets → ADR + `docs/engineering/performance-budgets.md`, not ad hoc.

## Required context

PRD §32 (indexer obligations), §33 (budgets), §43.1 (graph explosion);
`packages/test-kit` benchmark fixtures; `docs/engineering/performance-budgets.md`.

## Method

1. **Pick the fixture, not the anecdote.** Measure on the benchmark fixture repos in
   `packages/test-kit` — small, medium, large, and monorepo tiers — so numbers are comparable
   across machines and PRs. A user-repo report is first reproduced on the closest fixture tier.
2. **Measure BEFORE.** Record baseline numbers (median + p95 of ≥ 5 runs, warm and cold where
   relevant) with machine context. Commit the methodology in the finding.
3. **Attribute.** Profile the actual bottleneck; never guess:
   - **Node workers / child processes** (indexing, analysis): `node --cpu-prof` /
     `--heap-prof` on the worker entry point, inspect in Chrome DevTools or speedscope. The
     extension host stays out of scope by design — if host profiling shows engine work, that is
     an architecture violation (PRD §33), not a tuning target.
   - **SQLite**: `EXPLAIN QUERY PLAN` on hot queries; check index usage on nodes/edges/symbol
     lookups; batch writes in transactions; measure statement-level timings via better-sqlite3.
   - **Incremental indexing**: measure the **hit rate** — changed files vs re-indexed files vs
     total (file-hash based, PRD §32). A "slow incremental update" is usually a hit-rate bug
     (over-invalidation), not a parser problem. Report: files changed / files re-indexed /
     wall time.
   - **Graph rendering**: element count handed to Cytoscape, layout (fcose) time, and style
     recalculation — measured separately. Node count past the < 200 default means progressive
     disclosure failed upstream; fix that before tuning the renderer.
   - **Cancellation latency**: time from token cancellation to work actually stopping, per
     long-running use case; budget 500 ms. Measure at the checkpoint granularity.
4. **Change one thing. Measure AFTER** on the same fixture, same methodology. Report both
   numbers plus deltas; keep raw profiles attached to the PR or finding.
5. **Pin it.** Add or update a benchmark assertion where infrastructure allows (activation
   budget test in `@vscode/test-electron`; indexing duration bounds on fixture tiers in the
   `analyzers` project, generous enough for CI variance but tight enough to catch 2× regressions).

## Memory rules

- Track worker RSS/heap across the large and monorepo fixtures; the indexer must stream —
  never hold every parsed AST or the whole file set in memory (PRD §32: handle large monorepos).
- A memory ceiling breach (worker OOM or unbounded growth across incremental runs) is a blocking
  finding like any budget miss; capture `--heap-prof` evidence before and after.

## Security & privacy rules

Profiles and traces can embed file paths and source fragments — treat them like logs: attach to
internal PRs only, never to public issues or telemetry; scrub user-repo profiles, prefer
fixture-repo profiles as shareable evidence. Telemetry stays off by default (PRD §36); duration
_buckets_ are the only sanctioned metric if a user opted in.

## Testing requirements

- Every accepted optimization ships with its before/after table in the PR and, where feasible, a
  regression-guard test at the correct layer.
- Fixture-tier benchmarks run in CI slow lanes, not pre-commit (locked hooks — never in
  pre-commit).
- Optimizations must not change analyzer output: golden tests (PRD §42.3) green on all fixture
  tiers is part of the performance PR's evidence.

## Common failure modes

- "This should be faster now" with zero numbers — rejected on sight.
- Measuring on the developer's warm laptop against the user's cold monorepo — use fixture tiers.
- Optimizing parser speed when the profile shows SQLite write amplification (or vice versa).
- Fixing a slow graph by tuning Cytoscape while 3,000 elements are being handed to it.
- Caching that breaks incremental correctness — hit rate up, staleness bugs in; golden tests
  must stay green.
- Micro-benchmark wins that vanish end-to-end — always confirm on the full CLI path
  (`impactgraph index`, `impactgraph analyze spec.md`).
- Declaring victory at the median while p95 still misses the budget.

## Checklist

- [ ] Budget named and quoted (§33 or cancellation budget); regression classified as blocking
- [ ] Baseline measured on the right `packages/test-kit` fixture tier (≥ 5 runs, median + p95)
- [ ] Bottleneck attributed with a profile / query plan / hit-rate count — not a hunch
- [ ] One change at a time; after-numbers on identical methodology; delta reported
- [ ] Golden tests and correctness suites green — output unchanged
- [ ] Regression guard added where feasible; `docs/engineering/performance-budgets.md` updated
      if a budget interpretation changed (via ADR if the budget itself moves)
- [ ] Profiles from user repos scrubbed or replaced with fixture evidence

## Definition of done

The finding names the budget, shows attributed before/after measurements on shared fixtures,
changes nothing about analyzer correctness, and leaves behind either a guard against recurrence
or a written reason why one isn't feasible.
