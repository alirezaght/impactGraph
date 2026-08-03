---
name: repository-analysis-development
description: Use when building or changing packages/repository-intelligence — workspace/package/entry-point discovery, the incremental hashing indexer, snapshot binding, cancellation and partial-progress persistence, index status reporting, or graceful degradation for unsupported files. Load for any change to how deterministic repository facts are produced.
---

# Repository Analysis Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill covers `packages/repository-intelligence` (the Repository Intelligence Engine, PRD
§C15.1), owned by the `repository-intelligence` agent. Per-language parsing belongs to
`language-adapter-development`; this package orchestrates discovery, indexing, and the shared
Repository Knowledge Graph construction.

## Purpose

Produce the deterministic half of ImpactGraph: discover what the repository _is_ (workspaces,
packages, source/test roots, entry points, imports, symbols, routes, data models, migrations,
jobs, environment configuration, infrastructure files — PRD §15.1) and keep the SQLite index
incrementally up to date (PRD §32) without ever executing repository code.

## When to use

- Workspace scanning, ignore handling, file hashing, incremental re-indexing (backlog Epic A).
- Snapshot binding, index status reporting, parser-warning collection.
- Architecture inference (§15.3): candidate contexts, module roles, circular dependencies —
  always labeled inferred.
- Orchestrating language/framework adapters into one graph build.

## When NOT to use

- Writing a parser or framework detector (→ `language-adapter-development`).
- SQLite schema or artifact formats (→ `local-artifact-persistence`).
- Anything that interprets a specification or predicts impact (→ `specification-analysis-development`,
  `impact-model-development`).

## Required context

1. PRD §15 (discovery scope), §32 (indexing requirements), §34 (reliability), §23.1 (snapshot
   fields), §33 (performance budgets).
2. `docs/engineering/repository-analysis.md`, ADR-0006 (SQLite index is a disposable cache),
   ADR-0008 (parser strategy).
3. `.claude/templates/repository-analyzer-proposal.md` for any new discovery capability.

## Expected outputs

- Discovery/indexing services in `packages/repository-intelligence` implementing application
  ports; graph writes go through the persistence port, never raw SQLite here.
- Every emitted node/edge carries deterministic provenance (`static-analysis`, `configuration`,
  `framework-convention`, `git-history`) plus evidence IDs and the snapshot ID it was built from.
- Fixture-backed golden tests in the `analyzers` Vitest project.

## Architectural rules

- Indexing never runs in the VS Code extension host (PRD §33): design every entry point to run in
  a worker/child process; the package must not import `vscode`.
- The index is a disposable cache (ADR-0006): any code path must survive `impactgraph index`
  rebuilding from scratch. Human-confirmed knowledge is _never_ stored only in the index.
- Every long-running operation takes a cancellation token, responds within ~500 ms, reports
  progress, and persists partial progress safely (PRD §32).
- A failed or cancelled index must never destroy the previous valid index (PRD §34) — build into
  a staging state and swap atomically.
- The index is tied to a repository snapshot (repository identity, branch, commit, dirty status,
  index version, timestamp — PRD §23.1); nodes without a snapshot ID are a bug.

## Domain rules

- Discovery emits only deterministic facts into the shared graph using the PRD §12 vocabulary:
  `CONTAINS`, `IMPORTS`, `CALLS`, `EXPOSES`, `MIGRATES`, `CONFIGURES`, `DEPLOYED_AS`, etc.
  Nothing from this package may carry `llm-inferred` provenance.
- Architecture inference (§15.3 — potential contexts, service boundaries, high coupling) is a
  separate output labeled inferred and surfaced for confirmation; it never overwrites
  human-confirmed context assignments from `.impactgraph/architecture.yml` (§43.3).
- Incremental indexing: hash files, re-index only changed files, and remove graph fragments owned
  by deleted files. A file's fragments are replaced wholesale — no orphan edges.
- Parser failure on one file records a warning and continues (PRD §32/§34); unsupported files and
  frameworks are reported clearly, and analysis proceeds with partial language support. Graceful
  degradation is a feature, not an error state.

## Security & privacy rules

- **Never execute repository code** (PRD §35): no `npm run`, no `terraform plan`, no importing a
  repo module to inspect it. Configuration and Terraform are parsed, not run.
- Respect ignore rules and `.env` exclusion during scanning; symlinks must not escape the
  workspace root; oversized files are skipped with a recorded warning (PRD §42.5).
- Logs and parser warnings never contain full source files or secrets (logging port only).
- Deterministic discovery requires zero network access — if a change adds any network call here,
  stop and run `/review-privacy`.

## Testing requirements

- Vitest `analyzers` project (`pnpm test:analyzers`); fixture repositories live in
  `packages/test-kit` (Express, NestJS, monorepo, migration workflow — PRD §42.2). Never use the
  ImpactGraph repo itself as the primary fixture.
- Golden tests pin expected nodes/edges per fixture (PRD §42.3); update goldens deliberately with
  a diff review, never regenerate blindly.
- Incremental behavior needs dedicated tests: touch one file → only its fragments change; delete
  a file → its nodes/edges disappear; cancel mid-index → previous index intact.
- Performance-sensitive changes (hashing, traversal) need measurement via
  `/review-performance` against the §33 budgets (5,000 files < 2 min, incremental < 3 s).

## Common failure modes

- Indexer accidentally wired to run in the extension host process (activation budget blown).
- Hashing skipped or hash stored after write, so every save triggers a full re-index.
- One parser exception aborts the whole index run instead of recording a warning for that file.
- Discovery output written with missing or `llm-inferred` provenance "temporarily".
- Partial/failed index swapped over the previous valid index; cancellation leaves a corrupt
  half-written state.
- Re-index silently discards human corrections from `.impactgraph/` (Epic D: protect human
  corrections during reindex).
- "Detecting" framework config by executing it (running a JS config file, `terraform init`).

## Checklist

- [ ] New discovery capability has a `repository-analyzer-proposal.md` and a PRD §15 anchor
- [ ] Cancellation token plumbed; partial progress safe; previous index preserved on failure
- [ ] Snapshot ID + deterministic provenance + evidence on every emitted node/edge
- [ ] Ignore rules, symlink containment, oversized-file handling covered by tests
- [ ] Golden fixtures updated deliberately; incremental tests pass; `pnpm test:analyzers` green
- [ ] No `vscode` import, no code execution, no network; `pnpm quality:gates` green

## Definition of done

Main-skill definition of done, plus: the fixture goldens prove the discovery claim, an
interrupted or failing index demonstrably leaves the previous index usable, and index status
reporting reflects reality (files indexed, skipped, warned) for the new capability.
