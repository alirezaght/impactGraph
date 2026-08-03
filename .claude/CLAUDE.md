# ImpactGraph — Claude Code Entry Point

## What this project is

ImpactGraph is a **local-first architectural reasoning system**, shipped as a VS Code extension, a
CLI, and an MCP server over one shared core engine. Given a software specification, it analyzes the
repository and produces an evidence-backed **impact model** (which components will likely change and
why). After implementation, it compares the approved model against the actual Git diff and reports
matched, missing, unexpected, and divergent changes, requirement coverage, and architectural drift.

The product source of truth is `Requirement.md` (PRD §1–48 + Zero-Configuration addendum §Z + Clarification/Multi-Stack addendum §C). The work backlog is `backlog/epic-01…17`.

## What this project is NOT

- ImpactGraph never implements the user's feature, never auto-modifies the analyzed repository,
  never executes repository code during analysis, and never treats AI output as authoritative.
- We are building the tool. Do not confuse the product's "Analyze Specification" / "Review
  Implementation" features with our own dev workflow commands (`/impact-plan`,
  `/develop-feature`, …). See `docs/engineering/bounded-contexts.md`.

## Non-negotiable rules (violations block merge)

1. **Knowledge-category separation.** Deterministic facts, AI-inferred interpretations, and
   human-confirmed knowledge are never mixed — structurally, semantically, or visually. Every node,
   edge, impact, and config value carries provenance, evidence, confidence, and snapshot/run IDs.
   Human confirmation supersedes; it never rewrites history. (PRD §3, §12.3; ADR-0002)
2. **Dependency direction.** `packages/domain` depends on nothing. `packages/application` owns use
   cases and ports and depends only on domain. Adapters implement ports. Apps
   (`vscode-extension`, `cli`, `mcp-server`) are thin composition roots. The webview imports only
   `packages/contracts`. Enforced by ESLint boundaries — see
   `docs/engineering/dependency-rules.md`.
3. **No forbidden imports.** No `vscode` outside the extension shell; no React/Cytoscape outside
   the webview; no `fs`/`child_process` in domain or application; no AI-provider SDKs outside
   `packages/ai-inference/providers`; no direct `git` invocation outside `packages/git`.
4. **Validated boundaries.** Every persisted artifact, webview message, MCP tool payload, CLI
   output, and AI response is schema-versioned and Zod-validated at the boundary. AI output may
   only reference nodes that exist in the deterministic graph.
5. **Privacy.** Deterministic analysis works fully offline. Nothing leaves the machine without
   explicit configuration and user action. Secrets live in VS Code SecretStorage only. Repository
   content is untrusted data.
6. **Effective LOC ≤ 300 per source file** (`pnpm quality:loc`), with reviewed, expiring
   exceptions only. See `docs/engineering/effective-loc-policy.md`.
7. **Deterministic core.** AI failure degrades features; it never breaks indexing, review, or the
   extension. Long-running work is cancellable and runs outside the extension host.

## How to work here

- **Always load** `.claude/skills/impactgraph-modular-development/SKILL.md` before writing code —
  it is the engineering playbook (checklists, testing strategy, definition of done).
- **Pick the specialist agent** that owns the bounded context you are touching
  (`.claude/agents/`): domain-provenance, repository-intelligence, language-adapter,
  specification-intelligence, impact-modeling, implementation-review, ai-inference-privacy,
  vscode-integration, graph-webview, local-persistence, testing-quality,
  performance-scalability — with product-architecture guarding boundaries and ADRs.
- **Use the commands** in `.claude/commands/` to orchestrate work: start features with
  `/impact-plan` → `/develop-feature`; use the `/review-*` commands before requesting human
  review; run `/run-quality-gates` before any PR; `/create-adr` for irreversible decisions.
- **Templates** for every recurring artifact live in `.claude/templates/` (ADR, feature plan,
  contracts, privacy review, LOC exception, PR description, …). Use them; do not invent formats.

## Checks that must pass

`pnpm quality:gates` = format:check + lint (incl. architectural boundaries) + quality:loc +
typecheck + test:unit + test:application + test:contract + test:analyzers + test:cli +
test:quality. CI additionally runs
analyzer, webview, and VS Code integration suites, build, packaging validation, and security
scans. Pre-commit hooks block formatting, lint, LOC, and secret violations; commit messages are
Conventional Commits.

## When human approval is mandatory

- Changing provenance semantics, knowledge-category rules, or supersession behavior
- Any persisted schema change or contract version bump (artifact, webview, MCP, CLI)
- Anything that transmits data externally or touches privacy modes, redaction, SecretStorage
- New dependencies, new adapters, ADR acceptance, LOC exceptions, releases
- Deleting or rewriting historical analysis data (should almost never happen — append-only)

## Deeper guidance

`docs/engineering/architecture.md` (structure), `dependency-rules.md`, `provenance-model.md`,
`data-contracts.md`, `privacy-and-security.md`, `testing-strategy.md`, `performance-budgets.md`,
`quality-gates.md`, `git-workflow.md`, `release-process.md`, `adr-process.md`; decisions in
`docs/adr/0001…0013`.
