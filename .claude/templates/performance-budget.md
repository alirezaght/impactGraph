# Performance Budget Report: <operation>

_Complete via `/review-performance` for any change touching a budgeted path (PRD §33). Claims
require measurement, not intuition (main skill §7). Reviewed by the performance-scalability agent._

- **Operation:** <e.g. initial index, incremental update, impact-tree generation, activation>
- **Budget (PRD §33):** <e.g. "initial index of 5,000 source files < 2 min" — product target, not
  a hard guarantee>
- **Change under measurement:** <PR / plan link>
- **Author / date:** <name> / <YYYY-MM-DD>

## Benchmark fixture used

- Fixture: <test-kit fixture name — file count, language mix, LOC scale>
- Why representative for this budget: <...>
- Machine: <CPU / RAM / OS — "typical development machine" comparability>

## Measurement method

- Command / harness: <exact command, e.g. `pnpm tsx <bench script>` or vitest bench>
- Runs: <n> (report median + p95, discard first warm-up run)
- What is timed: <start/stop boundaries — e.g. excludes process spawn, includes SQLite writes>
- Confounders controlled: <cold vs warm cache, watcher activity, provider disabled>

## Baseline numbers (before change)

| Metric                          | Median | p95   |
| ------------------------------- | ------ | ----- |
| <duration / peak RSS / DB size> | <...>  | <...> |

Baseline commit: <sha>

## Post-change numbers

| Metric | Median | p95   | Δ vs baseline |
| ------ | ------ | ----- | ------------- |
| <...>  | <...>  | <...> | <+/-%>        |

Change commit: <sha>

## Regression analysis

- Within budget: yes / no — <margin>
- Regression > ~5%: <explain cause; accepted because <...> | fix required>
- Cancellation still responds < 500 ms during this operation: <verified how>
- Extension host untouched (work stays in worker/child process): <verified how>

## Repository-size scaling notes

_How this operation behaves beyond the fixture: 5k → 20k+ files, monorepos (PRD §6.3, §32)._

- Expected complexity: <O(changed files) / O(nodes) / ...>
- Known cliff or memory growth: <none observed | describe + backlog link>
- Graph-view constraint respected (< 200 default visible nodes, progressive disclosure): <n/a | how>
