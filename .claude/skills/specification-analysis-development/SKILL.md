---
name: specification-analysis-development
description: Use when building or changing the specification and clarification bounded context — requirement extraction, open-question and ambiguity modeling, clarification question generation and severity, repository-aware interviewing, architecture simulation options, product-level ADRs, readiness scoring, or specification versioning.
---

# Specification & Clarification Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill covers the specification + clarification bounded context (the Clarification Engine,
PRD §C2/§C15.2): models in `packages/domain`, use cases in `packages/application`, AI calls only
through the `ModelProvider` port. Owned by the `specification-intelligence` agent.

## Purpose

Turn raw specification text into a stable, versioned structure (PRD §11), detect _material_
architectural ambiguity, interview the user or agent only when necessary, and score
implementation readiness — so the Impact Engine works from an implementation-ready spec instead
of guessing.

## When to use

- `Specification`/`Requirement`/`OpenQuestion`/`ArchitecturalDecision` modeling and versioning.
- Requirement extraction, concept/actor detection, ambiguity detection.
- Clarification question generation, severity classification, cost-aware prioritization,
  architecture simulation, readiness scoring (backlog Epic E).

## When NOT to use

- Mapping requirements to repository nodes or predicting impact (→ `impact-model-development`).
- Prompt construction, redaction, provider handling (→ `ai-inference-safety`).
- The specification webview panel (→ `graph-webview-development` / `vscode-extension-development`).

## Required context

1. PRD §11 (specification model — implement the interfaces as written), §C2–C10 (clarification
   engine, philosophy, workflow, cost-aware questions, severity, repository-aware questions,
   simulation, ADRs, readiness).
2. `docs/engineering/bounded-contexts.md`; `.claude/templates/domain-model-proposal.md` for new
   spec-side types.

## Expected outputs

- Domain types matching PRD §11: `Requirement` with stable `id`, `statement`, the 12-value `type`
  union, `concepts`, `actors`, `priority`, `sourceRange`, `status: draft|confirmed|rejected`;
  `OpenQuestion` with `severity: blocking|important|minor` and `status: open|answered|dismissed`.
- Application use cases: extract requirements, generate clarifications, record answers, compute
  readiness, version specifications.
- Tests in the `unit` (domain) and `application` (use cases, with `FakeModelProvider` from
  test-kit) Vitest projects.

## Architectural rules

- Extraction that needs an LLM goes through the application layer's `ModelProvider` port with a
  Zod-validated response schema; the engine must degrade to deterministic-only behavior
  (heuristic extraction, no clarifications) when no provider is configured (PRD §8).
- The clarification pipeline is PRD §C4: extraction → repository analysis → generate
  interpretations → **compare impact graphs** → identify material ambiguities → interview →
  update spec. Question generation consumes the shared Repository Knowledge Graph via ports —
  never file access.
- `rawText` is preserved verbatim with `sourceType`/`sourceReference`; generated summaries,
  rewrites, or "cleaned" specs are derived views and never replace the original text (main skill
  §1: generated prose is never the system of record).

## Domain rules

- **Clarification philosophy (PRD §C3, quote it in code review):** "Infer everything supported by
  evidence. Ask only when ambiguity materially changes the architecture." A question is justified
  only when competing interpretations produce meaningfully different impact graphs — never merely
  because information is missing.
- Severity per PRD §C6: **blocking** (data ownership, migration strategy, source of truth, event
  ownership, security model), **important** (background-job strategy, indexing, caching,
  monitoring), **minor** (naming, docs, minor performance). Prioritize by architectural cost
  (§C5: affected components/contexts, migrations, API/event contract changes, Terraform,
  deployment, tests, security).
- Questions must be repository-aware (§C7): cite actual repo evidence ("every previous Prisma
  schema change introduced a migration — should this feature migrate existing records?"), not
  generic ("do you need a migration?").
- Prefer architecture simulation over open-ended questions (§C8): present Options A/B/C, each
  with affected components, infrastructure changes, performance/operational implications, risks,
  trade-offs — user selects or modifies instead of essay-answering. Options are AI-assisted and
  labeled as such (PRD §26).
- Every resolved clarification becomes a persistent **product-level ADR** (§C9: question,
  decision, reason, snapshot, related requirements/components/contexts, timestamp, author,
  confidence, manually-confirmed flag), stored as a versioned artifact so future analyses stop
  re-asking. These are the _analyzed project's_ decisions — never confuse them with our
  engineering ADRs in `docs/adr/` (`/create-adr`).
- Readiness (§C10) is computed from question counts/severities and requirement completeness —
  a deterministic function over the spec state, not a number the model returns.
- Versioning: any edit creates version N+1; requirement IDs are stable across re-extraction so
  `RequirementImpact.requirementId` links and `SATISFIES` edges survive; answered questions carry
  their `answer` forward; version comparison is a first-class feature (PRD §40.2).

## Security & privacy rules

- Specification text may contain secrets or hostile content pasted from tickets — it flows to a
  provider only under the active privacy mode with redaction, via `packages/ai-inference`.
- Extracted requirement statements quoted back into prompts are untrusted data (PRD §42.5).
- `sourceReference` (e.g. a Jira key) is metadata, never a trigger for network calls — external
  ticket retrieval belongs to the external agent (PRD §10.2).

## Testing requirements

- Domain (`pnpm test:unit`): version immutability, stable requirement IDs, severity ordering,
  readiness computation, ADR record shape.
- Application (`pnpm test:application`): extraction/clarification use cases against
  `FakeModelProvider` and an in-memory graph fake from test-kit; provider failure leaves
  deterministic spec management fully usable.
- Golden sample specifications (PRD §42.3, Phase 0's three sample specs) pin extraction output;
  malformed model output (wrong schema, invented requirement IDs) must be rejected under test.

## Common failure modes

- Generic question generated because a field is empty, rather than because interpretations
  diverge — violates §C3 and trains users to ignore questions.
- Requirement IDs regenerated on re-extraction, orphaning every existing impact and decision.
- `sourceRange` dropped during extraction, so the evidence panel cannot highlight where in the
  spec a requirement came from.
- Product-level clarification ADRs written into `docs/adr/` (or vice versa).
- Readiness score asked from the LLM instead of computed from open-question state.
- Spec edit mutating version N in place instead of appending N+1; "improved" summary silently
  replacing `rawText`.

## Checklist

- [ ] Types match PRD §11 exactly; new types have a domain-model proposal
- [ ] Every question traces to divergent interpretations and carries severity + evidence
- [ ] Simulation options offered where §C8 applies; labeled AI-assisted
- [ ] Resolved clarifications persisted as product ADRs bound to a snapshot
- [ ] Versions append-only; requirement IDs stable under re-extraction (tested)
- [ ] Works with no provider configured; `pnpm test:unit`, `test:application`, `quality:gates` green

## Definition of done

Main-skill definition of done, plus: for the golden sample specs, extraction is reproducible,
every generated question is materially justified and repository-aware, readiness is explainable
from stored state, and the original specification text is byte-for-byte recoverable at every
version.
