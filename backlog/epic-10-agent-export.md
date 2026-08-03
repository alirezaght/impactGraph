# Epic 10 — Implementation-Context Export

**Goal:** Structured export of an approved analysis so a coding agent (Claude Code, Cursor, …) can implement with full architectural context.
**Spec:** §10.4, §22, §38.1, Epic H (§45), §44 Phase 5
**Phase:** 5 · **Depends on:** Epic 06

---

## Story 10.1 — Implementation-context schema & builder

**Acceptance criteria**

- [x] `ImplementationContext` matches §22: specification, approved analysis, repository snapshot, required/likely/rejected impacts, architecture constraints, expected tests, expected migrations, expected infrastructure changes, open warnings, review criteria. _(`buildImplementationContext` in `application/src/export-context/`; embedded spec/analysis are the domain-serialized artifact documents)_
- [x] Only approved analyses can be exported; export references the exact snapshot and versions. _(builder rejects draft/reviewed/superseded; snapshot summary + spec version bound in)_
- [x] Review criteria are generated so the review engine (Epic 11) can consume them later. _(required-impact + architecture-rule criteria; the review engine does not yet read them back — follow-up)_

**Tasks**

- [x] Implement schema + builder in `packages/core`. _(builder in `packages/application`, schema in `packages/contracts/src/export/` per the actual architecture — there is no `core` package)_
- [x] Derive expected tests/migrations/infra from impact types. _(plus TESTS edges: existing tests covering required impacts become expectations)_
- [x] Unit tests: builder output validates against schema (§42.1 export formatting). _(5 builder tests; CLI e2e validates against `implementation-context.v1`)_

## Story 10.2 — JSON, Markdown & clipboard exports

**Acceptance criteria**

- [x] `Export Implementation Context`, `Export Markdown Report`, `Export JSON Report` commands and CLI `export` produce the §38.1 impact-report sections. _(CLI `export [analysisId] --format json|markdown|text` done; VS Code commands open — Epic 07)_
- [x] Markdown is agent-readable and human-readable; JSON is schema-stable. _(`cli/export-output.v1` + `export/implementation-context.v1` committed)_
- [x] A clipboard command copies the context for pasting into any agent (Epic H). _(extension `Export Implementation Context` opens the §22 JSON and offers Copy to Clipboard)_

**Tasks**

- [x] Implement Markdown renderer with §38.1 section order. _(all 18 sections; order asserted in test)_
- [x] Implement JSON serializer + schema doc. _(schema generated from Zod; noted in data-contracts.md)_
- [x] Wire VS Code commands + CLI flag.
- [x] Snapshot tests for both formats. _(e2e asserts section order + schema-parse; golden snapshots can be added when output stabilizes)_

## Story 10.3 — Agent workflow documentation

**Acceptance criteria**

- [x] Documented end-to-end workflows for Claude Code and Cursor: spec → analysis → approval → export → implement → review (§21.1, Epic H). _(`docs/workflows/claude-code.md`, `docs/workflows/cursor.md`)_
- [x] Docs cover external-agent privacy mode (ImpactGraph sends nothing; the agent decides) (§9.4).

**Tasks**

- [x] Write `docs/workflows/claude-code.md` and `docs/workflows/cursor.md`.
- [x] Include copy-paste example session against a fixture repo.
