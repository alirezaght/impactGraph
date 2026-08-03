# ADR-0013: pnpm Workspace Monorepo

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

PRD §29 recommends one repository with `apps/` (vscode-extension, cli, mcp-server) and `packages/`
(core engine packages, adapters, contracts). Three thin apps must share one core (PRD §1, §29.1–4)
with the dependency direction of ADR-0004 enforced between roughly a dozen packages. We need a
repository layout and package manager that make cross-package development, boundary enforcement,
and a single quality gate (`pnpm quality:gates`) practical for a team of humans and agents.

## Options Considered

### Option A — Single package, folder conventions

- Pros: no workspace tooling; one `node_modules`; simplest possible CI.
- Cons: apps cannot have divergent dependency sets — the VS Code extension must not ship CLI-only
  deps, and the webview bundle must not see Node deps; ESLint boundaries can police imports but not
  `package.json` dependencies, so ADR-0004's direction loses its strongest enforcement (a package
  simply _cannot_ import what it does not declare); extracting packages later, under pressure, is
  the expensive path.

### Option B — npm or yarn workspaces

- Pros: workspaces without adding a tool beyond what ships with Node (npm) or is widely known
  (yarn); simpler mental model than pnpm's store for some contributors.
- Cons: both hoist aggressively by default, so undeclared dependencies resolve by accident
  ("phantom dependencies") — precisely the failure mode that erodes package boundaries; npm
  workspaces' filtered execution (`--workspace` flags) is weaker than pnpm's `-r`/`--filter` for
  the per-project script layout we lock (e.g. `pnpm --filter vscode-extension test:integration`);
  yarn adds its own version-management story (Berry vs classic) for no offsetting gain here.

### Option C — pnpm workspaces (chosen)

- Pros: **strict node_modules by default** — a package can only import what its own `package.json`
  declares, turning ADR-0004's dependency direction into an install-time property, not just a lint
  rule; content-addressed store makes installs fast and disk-cheap across a dozen packages;
  first-class recursive/filtered execution powers the locked script names (`pnpm -r --if-present
typecheck`, `pnpm --filter …`); `packageManager` field pins pnpm 10 exactly; pnpm store caching
  is well supported in CI.
- Cons: one more tool contributors must have (mitigated by corepack and the `packageManager`
  field); strictness surfaces real-but-annoying missing-dependency errors that hoisting silently
  papered over; occasional ecosystem friction with tools that assume a flat, hoisted layout
  (usually solvable per-package, but it costs time when it happens).

### Option D — nx or Turborepo on top of a workspace

- Pros: task-graph caching and affected-only execution — meaningful when builds get slow; remote
  cache options; generators.
- Cons: **speculative infrastructure for now** — the repo starts with `--passWithNoTests` on every
  suite and no product source; a task-graph cache accelerates work that does not yet exist while
  adding configuration, cache-correctness risk, and a second scheduler to debug when CI misbehaves.
  Rejected at this stage, not forever.

## Decision

Option C: a pnpm 10 workspace monorepo on Node 22, laid out `apps/*` + `packages/*` per PRD §29
(with the package roster refined in docs/engineering/architecture.md). Root scripts are the single
entry points (`quality:gates`, `test:*`, `quality:loc` — locked names); recursive scripts use
`--if-present` so the setup is green before product code exists. No task-graph layer (Option D) is
added preemptively.

## Consequences

- Positive: package boundaries hold at install time and lint time; each app declares exactly what
  it ships (critical for extension packaging with `@vscode/vsce`); one lockfile, one audit surface
  (`security` CI job); Changesets handles versioning across packages naturally.
- Negative: pnpm strictness will occasionally block a lazy import until the dependency is declared —
  by design, but it is friction; without nx/turbo caching, CI runs every suite every time, which is
  fine now and will not stay fine forever (see trigger).

## Revisit Trigger

Full `pnpm quality:gates` + build exceeding **~5 minutes** locally or in CI — that is the point
where task-graph caching (Option D) pays for its complexity. Adopt it then as an addition to this
layout, not a replacement.

## Links

- PRD §29
- Related: ADR-0003 (single-language toolchain this layout serves), ADR-0004 (dependency direction
  this makes enforceable), ADR-0012 (quality gates that run across the workspace)
- docs/engineering/architecture.md, docs/engineering/dependency-rules.md,
  docs/engineering/quality-gates.md
