---
name: production-debugging
description: Use when investigating a bug report, field failure, wrong analysis result, crash, or unexplained behavior in ImpactGraph itself — indexing failures, provider errors, schema validation rejections, stale or corrupt state, extension misbehavior. Covers CLI-first reproduction, fixture minimization, artifact and SQLite inspection, log reading, and failure taxonomy. Triggers on bug reports, "works on my machine", flaky analyses, and discrepancy investigations.
---

# Production Debugging (Debugging ImpactGraph Itself)

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md`. Follow
`superpowers:systematic-debugging` for the method: reproduce → isolate → root cause → then fix.
No fix before a root cause; no root cause without a reproduction.

## Purpose

Diagnose defects in ImpactGraph the product — wrong impacts, failed indexes, rejected AI output,
broken commands — using the system's own evidence trail (artifacts, index, logs, IDs) without
destroying the user's state.

## When to use

A user/field report or CI failure whose cause is unknown: wrong or missing impacts, index
failures, `impactgraph review` discrepancies that look like bugs, provider errors, config
validation rejections, extension crashes or hangs, corrupt-looking state.

## When NOT to use

- Known cause, writing the fix → the owning package's skill + `superpowers:test-driven-development`.
- "It's slow" with no wrong behavior → `performance-investigation`.
- Designing recovery behavior (quarantine, rebuild) → `local-artifact-persistence`.

## Required context

PRD §20 (CLI + exit-code taxonomy), §28 (where state lives), §32/§34 (indexing + reliability
guarantees being violated), §42.2–42.4 (fixture and integration testing);
`docs/engineering/testing-strategy.md`; `packages/test-kit` fixture repos.

## The method

### 1. Reproduce via CLI first — headless beats extension debugging

The CLI, MCP server, and extension share one core (PRD §20, §29). Reduce every report to a CLI
invocation before touching Electron:

```
impactgraph index                       # does indexing itself fail?
impactgraph status                      # index/snapshot state
impactgraph analyze spec.md --format json
impactgraph review --working-tree
impactgraph config history / config diff
```

Exit codes are the first diagnostic (PRD §20): configuration error vs indexing failure vs
provider failure vs unsupported project vs review-discrepancies are _different bugs_. If the CLI
reproduces it, the extension shell is exonerated; if only the extension fails, the bug is in
`apps/vscode-extension` wiring (activation, progress, cancellation, message dispatch).

### 2. Classify the failure before hypothesizing

- **Indexing failure**: deterministic layer — parser/adapter/git/SQLite. Reproducible offline,
  no provider involved. Check parser warnings recorded per §32.
- **Provider failure**: `packages/ai-inference` or the provider itself. Deterministic features
  must still work (main skill §8) — if they don't, that is a second, more serious bug.
- **Schema validation failure**: a boundary rejected a payload — AI output referencing
  nonexistent nodes (PRD §34, working as designed — verify before "fixing"), version mismatch,
  or a real contract regression. Compare `schemaVersion` in the record vs the reader.
- **State/staleness**: snapshot ID in the artifact vs current repository state.

### 3. Minimize on a fixture repo

Never debug against the user's repository longer than needed to characterize the failure. Build
or extend a minimal fixture in `packages/test-kit` that reproduces it, then shrink until removing
anything makes the bug vanish. That fixture becomes the regression test (golden test per
PRD §42.3). Never use the ImpactGraph repo itself as the fixture (main skill §6).

### 4. Inspect state directly

- **JSON artifacts** (specs, analysis runs, approved models, reviews, audit history): read the
  files; every record carries provenance, evidence IDs, confidence, snapshot ID, spec version,
  analysis-run ID — follow the IDs across records to find where the chain breaks.
- **SQLite index**: open read-only (`sqlite3 'file:…?mode=ro'`) — inspect nodes/edges/symbols/
  file-hash tables; `PRAGMA quick_check` for corruption. The index is a disposable cache
  (ADR-0006): a rebuild that fixes the symptom proves a _stale/corrupt index_ bug, it does not
  close the investigation — find why it went bad.
- **Config**: `.impactgraph/*.yml` + audit history (`impactgraph config history`) tell you what
  changed, when, by which agent, and why (PRD §Z12).

### 5. Read logs structurally

The logging port never contains source code or secrets (main skill §7, PRD §34/§35) —
**by design you debug with IDs and structure**: run IDs, snapshot IDs, evidence IDs, node IDs,
error codes, durations. If a log line would only be useful with the file contents inlined, the
correct fix is a better ID/error-code, never logging the source. Extension-side: extension host
OutputChannel and the worker/child-process logs are separate streams — a missing worker log with
a healthy host log localizes the failure to process spawn/IPC.

### 6. Pin it with a test, then fix

Encode the reproduction as the failing test at the right layer: fixture-repo analyzer test
(`analyzers` project), contract fixture (`contract`), use-case test with fakes (`application`),
or an `@vscode/test-electron` repro for shell-only bugs (activation, cancellation, message
routing). Then fix in the owning package with its skill loaded.

## Hard rules

- **Never "fix" by deleting user artifacts or history.** Analysis runs, approved models,
  reviews, and audit history are append-only records (main skill §3). `ImpactGraph: Clear Local
Cache` clears the disposable index only — recommending users delete `.impactgraph/` or
  artifact stores destroys the evidence and the product's value. Corrupt data is quarantined and
  reported, never silently removed.
- Never conclude "the model was wrong" without checking the deterministic candidates and stored
  confidence factors first — provider inconsistency is mitigated by bounded candidate sets
  (PRD §43.5); a bad impact usually has a deterministic cause upstream.
- A workaround without a root cause is a documented open bug, not a resolution.

## Common failure modes

- Debugging inside Electron for a core-engine bug the CLI reproduces in seconds.
- Rebuilding the index, symptom gone, ticket closed — the corruption cause ships to every user.
- Treating a schema rejection of hallucinated nodes as a bug and loosening the schema.
- Reading logs expecting source snippets and adding source-leaking log lines "temporarily".
- Reproducing on the user's monorepo for days instead of minimizing to a 10-file fixture.
- Fixing in the extension shell what is actually an application-layer defect (mask, not fix).

## Checklist

- [ ] Reproduced headlessly via CLI (or shell-only nature proven by CLI passing)
- [ ] Failure classified: indexing / provider / schema-validation / state / shell
- [ ] Minimal fixture repo in `packages/test-kit` reproduces it
- [ ] State inspected via artifacts + read-only SQLite; ID chain followed to the break
- [ ] Root cause written down before any fix; failing test pinned at the right layer
- [ ] No user artifact/history deleted; recovery path (if touched) reviewed via persistence skill
- [ ] Fix merged with the regression test; `pnpm quality:gates` green

## Definition of done

The root cause is stated and demonstrated by a minimized fixture; a regression test at the
correct layer fails before and passes after the fix; user state and history survive intact; and
the failure class is now easier to diagnose next time (better error code or ID, if warranted).
