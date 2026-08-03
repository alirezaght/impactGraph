---
description: Model a new domain concept for packages/domain with provenance, evidence, and supersession invariants — pure-domain tests first
argument-hint: <domain concept, e.g. "requirement coverage record">
---

## Purpose

Have the **domain-provenance** agent design a new domain concept (entity, value object, domain
event, or domain service) for `packages/domain`, using
`.claude/templates/domain-model-proposal.md`, with the knowledge-category invariants (PRD §3,
§12.3; ADR-0002) verified before any code beyond failing tests exists.

## Inputs

- `$ARGUMENTS` — the concept to model, ideally with its PRD anchor (e.g. "discrepancy record,
  PRD §10.5" or "confidence score, PRD §14").
- `docs/engineering/provenance-model.md`, `docs/engineering/bounded-contexts.md`, existing
  `packages/domain` code.

## Preconditions

- An approved `/impact-plan` (or Stage 2 of `/develop-feature`) names this concept; do not model
  speculatively.
- Load `.claude/skills/impactgraph-modular-development/SKILL.md` §3–§4 (provenance + domain
  invariants).

## Agent sequence

1. **domain-provenance** (primary) — modeling and invariant analysis.
2. **product-architecture** (collaborating) — bounded-context placement, naming against
   `docs/engineering/bounded-contexts.md`.
3. **testing-quality** (collaborating) — reviews that tests are pure-domain and in the `unit`
   Vitest project.

## Skills used

- `domain-provenance-development` (primary)
- `impactgraph-modular-development` (shared invariants)

## Steps

1. Delegate to **domain-provenance** to draft `.claude/templates/domain-model-proposal.md` for
   `$ARGUMENTS`: name, bounded context, kind (entity/VO/event/service), relationships to existing
   concepts (real edge types where applicable, e.g. `MAY_AFFECT`, `SATISFIES`, `CONTRADICTS`),
   lifecycle, and invariants.
2. Answer the knowledge-category questions explicitly in the proposal:
   - Which knowledge category/categories can this record carry, and is mixing structurally
     impossible (separate types or a discriminated union — never a shared mutable field)?
   - Which provenance values are legal (`static-analysis`, `configuration`, `git-history`,
     `framework-convention`, `llm-inferred`, `human-confirmed`)? `runtime-observation` stays
     reserved (PRD §12.3).
   - Does it carry evidence IDs, confidence, createdAt (clock port), repository-snapshot ID,
     specification version, analysis-run ID? Justify any omission.
   - How does supersession work: new record superseding the old, append-only, old record kept with
     `superseded` status — never mutation or deletion. How is staleness detected?
   - If AI can produce it: how are references to nonexistent graph nodes rejected and unsupported
     claims downgraded (PRD §34)?
3. Verify domain purity (modular skill §4): no I/O, no `Date.now()`/random (clock + identifier
   ports), immutable modeling, typed errors, no framework or persistence types.
4. Have **product-architecture** confirm placement and that no contract/persistence concern leaked
   into the model (DTO mapping lives in adapters, modular skill §5).
5. Write failing pure-domain tests in `packages/domain/**/*.test.ts` (`unit` project) covering
   each invariant from step 2 — especially "supersession never mutates" and "categories cannot
   mix". Tests first; implementation only after the proposal is accepted.
6. Present the proposal + failing tests for approval.

## Required outputs

- Completed `.claude/templates/domain-model-proposal.md`.
- Failing Vitest `unit` tests encoding every stated invariant.
- Explicit invariant verdict per question in step 2.

## Stop conditions

- The concept requires mutating or deleting historical records → stop, escalate to human (this
  changes supersession semantics — mandatory-approval list).
- The concept cannot avoid mixing knowledge categories in one structure → stop; redesign with
  domain-provenance + product-architecture before proceeding.
- Modeling reveals a needed change to provenance semantics themselves → `/create-adr` +
  human approval first.

## Human-review points

- Any change to provenance/category/supersession semantics (mandatory).
- Proposal acceptance before implementation begins.

## Completion criteria

- Proposal complete with all invariant questions answered; failing tests exist and fail for the
  right reason (`pnpm test:unit` shows them red); placement confirmed; approval recorded.
