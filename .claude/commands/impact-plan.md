---
description: Plan a change to the ImpactGraph codebase — PRD/epic mapping, affected packages, contract and provenance impact, test plan
argument-hint: <feature or change description>
---

> **Terminology guard:** this is our DEV workflow for planning changes to the ImpactGraph
> codebase. It is NOT the product's "Analyze Specification" feature (PRD §10.3). We plan our own
> code changes here; the product analyzes its users' specifications.

## Purpose

Produce an approved feature plan before any code changes, using
`.claude/templates/feature-plan.md`. The plan anchors the change in the PRD and backlog, names the
affected packages and typed boundaries, states provenance implications, and defines the test plan.
Every `/develop-feature` run starts from a plan produced here.

## Inputs

- `$ARGUMENTS` — the feature or change description (free text, a `backlog/epic-*.md` reference, or
  a PRD section reference such as "§14 confidence scoring").
- `Requirement.md`, `backlog/epic-01…17`, `docs/engineering/architecture.md`,
  `docs/engineering/dependency-rules.md`.

## Preconditions

- The request describes a change to ImpactGraph itself (see Purpose note). If the request is to
  _use_ ImpactGraph on some repository, stop and clarify with the user.
- Load `.claude/skills/impactgraph-modular-development/SKILL.md` (§12 "Before coding" checklist).

## Agent sequence

1. **product-architecture** (primary) — scoping, package/boundary impact, ADR need.
2. **domain-provenance** (collaborating, when the change touches knowledge records, provenance,
   evidence, confidence, or supersession).
3. **testing-quality** (collaborating) — test-plan review across the layers in the modular skill §6.

Delegate via the Agent tool; each agent returns its section of the plan, this command assembles it.

## Skills used

- `impactgraph-modular-development` (always)
- The specialist skill owning the touched context (e.g. `impact-model-development`,
  `repository-analysis-development`) — named in the plan for downstream stages.

## Steps

1. Restate `$ARGUMENTS` in one paragraph. Identify the PRD sections (§n / §Zn / §Cn) and the
   backlog epic(s) this serves. If no PRD section supports the change, flag it as speculative and
   stop (YAGNI — modular skill §12).
2. Delegate to **product-architecture**: list affected `apps/*` and `packages/*`, dependency-rule
   implications (`docs/engineering/dependency-rules.md`), whether any port changes, and whether an
   ADR is required (`docs/engineering/adr-process.md` → `/create-adr`).
3. Identify contract/schema impact: which of `contracts/webview`, `contracts/tools`,
   `contracts/cli`, `contracts/artifacts`, `contracts/config` are touched; whether a
   `schemaVersion` bump is needed; which contract templates apply (this feeds `/review-contracts`).
4. If knowledge records are involved, delegate to **domain-provenance**: which provenance
   categories are produced/consumed, evidence and snapshot/run-ID requirements, supersession and
   staleness implications (PRD §3, §12.3).
5. State privacy and performance relevance: does data flow change (`/review-privacy` needed?) and
   is any PRD §33 budget affected (`/review-performance` needed?). Yes/no with one-line reason.
6. Delegate to **testing-quality**: draft the test plan per layer (unit / application / contract /
   analyzers / webview / integration) with concrete first failing tests; fixture-repo needs from
   `packages/test-kit`.
7. Fill `.claude/templates/feature-plan.md` completely. List milestones small enough that each
   passes `pnpm quality:gates` independently.
8. Present the plan to the user for approval.

## Required outputs

- A completed feature plan (in-conversation, following `.claude/templates/feature-plan.md`) with:
  PRD/epic anchors, affected packages, contract impact, provenance implications, privacy and
  performance relevance flags, ADR needs, per-layer test plan, milestones.

## Stop conditions

- No PRD section or epic supports the change → stop, report as out-of-scope/speculative.
- The plan requires violating a locked decision (ADR-0001…0013) or a dependency rule → stop and
  route to `/architecture-review` (and possibly `/create-adr`) instead of planning around it.
- The change would blur product features and dev workflow (terminology guard) → stop and clarify.

## Human-review points

- The finished plan itself: human approval required before `/develop-feature` proceeds, and always
  when the plan includes a schema bump, new dependency, new adapter, privacy-mode change, or ADR
  (mandatory-approval list in `.claude/CLAUDE.md`).

## Completion criteria

- Every template section filled with specifics (no "TBD" without an owner and a resolution step).
- Named agents, skills, and templates for each downstream stage.
- User has explicitly approved the plan, or the command reported a stop condition.
