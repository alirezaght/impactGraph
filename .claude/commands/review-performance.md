---
description: Identify budget-relevant changes, require measurements on benchmark fixtures, compare against performance-budgets.md — regression blocks
argument-hint: <branch or diff to audit (default: working tree vs main)>
---

## Purpose

Have the **performance-scalability** agent decide whether a diff is budget-relevant (PRD §33),
demand real measurements on benchmark fixtures for anything that is, and compare results against
`docs/engineering/performance-budgets.md`. Performance claims require measurement, not intuition
(modular skill §7). A regression against a budget is **blocking**.

## Inputs

- `$ARGUMENTS` — branch or diff reference; default `git diff main...HEAD` plus working tree.
- `docs/engineering/performance-budgets.md`, `.claude/templates/performance-budget.md`,
  benchmark fixture repos in `packages/test-kit`.

## Preconditions

- `pnpm build` succeeds on the branch (measure built code, not ts-node overhead).
- Load `.claude/skills/performance-investigation/SKILL.md` and
  `impactgraph-modular-development` §7.

## Agent sequence

1. **performance-scalability** (primary) — relevance triage, measurement design, verdict.
2. **repository-intelligence** (collaborating) — indexing/incremental-update measurements.
3. **graph-webview** (collaborating) — graph rendering and node-count behavior.
4. **vscode-integration** (collaborating) — activation-time and extension-host measurements.

## Skills used

- `performance-investigation` (primary), `impactgraph-modular-development` §7.

## Steps

1. **Triage relevance.** Delegate to **performance-scalability**: map each diff area to the PRD
   §33 budgets it can affect —
   - extension activation < 500 ms (and: zero indexing in the extension host — a structural check,
     not a timing one);
   - incremental update < 3 s;
   - initial index of 5,000 files < 2 min;
   - impact-tree first results < 15 s pre-indexed;
   - graph view default < 200 visible nodes (progressive disclosure beyond);
   - cancellation response < 500 ms.
     If nothing maps, report "not budget-relevant" with reasoning per area and end.
2. **Design measurements.** For each relevant budget, specify: benchmark fixture (which test-kit
   repo, file count), command or harness to run, iterations/warm-up, machine caveat (budgets are
   product targets on a typical dev machine, PRD §33 — record hardware with the numbers).
3. **Measure on both sides.** Run the harness on `main` and on the branch; same fixture, same
   machine, same session. No baseline number = no comparison = the review cannot pass for that
   budget.
4. **Structural checks** (no timing needed, still blocking): indexing stays in a worker/child
   process, never the extension host; long-running paths keep their cancellation tokens; graph
   default node limit unchanged unless the diff intends it; a failed index still preserves the
   previous valid index (PRD §34).
5. **Compare and record.** Fill `.claude/templates/performance-budget.md` where a new budget or a
   changed budget-relevant surface is introduced; otherwise attach the numbers to the findings. If
   `docs/engineering/performance-budgets.md` needs a new entry, propose the doc edit in the same
   change.
6. Report per-budget: baseline, branch result, budget, delta, verdict.

## Required outputs

- Relevance verdict per PRD §33 area (with reasoning for "not relevant").
- Measurement table: fixture, method, baseline (main), branch, budget, delta.
- Structural-check results (worker-process, cancellation, node limit, index preservation).
- Verdict: **within budget** / **regression — BLOCKING** / **budget change proposed**.

## Stop conditions

- Regression against any budget in `docs/engineering/performance-budgets.md` → blocking; the
  branch does not proceed to `/run-quality-gates` sign-off until fixed or the budget is formally
  changed.
- A budget change is proposed → stop; that requires a `docs/engineering/performance-budgets.md`
  edit + human approval (and `/create-adr` if it alters a product target's interpretation).
- No suitable benchmark fixture exists → stop and create one in `packages/test-kit` first;
  never "measure" on an unpinned repository.

## Human-review points

- Any budget change or accepted regression is a human decision, with the measurement table in
  front of them. Numbers, not adjectives.

## Completion criteria

- Every relevant budget has baseline + branch measurements; structural checks done; verdict
  delivered; no unresolved blocking regression.
