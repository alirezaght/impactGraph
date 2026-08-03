---
description: Full staged pipeline for building an ImpactGraph feature — plan, model, contracts, adapters, TDD, reviews, quality gates, human approval
argument-hint: <feature description or path to approved plan>
---

> **Terminology guard:** this is the DEV pipeline for building ImpactGraph itself — not the
> product's "Analyze Specification" / "Review Implementation" features.

## Purpose

Orchestrate a feature from idea to merge-ready branch through fixed stages. Each stage has entry
criteria, a primary agent, and stop conditions; the command delegates to agents via the Agent tool
and never lets a stage start before the previous one's outputs exist.

## Inputs

- `$ARGUMENTS` — feature description, or a reference to an already-approved `/impact-plan` output.
- `Requirement.md`, `backlog/epic-*.md`, `docs/engineering/*`, `.claude/templates/*`.

## Preconditions

- Load `.claude/skills/impactgraph-modular-development/SKILL.md` first.
- Work happens on a fresh `feat/…` branch off `main` (modular skill §10).
- If `$ARGUMENTS` references an approved plan, skip Stage 1 execution but verify the plan still
  matches `main` (no drift in touched packages).

## Agent sequence (by stage)

Primary agents per stage are listed below. `product-architecture` guards boundaries throughout;
`testing-quality` reviews test placement throughout.

## Skills used

`impactgraph-modular-development` (all stages) plus the specialist skill of each stage's owning
context: `domain-provenance-development`, `typed-message-contract-development`,
`language-adapter-development` / `repository-analysis-development` /
`local-artifact-persistence` / `ai-inference-safety` / `vscode-extension-development` /
`graph-webview-development` (whichever adapters/apps are touched).

## Steps (stages)

### Stage 0 — Product-boundary check

- **Entry:** `$ARGUMENTS` received. **Primary:** product-architecture.
- Confirm the change serves PRD sections/epics and does not implement a Non-Goal (PRD §7) or
  contradict PRD §47 build rules. Confirm it is a dev change, not a product-feature confusion.
- **Output:** one-paragraph boundary verdict. **Stop:** out-of-scope → report and end.

### Stage 1 — Plan

- **Entry:** boundary verdict positive. Run `/impact-plan $ARGUMENTS`.
- **Output:** approved feature plan. **Human checkpoint:** plan approval (mandatory).
- **Stop:** plan rejected, or plan requires `/architecture-review` first.

### Stage 2 — Domain modeling

- **Entry:** approved plan names domain concepts. Skip if no domain change.
- **Primary:** domain-provenance (delegate `/model-domain` per new concept).
  **Collaborating:** product-architecture (placement), testing-quality (test shape).
- **Skills:** `domain-provenance-development`. **Template:** `domain-model-proposal.md`.
- **Output:** accepted domain model proposal + failing pure-domain tests in `packages/domain`.
- **Stop:** proposal would mutate history or mix knowledge categories → escalate to human.

### Stage 3 — Contract design

- **Entry:** domain model settled. Skip if no typed boundary changes.
- **Primary:** the app/adapter owner (graph-webview for webview messages, vscode-integration for
  extension commands, local-persistence for artifacts, ai-inference-privacy for AI DTOs).
  **Collaborating:** product-architecture.
- **Skills:** `typed-message-contract-development`. **Templates:** `webview-message-contract.md`,
  `command-contract.md`, `persistence-schema-change.md`, `ai-inference-contract.md` as relevant.
- Draft Zod schemas + versions in `packages/contracts` with contract tests; this is the prep that
  `/review-contracts` will audit in Stage 8.
- **Output:** versioned schemas + failing contract tests.
- **Human checkpoint:** any `schemaVersion` bump (mandatory-approval list).

### Stage 4 — Adapter design

- **Entry:** ports named in the plan; contracts drafted. Skip if no adapter work.
- **Primary:** the owning adapter agent — repository-intelligence, language-adapter (via
  `/design-language-adapter` for new adapters), local-persistence, ai-inference-privacy (provider
  adapters), or the git adapter's owner product-architecture.
- **Output:** adapter design (port implementations, fixture needs in `packages/test-kit`).
- **Stop:** an adapter needs a port/interface change → `/architecture-review` before proceeding.

### Stage 5 — TDD implementation

- **Entry:** failing tests exist from Stages 2–4. **Primary:** the owning agent per package;
  **Collaborating:** testing-quality.
- Red → green → refactor per milestone from the plan; domain stays pure; provenance/evidence/IDs
  carried through; cancellation tokens plumbed; files ≤ 300 effective lines; commits pass
  pre-commit hooks. Golden fixtures updated deliberately only.
- **Output:** implementation with green targeted suites per milestone.
- **Stop:** a milestone forces an unplanned boundary or schema change → back to Stage 1/3.

### Stage 6 — Provenance review

- **Entry:** implementation complete; knowledge records were touched (else skip).
- Run `/review-provenance` (domain-provenance). **Output:** findings, all blockers resolved.

### Stage 7 — Privacy review

- **Entry:** data flow, prompts, secrets, telemetry, or privacy modes touched (else skip).
- Run `/review-privacy` (ai-inference-privacy). **Output:** completed
  `.claude/templates/privacy-review.md` checklist.
- **Stop (blocking):** any external data flow without explicit configuration.

### Stage 8 — Contract review

- **Entry:** any typed boundary touched (else skip). Run `/review-contracts`.
- **Output:** all boundary findings resolved; JSON Schemas regenerated.

### Stage 9 — Performance review

- **Entry:** the plan flagged PRD §33 budget relevance (else skip). Run `/review-performance`
  (performance-scalability). **Output:** measurements vs `docs/engineering/performance-budgets.md`.
- **Stop (blocking):** regression against a budget.

### Stage 10 — Integration review

- **Primary:** vscode-integration (extension/webview wiring) and implementation-review-owning
  agents as relevant; **Collaborating:** graph-webview, testing-quality.
- Verify composition roots wire ports correctly, `test:integration:vscode` passes where the
  extension is touched, and error/cancellation paths behave (modular skill §7).
- **Output:** integration verdict + `.claude/templates/pull-request.md` draft.

### Stage 11 — Quality gates

- Run `/run-quality-gates`. **Stop:** any gate red — route failures per that command; never
  weaken a gate.

### Stage 12 — Human approval

- Present: plan link, per-stage outputs, review results, gate status, PR description draft.
- **Human checkpoint (mandatory):** everything on `.claude/CLAUDE.md`'s mandatory-approval list;
  final merge approval is always human.

## Required outputs

- Approved plan; domain/contract/adapter artifacts per stage; green `/run-quality-gates`; completed
  review commands' findings with resolutions; PR description from the template.

## Stop conditions (global)

- Any stage's stop condition fires → halt the pipeline, report the stage, blocker, and proposed
  route (never skip ahead).
- Discovery that invalidates the plan → return to Stage 1, re-approve before continuing.

## Human-review points

- Stage 1 plan approval; Stage 3 schema bumps; Stage 4 new adapters/dependencies; Stage 7 any
  privacy finding; Stage 12 final approval. These are mandatory, not advisory.

## Completion criteria

- All applicable stages completed with outputs; all `/review-*` blockers resolved;
  `pnpm quality:gates` green; human approval recorded for every mandatory item; branch ready for PR.
