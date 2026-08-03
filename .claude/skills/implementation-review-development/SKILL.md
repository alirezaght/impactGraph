---
name: implementation-review-development
description: Use when building or changing the review engine or packages/git — working-tree/commit diff analysis, symbol-level comparison against an approved impact model, review result categories (Matched/Missing/Unexpected/Divergent/Unverifiable/Accepted deviation), requirement coverage estimation, or review report export.
---

# Implementation Review Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill covers the review half of the Impact & Review Engine (PRD §C15.3): review use cases in
`packages/application` and the Git CLI adapter in `packages/git` (ADR-0007). Owned by the
`implementation-review` agent; this is backlog Epic I.

## Purpose

Answer "did the implementation match the approved plan?" by comparing the approved
`ImpactAnalysis` snapshot against the actual working tree or commit — at symbol and architectural
level, not filename level — and reporting findings that a human judges (PRD §23–§25, §38.2).

## When to use

- Diff parsing, changed-file/symbol identification, affected graph-fragment rebuilds.
- Expected-vs-actual comparison, new/removed edge detection, drift detection.
- Requirement coverage estimation, review report generation and export.
- Anything in `packages/git`: snapshots, diffs, status, baselines.

## When NOT to use

- Producing the approved model itself (→ `impact-model-development`).
- Per-language symbol extraction from diffs (→ `language-adapter-development`, via
  `LanguageAdapter.analyzeDiff`).
- Review webview UI (→ `graph-webview-development` / `vscode-extension-development`).

## Required context

1. PRD §23 (snapshots + review targets), §24 (review logic + result categories), §25 (requirement
   coverage), §38.2 (review report sections), §40.5 (acceptance criteria).
2. ADR-0007 (Git CLI adapter), `docs/engineering/implementation-review.md`,
   `.claude/templates/implementation-review.md` for report structure.

## Expected outputs

- `packages/git`: a narrow adapter implementing application ports (snapshot, status, diff),
  returning typed results.
- Review use cases producing an append-only review report artifact bound to: approved analysis ID
  - version, repository snapshot (identity, branch, commit, dirty flag, index version, timestamp
    — PRD §23.1), and review target.
- Markdown + JSON export matching PRD §38.2 sections (summary, approved spec, matched, missing,
  unexpected, divergent, requirement coverage, rule violations, test/migration/infrastructure
  discrepancies, accepted deviations, follow-ups).

## Architectural rules — packages/git (ADR-0007)

- Git CLI invoked with **argument arrays only** — never shell interpolation, never string-built
  commands. Branch names, paths, and commit refs are attacker-controlled input; pathspecs are
  separated with `--`.
- Rename/copy detection enabled (`--find-renames`/`--find-copies`) so a moved file is one
  `renamed` change, not a false Missing + Unexpected pair.
- Explicit baselines (PRD §23.2): working tree vs current commit (`Review Working Tree`), and
  current commit snapshot (`Review Current Commit`). Commit ranges/branches/PRs are post-MVP —
  keep the port shaped so they can be added (PRD §23.3).
- Untracked files are part of a working-tree review (new components must surface as Unexpected);
  binary files are compared at file level and marked symbol-Unverifiable; submodule pointer
  changes are recorded as changes without recursing in the MVP.
- `git` is spawned nowhere outside `packages/git` (ESLint-enforced); no libgit2/isomorphic-git.

## Domain rules

- **Symbol-level, not file-level (PRD §24).** Compare changed files _and_ changed/added/removed
  symbols, imports, calls, routes, database models, migrations, events, Pub/Sub relationships
  (`PUBLISHES`/`SUBSCRIBES_TO` edges), Terraform resources, Cloud Run configuration, tests, and
  architectural edge changes — via adapter `analyzeDiff` fragments over the knowledge graph.
- Result categories (PRD §24.1) — use these exact meanings:
  - **Matched** — a predicted component changed consistently with the specification.
  - **Missing** — a `required` component did not change and no evidence explains why.
  - **Unexpected** — a component changed but was not in the approved analysis.
  - **Divergent** — a predicted component changed, but differently from the expected
    architectural direction.
  - **Unverifiable** — ImpactGraph cannot determine whether the requirement was implemented
    (unsupported language, binary, no symbol data). Say so; never guess.
  - **Accepted deviation** — the user approved a discrepancy and recorded a reason (append-only
    decision; the finding itself is not rewritten).
- **A discrepancy is never automatically a defect.** Findings are inputs to human judgment
  (PRD §43.6); the engine never fails a build by itself — CLI exit codes distinguish
  "discrepancies found" from errors (PRD §20) so humans/CI decide policy.
- Requirement coverage (PRD §25) maps actual changes back to requirements via `SATISFIES`
  evidence and is presented as an **estimate** with per-item ✓/✕/? evidence lines — never as
  proof of implementation.
- The review never mutates the approved analysis; comparisons run against the immutable approved
  version, and drift in the analysis itself (stale snapshot) is reported, not "fixed".

## Security & privacy rules

- Review is fully deterministic and offline — no model calls in the comparison path; any future
  AI-assisted explanation goes through `packages/ai-inference` and is labeled inferred.
- Diff content is repository content: untrusted (PRD §42.5). Hostile filenames (newlines,
  `-` prefixes) must not break parsing (`-z`/NUL-separated output, `--` separators).
- Logs and reports contain paths, symbols, and hunks metadata — never secrets; report export
  respects redaction rules before any excerpt is embedded.

## Testing requirements

- `packages/git` adapter: `analyzers` Vitest project against throwaway real git fixture repos
  from `packages/test-kit` (init/commit in temp dirs) — cover renames, untracked, binary, dirty
  tree, hostile filenames.
- Review use cases: `application` project with in-memory graph + fake git port; golden review
  results for sample diffs per fixture (PRD §42.3 — expected review results are part of every
  fixture).
- Diff comparison and export formatting are on the PRD §42.1 required-unit-test list.
- Every result category needs at least one golden case, including Unverifiable and an accepted
  deviation surviving re-review.

## Common failure modes

- Git command assembled by string concatenation with a branch name — command injection.
- File-path-only comparison reporting Matched when the predicted symbol never changed (violates
  PRD §24 and §40.5 "symbol-level comparison where supported").
- Missing findings auto-escalated to failures/defects with no accepted-deviation path.
- Untracked files skipped, so newly created components never appear as Unexpected.
- Rename reported as delete + add → false Missing and false Unexpected simultaneously.
- Review "syncing" the approved analysis to match reality — the baseline must stay frozen.
- Coverage worded as proof ("R1 implemented") instead of estimate with evidence.

## Checklist

- [ ] All git invocations: array args, `--` separators, NUL-safe parsing (tested with hostile
      names)
- [ ] Comparison covers symbols, imports, routes, migrations, events, Terraform/Cloud Run, tests,
      and edges — not just files
- [ ] Every finding categorized with the §24.1 definitions and backed by evidence
- [ ] Report binds analysis ID/version + full §23.1 snapshot; export matches §38.2 sections in
      Markdown and JSON
- [ ] Approved analysis untouched; accepted deviations append-only
- [ ] `pnpm test:application`, `test:analyzers`, `quality:gates` green; goldens updated
      deliberately

## Definition of done

Main-skill definition of done, plus: golden diffs prove all six categories; a moved file, an
untracked file, and a binary file each land in the right category under test; the exported
report round-trips (JSON parseable, Markdown sections complete); and no code path can alter the
approved model during review.
