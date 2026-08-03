---
description: Run pnpm quality:gates plus targeted suites, interpret failures, route each to the owning agent — never weaken a gate to pass
argument-hint: <optional: extra suites to include, e.g. "analyzers webview vscode">
---

## Purpose

Run the blocking local quality gates, plus targeted suites relevant to the current change, and
turn raw failures into routed, owned fixes. The gates are the contract in
`docs/engineering/quality-gates.md`; this command executes and interprets — it never edits a gate,
threshold, config, or exception file to get to green.

## Inputs

- `$ARGUMENTS` — optional extra suites beyond the default set (`analyzers`, `webview`, `vscode`).
- The current working tree/branch.

## Preconditions

- Dependencies installed (`pnpm install --frozen-lockfile` clean).
- Load `.claude/skills/impactgraph-modular-development/SKILL.md` §10.

## Agent sequence

No agent runs the gates — this command runs them directly. Agents receive routed failures:

| Failure source                               | Route to                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format:check`, `lint` style rules           | fix inline (mechanical), no delegation                                                                                                                                  |
| `lint` boundaries (eslint-plugin-boundaries) | product-architecture                                                                                                                                                    |
| `quality:loc`                                | owning agent of the file, with `testing-quality`; exceptions via `.claude/templates/loc-exception.md` + human approval — splitting by responsibility is the default fix |
| `typecheck`                                  | owning agent of the package                                                                                                                                             |
| `test:unit` (domain)                         | domain-provenance (knowledge records) or owning domain-area agent                                                                                                       |
| `test:application`                           | owning use-case agent (impact-modeling, specification-intelligence, implementation-review, …)                                                                           |
| `test:contract`                              | boundary owner per the `/review-contracts` table                                                                                                                        |
| `test:quality`                               | testing-quality (the LOC checker's own tests)                                                                                                                           |
| `test:analyzers`                             | language-adapter / repository-intelligence                                                                                                                              |
| `test:webview`                               | graph-webview                                                                                                                                                           |
| `test:integration:vscode`                    | vscode-integration                                                                                                                                                      |
| secret-scan (`quality:secrets`)              | ai-inference-privacy — treat as a possible real leak first                                                                                                              |

## Skills used

- `impactgraph-modular-development` §10; `production-debugging` for failures that only reproduce
  in integration lanes.

## Steps

1. Run the aggregate gate:
   ```
   pnpm quality:gates
   ```
   (= `format:check`, `lint`, `quality:loc`, `typecheck`, `test:unit`, `test:application`,
   `test:contract`, `test:quality`.) Capture full output; do not stop at the first failure —
   collect all gate results so routing happens once.
2. Run targeted suites for the change (and any listed in `$ARGUMENTS`):
   - analyzer/adapter changes → `pnpm test:analyzers`
   - webview changes → `pnpm test:webview`
   - extension shell changes → `pnpm test:integration:vscode`
   - secret-sensitive changes → `pnpm quality:secrets`
3. Interpret each failure: identify the failing gate, the file(s), and the likely cause class
   (real defect / stale golden fixture / missing version bump / boundary violation / genuine LOC
   overflow). Never blame flakiness without a reproduced pass/fail flip.
4. Route each failure to its owning agent (table above) via the Agent tool with the exact output
   excerpt and file paths. Fixes land as normal commits; blind fixture regeneration and test
   deletion are not fixes (modular skill §6).
5. Re-run the affected gate after each fix; finish with one full clean `pnpm quality:gates` run.
6. Report per-gate status.

## Required outputs

- Per-gate status table: gate → pass/fail → (if failed) routed agent, cause class, resolution.
- The final full-run confirmation (all green) or the explicit list of what still blocks.

## Stop conditions

- **Never weaken a gate**: no editing `eslint.config.mjs` rules, LOC limits,
  `scripts/quality/loc-exceptions.json`, vitest configs, or skipping/`.only`-ing tests to pass.
  If a gate itself is wrong, stop and route: boundaries config → `/architecture-review`; LOC
  exception → template + human approval; flaky infrastructure → testing-quality with evidence.
- `quality:secrets` hit → stop everything; ai-inference-privacy assesses whether a real secret
  was committed before any other work continues.

## Human-review points

- Any proposed gate/config/exception change (including LOC exceptions) — human approval before it
  is committed.
- A red gate that will be "fixed later" is not a thing; the human decides only between fixing now
  and abandoning the change.

## Completion criteria

- One uninterrupted `pnpm quality:gates` run fully green, plus the targeted suites for this change
  green; status table delivered; zero gate definitions modified.
