# Git Workflow

Trunk-based development for the ImpactGraph monorepo. Gates referenced here are specified in
`quality-gates.md`; release flow in `release-process.md`. This is about _our_ git workflow — the
product's git analysis lives in `packages/git` and is documented in `implementation-review.md`.

## 1. Branches

- Trunk-based: short-lived branches off `main`, merged within days, not weeks.
- Names: `feat/<slug>`, `fix/<slug>`, `chore/<slug>` (e.g. `feat/confidence-signal-weights`).
- No long-lived integration branches; feature flags / incremental merges over branch stockpiling.
- `main` is always releasable: every merge passed the full CI matrix.

## 2. Commits

- **Conventional Commits**, enforced by commitlint (`@commitlint/config-conventional`) in the
  commit-msg hook. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `ci`,
  `build`, `revert`.
- **Scopes match packages and apps**: `domain`, `application`, `contracts`,
  `repository-intelligence`, `language-adapters`, `framework-adapters`, `git`, `persistence`,
  `ai-inference`, `test-kit`, `vscode-extension`, `webview`, `cli`, `mcp-server`, plus `quality`
  (scripts/quality), `ci`, `docs`. Example: `feat(ai-inference): downgrade unsupported claims
before provenance stamping`.
- **Small-commit discipline**: each commit is one logical change that passes pre-commit hooks on
  its own — reviewable in isolation, revertable in isolation. A cross-package refactor is a series
  of commits following the dependency direction (domain → application → adapters → apps), not one
  monolith.

## 3. Hooks (Husky — locked layout)

| Hook         | Runs                                                                                                                               | Purpose                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | lint-staged: prettier (write), `eslint --fix --max-warnings 0`, then `quality:loc --files <staged>` and `quality:secrets --staged` | Block badly formatted, lint-failing, oversized, or secret-leaking changes **before the commit exists**. Fast only — seconds, not minutes. |
| `commit-msg` | commitlint                                                                                                                         | Block non-Conventional messages (Changesets and release notes depend on them).                                                            |
| `pre-push`   | `pnpm typecheck` + `pnpm test:unit` + `pnpm test:application` + `pnpm test:contract` + `pnpm test:quality`                         | Block pushing branches that would obviously fail CI.                                                                                      |

## 4. Why there is no post-commit gate

A blocking check can only run **before** the commit exists — that is what pre-commit is. A
post-commit hook fires after the commit object is already created, so it **cannot reject
anything**; at best it could nag, at worst it would mutate history behind your back. So we do not
use one, and we say so instead of pretending otherwise:

- **pre-commit blocks bad commits** (format, lint, LOC, secrets — on staged files),
- **pre-push blocks bad pushes** (types + fast test suites),
- **CI blocks bad merges** (the full matrix in `quality-gates.md` §3, including everything too
  slow for hooks).

Three nets, each at the last point where blocking is actually possible.

## 5. Deliberately NOT in hooks

- **VS Code Electron integration tests** (`test:integration:vscode`) — minutes-long, needs an
  Electron download and (in CI) xvfb; belongs in the `test-vscode-integration` CI lane.
- **Analyzer fixture suites** (`test:analyzers`) — fixture-repo I/O heavy; runs in CI on every PR.
- **Builds / packaging** — the `build` and `package-extension` CI jobs own these.

Reason: a slow hook trains people to `--no-verify`, which silently disables the _fast_ checks too.
Hooks stay under ~10 s so nobody routes around them. Using `--no-verify` is not sanctioned;
anything it would have caught fails in CI anyway.

## 6. Pull requests

- Use `.claude/templates/pull-request.md`. A PR states: what changed and why (PRD §/epic
  reference), **link to the `/impact-plan` output or ADR**, test evidence per layer, and explicit
  notes on provenance, privacy, and schema impact (or "none").
- Before requesting review: `pnpm quality:gates` green locally, plus the relevant review commands
  run — `/review-provenance` (knowledge records changed), `/review-contracts` (any boundary schema
  changed), `/review-privacy` (data flow changed), `/review-performance` (perf-sensitive paths).
- Keep PRs small enough to review properly; stack dependent PRs rather than batching.

## 7. Merge requirements

A PR merges only when:

1. All required CI jobs are green — the full list in `quality-gates.md` §3, no job demoted to
   non-required (no-weakening rule).
2. Human approval exists for anything on CLAUDE.md's mandatory-approval list (provenance
   semantics, schema/contract bumps, external data flow, new dependencies, ADR acceptance, LOC
   exceptions, releases).
3. Review comments are resolved with rigor — verified fixes or reasoned pushback, not
   performative agreement.
4. Docs and ADRs updated in the same PR when behavior or boundaries changed (SKILL.md §11).
5. Golden updates are explained in the PR description (see `testing-strategy.md` §3).

Merge strategy: squash-merge by default so `main` history is one Conventional Commit per PR;
the squash message follows §2 (it becomes changelog input via Changesets — `release-process.md`).
