# Bounded Contexts and Ownership

Thirteen specialist agents (`.claude/agents/`) own the bounded contexts of this codebase. Every
package and app directory has exactly one owning agent. Cross-context changes require each owning
agent's checklist plus `/architecture-review` when a boundary moves (main skill §2). The layout
these contexts map onto is defined in `architecture.md`; the import rules between them in
`dependency-rules.md`.

## Ownership map

| Agent                          | Owns (packages / dirs)                                                                                                               | Core decisions it may make alone                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **product-architecture**       | `docs/adr/`, `docs/engineering/architecture.md`, `dependency-rules.md`, `eslint.config.mjs` boundaries config, root workspace layout | Package boundaries, dependency matrix changes, ADR drafting; arbitrates all cross-context disputes                                     |
| **domain-provenance**          | `packages/domain` (all of `specification/`, `repository/`, `architecture/`, `provenance/`, `impact/`, `review/`, `errors/`)          | Domain modeling, invariants, typed errors, evidence/confidence shapes — within the knowledge-category rules (PRD §3, §12.3; ADR-0002)  |
| **repository-intelligence**    | `packages/repository-intelligence`, `application/index-repository/`                                                                  | Scan/hash/assemble pipeline, incremental strategy (PRD §32), index status reporting; see `repository-analysis.md`                      |
| **language-adapter**           | `packages/language-adapters`, `packages/framework-adapters`                                                                          | New adapter internals, parser choices within ADR-0008, fixture/golden-test design; see `language-adapters.md`                          |
| **specification-intelligence** | `application/analyze-specification/`, `domain/specification` (jointly with domain-provenance)                                        | Requirement extraction, open questions, clarification workflow, readiness scoring (PRD §11, §C2–C10)                                   |
| **impact-modeling**            | `application/build-impact-model/`, `application/approve-impact-model/`, `domain/impact` (jointly)                                    | Concept matching, candidate traversal, confidence signal weights (PRD §13–14), approval/supersession flow (§40.3)                      |
| **implementation-review**      | `application/review-implementation/`, `domain/review` (jointly), review-report contracts                                             | Diff interpretation, result classification (PRD §24), coverage estimation (§25); see `implementation-review.md`                        |
| **ai-inference-privacy**       | `packages/ai-inference` (incl. `providers/`), privacy-mode enforcement, redaction, prompt assembly                                   | Provider integration details behind the `ModelProvider` port (PRD §8, ADR-0010); anything crossing the network needs `/review-privacy` |
| **vscode-integration**         | `apps/vscode-extension/src/` (shell, commands, views, webview-host, workers, integration tests)                                      | Command wiring (PRD §19), activation, progress UX, worker lifecycle — never analysis logic in the shell                                |
| **graph-webview**              | `apps/vscode-extension/webview/`, `packages/contracts/webview` (jointly with vscode-integration)                                     | Graph/tree/evidence-panel rendering (PRD §18), Cytoscape usage (ADR-0005), view state — webview renders and requests, never decides    |
| **local-persistence**          | `packages/persistence`, `packages/contracts/artifacts`, migrations                                                                   | SQLite index schema, JSON artifact store, YAML config store (ADR-0006); see `artifact-versioning.md`                                   |
| **testing-quality**            | `packages/test-kit` (fakes, builders, fixtures), `scripts/quality/`, vitest project config                                           | Test-layer placement, fixture roster (PRD §42.2), LOC-checker behavior, quality-gate composition                                       |
| **performance-scalability**    | Cross-cutting: performance budgets (`performance-budgets.md`), worker/child-process execution, cancellation plumbing                 | Measurement methodology; may veto changes that break PRD §33 budgets, with data                                                        |

`packages/git` and `packages/contracts` are jointly held: git by repository-intelligence
(snapshots, blame/history) and implementation-review (diffs); contracts sub-trees by the context
that owns each boundary, with product-architecture guarding versioning discipline
(`data-contracts.md`).

## Decision rights and escalation

1. **Inside one context**: the owning agent decides, within CLAUDE.md's non-negotiable rules and
   the main skill's checklists. No escalation needed.
2. **Across two contexts** (e.g. a new port between application and persistence): both owning
   agents' checklists apply; the change is planned via `/impact-plan` and reviewed with
   `/review-contracts` if any boundary schema changes.
3. **Boundary moves** (new package, changed dependency edge, split/merged context):
   product-architecture must run `/architecture-review`; an ADR is required (`/create-adr`,
   `adr-process.md`).
4. **Mandatory human approval** — no agent may self-approve (CLAUDE.md list): provenance/
   knowledge-category semantics, persisted schema or contract version bumps, external data
   transmission or privacy modes, new dependencies, new adapters, ADR acceptance, LOC exceptions,
   releases, deleting/rewriting historical analysis data.
5. **Deadlocks** between agents escalate to product-architecture; if the dispute touches product
   behavior rather than code structure, it escalates to the human with the PRD section in hand
   (PRD §47.20: ask before contradicting the specification).

## Terminology guard: product features vs. dev workflow

ImpactGraph _the product_ ships commands named "Analyze Specification" and "Review Implementation"
(PRD §19). This repository's `.claude/commands/*` are the **development workflow for building
ImpactGraph itself**. Blurring them corrupts docs, prompts, and reviews. When writing anything,
check which column you are in:

| Product feature (ImpactGraph, PRD)                                                                            | Dev-workflow command (this repo, `.claude/commands/`)                                                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ImpactGraph: Analyze Specification` — turns a user's spec into an impact model (PRD §10.3, §19)              | `/impact-plan` — plans OUR change: affected packages, contracts, provenance implications                   |
| `ImpactGraph: Review Implementation` — compares the user's diff against their approved model (PRD §10.5, §24) | `/develop-feature` — implements OUR planned change with tests                                              |
| Impact & Review Engine (PRD §C15)                                                                             | `/architecture-review` — audits OUR package boundaries and ADR compliance                                  |
| Clarification Engine open questions (PRD §C2)                                                                 | `/model-domain` — designs OUR domain types before persistence                                              |
| `impactgraph.review_implementation` MCP tool (PRD §21)                                                        | `/review-provenance`, `/review-contracts`, `/review-privacy`, `/review-performance` — OUR pre-review gates |
| `impactgraph analyze spec.md` CLI (PRD §20)                                                                   | `/run-quality-gates` — runs `pnpm quality:gates` and reports                                               |
| ADRs the product records for its users (PRD §C9)                                                              | `/create-adr` — records OUR engineering decisions in `docs/adr/`                                           |
| Approved impact model export (PRD §22)                                                                        | `/prepare-release` — OUR release checklist                                                                 |
| Custom detection rules users add (§Z8)                                                                        | `/design-language-adapter` — proposes a NEW adapter in OUR codebase                                        |

Rules of thumb:

- If a sentence's subject is "the user's repository", "the analyzed repo", or "the specification",
  it is the product column. If the subject is "this PR", "this package", or "our tests", it is the
  dev column.
- Never name a dev command after a product command. The dev roster is locked:
  `/impact-plan`, `/develop-feature`, `/architecture-review`, `/model-domain`,
  `/design-language-adapter`, `/review-provenance`, `/review-contracts`, `/review-privacy`,
  `/review-performance`, `/run-quality-gates`, `/prepare-release`, `/create-adr`.
- Product ADRs (records the product persists for its users, PRD §C9) live in the product's data
  model (`artifact-versioning.md`); our engineering ADRs live in `docs/adr/0001…0013`. Same
  acronym, different artifact — always qualify which one you mean.
