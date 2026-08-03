---
name: domain-provenance-development
description: Use when creating or changing anything in packages/domain — provenance and knowledge-category types, evidence and confidence records, supersession and contradiction modeling, staleness flags, approval immutability, or the clock/identifier ports. Also load when work in another package would force a domain type to change.
---

# Domain & Provenance Development

Shared policy (layers, testing table, LOC, git workflow, definition of done) lives in
`.claude/skills/impactgraph-modular-development/SKILL.md` — load it first. This skill adds the
rules specific to `packages/domain`, owned by the `domain-provenance` agent.

## Purpose

`packages/domain` is the pure, dependency-free model of ImpactGraph's core invariant (PRD §3):
deterministic facts, AI-inferred interpretations, and human-confirmed knowledge are distinct,
auditable, append-only categories. Every type the four engines reason about — nodes, edges,
evidence, confidence, impacts, decisions, snapshots — is defined here and nowhere else.

## When to use

- Adding or changing domain entities/value objects: knowledge records, `Provenance`,
  `EvidenceRecord`, confidence scores, `ImpactAnalysis`/`RequirementImpact` (PRD §13),
  supersession chains, staleness, user decisions.
- Designing the clock/identifier/randomness ports that keep the domain deterministic.
- Reviewing any PR that touches provenance semantics (pair with `/review-provenance`).

## When NOT to use

- Persisting these types (→ `local-artifact-persistence` skill, `packages/persistence`).
- Producing facts from a repository (→ `repository-analysis-development`,
  `language-adapter-development`).
- Impact-engine pipelines and candidate generation (→ `impact-model-development`).
- DTOs for webview/MCP/CLI (→ `typed-message-contract-development`, `packages/contracts`).

## Required context

1. PRD §3 (core principle), §12.3 (provenance enum), §13 (impact model), §14 (confidence model).
2. `docs/engineering/provenance-model.md` and ADR-0002 (knowledge-category separation).
3. `.claude/templates/domain-model-proposal.md` — every new aggregate starts as a proposal via
   `/model-domain`.

## Expected outputs

- Pure TypeScript types + behavior in `packages/domain`, immutable, framework-free.
- Co-located Vitest tests (`unit` project) written before the implementation.
- Updated `docs/engineering/provenance-model.md` when semantics change (same PR), plus human
  approval — provenance semantics are on CLAUDE.md's mandatory-approval list.

## Architectural rules

- `packages/domain` imports nothing: no `fs`, no `zod`, no `vscode`, no `packages/contracts`, no
  persistence DTOs. Time comes from a `Clock` port, IDs from an `IdentifierGenerator` port —
  never `Date.now()`, `Math.random()`, or `crypto.randomUUID()` inline.
- Model the exact provenance enum from PRD §12.3: `static-analysis | configuration |
human-confirmed | llm-inferred | git-history | framework-convention | runtime-observation`.
  `runtime-observation` exists in the type but no code path may produce it in V1.
- Every knowledge record carries provenance, evidence IDs, confidence, `createdAt`,
  repository-snapshot ID, specification version, and analysis-run ID. No optional shortcuts
  "for now".
- Typed errors only; no thrown strings; no `catch` in domain code (there is nothing to catch —
  domain functions are total or return typed results).

## Domain rules

- **Append-only supersession.** Human confirmation creates a new record with a reference to what
  it supersedes; the old record gets `superseded` status. Nothing is mutated or deleted. Same
  for re-analysis: an approved `ImpactAnalysis` is immutable and versioned (PRD §13 `status:
"draft" | "reviewed" | "approved" | "superseded"`) — new information produces a new version.
- **Contradiction is represented, not resolved.** Conflicting knowledge is linked with a
  `CONTRADICTS` edge (PRD §12.2) and both records remain; resolution is a new human-confirmed
  record superseding one side.
- **Confidence is computed, never asserted.** Model confidence as a value object built from
  weighted deterministic signals (PRD §14: exact concept-to-symbol match, direct import, direct
  call, event relationship, shared context, framework convention, historical co-change,
  human-confirmed mapping, graph distance; penalties for ambiguity, conflicting evidence,
  unsupported inference). The contributing signals are stored with the score so the UI can answer
  "why 0.88?". A constructor that accepts a bare number with no signals must not exist.
- **Staleness is a flag, not a refresh.** A record whose snapshot ID or specification version no
  longer matches current state is marked stale; it is never silently recomputed in place.
- **Category promotion is one-way and explicit.** `llm-inferred` becomes `human-confirmed` only
  through a user-decision record; nothing ever becomes `static-analysis` retroactively.

## Security & privacy rules

- Domain types never hold raw source text beyond evidence excerpts already minimized upstream;
  they never hold secrets, API keys, or provider payloads.
- Evidence records reference files/symbols/ranges by ID — redaction happens before anything
  reaches `packages/ai-inference`, but the domain must not create fields that would tempt callers
  to stuff full file contents in.

## Testing requirements

- Vitest `unit` project (`pnpm test:unit`), tests in `packages/domain/**/*.test.ts`, no fixtures,
  no fakes needed except test-kit builders. Test-first is mandatory here.
- Must-cover behaviors: supersession preserves the full chain; approved analyses reject mutation;
  confidence math is deterministic and reproducible from its signals; staleness triggers on
  snapshot/spec-version mismatch; `CONTRADICTS` links survive supersession of one side.
- Confidence calculation is on the PRD §42.1 required-unit-test list — treat missing coverage as
  a gate failure even though `--passWithNoTests` would let it slide.

## Common failure modes

- Confidence copied from a model response into the score field, or signals discarded after
  computing the number.
- `Date.now()` or `randomUUID()` inside an entity factory — breaks reproducibility and unit tests.
- Supersession implemented as update-in-place or delete-then-insert.
- `Provenance` widened to `string`, or a "mixed" provenance invented for convenience.
- Importing a Zod schema or persistence row type into domain to "avoid duplication" — duplication
  at this boundary is the design (mapping lives in adapters, ADR-0004/0006).
- Staleness handled by silently re-running analysis instead of flagging.

## Checklist

- [ ] Domain-model proposal (`/model-domain` + template) exists for new aggregates
- [ ] No imports beyond the package; clock/identifier ports used for all time/IDs
- [ ] Provenance, evidence IDs, confidence signals, snapshot/spec/run IDs on every new record
- [ ] Append-only: no mutation or deletion path for historical knowledge
- [ ] Failing unit tests written first; `pnpm test:unit` and `pnpm quality:gates` green
- [ ] `docs/engineering/provenance-model.md` updated; human approval obtained for semantic changes

## Definition of done

Main-skill definition of done, plus: every new record type carries the full provenance envelope,
history is provably append-only under test, confidence is reproducible from stored signals, and
the package still compiles with zero runtime dependencies.
