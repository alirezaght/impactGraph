---
description: Design a new language or framework adapter — fixture repo, golden tests, fallback behavior, adapter-interface discipline
argument-hint: <language or framework, e.g. "Python" or "Cloud Run">
---

## Purpose

Have the **language-adapter** agent design a new adapter for `packages/language-adapters` or
`packages/framework-adapters`, using `.claude/templates/language-adapter-proposal.md`. Adapters
turn source and configuration files into deterministic graph fragments (PRD §30) — provenance
`static-analysis` / `configuration` / `framework-convention` only, never inference.

## Inputs

- `$ARGUMENTS` — the language or framework to support, with its PRD anchor (PRD §6.1/§6.2 list the
  supported set; §C addendum covers multi-stack).
- `docs/engineering/language-adapters.md`, `docs/engineering/repository-analysis.md`, ADR-0008
  (parser strategy — Proposed; its revisit trigger is the first Python adapter milestone).

## Preconditions

- An approved `/impact-plan` or backlog epic (epic-02-indexing, epic-03-framework-discovery, or
  epic-16-multi-stack) covers this adapter.
- Load `.claude/skills/impactgraph-modular-development/SKILL.md` §2 (adapters implement
  application ports) and §6 (golden tests).

## Agent sequence

1. **language-adapter** (primary) — the design. One agent owns all adapters; per-language
   knowledge lives in the skill and in each adapter proposal.
2. **repository-intelligence** (collaborating) — how fragments merge into the Repository Knowledge
   Graph (§C15), incremental-update and hashing behavior.
3. **product-architecture** (collaborating) — invoked only if the shared adapter interface must
   change (see Stop conditions).
4. **testing-quality** (collaborating) — fixture and golden-test structure in `packages/test-kit`.

## Skills used

- `language-adapter-development` (primary)
- `repository-analysis-development` (graph-fragment semantics)

## Steps

1. Delegate to **language-adapter** to fill `.claude/templates/language-adapter-proposal.md`:
   - Scope: extensions, detection heuristics (`detectProject`), what is indexed vs explicitly
     unsupported-and-reported (PRD §34: partial language support must be visible, not silent).
   - Parser choice per ADR-0008: TypeScript compiler API for TS/JS; tree-sitter (WASM) for
     Python/Java/HCL/Astro/HTML. A different parser needs `/create-adr`.
   - Node/edge types the adapter emits, each with provenance value and evidence shape (file, span,
     parser rule). Deterministic provenance only — an adapter never emits `llm-inferred`.
   - Diff behavior: `analyzeDiff` semantics for incremental updates (< 3 s budget, PRD §33).
2. Define **fallback behavior** explicitly: what the filesystem/text-level fallback adapter yields
   for this language when the parser fails or a construct is unsupported — degraded evidence,
   never fabricated structure, failures reported per PRD §34.
3. Define the **fixture repo**: a minimal repository in `packages/test-kit` exercising every
   claimed construct plus known hard cases. Never the ImpactGraph repo itself (modular skill §6).
   Security note: fixtures are parsed, never executed (PRD §47.17 — parse Terraform, don't run it).
4. Define **golden tests** in the `analyzers` Vitest project: pinned graph-fragment output per
   fixture; document the deliberate-update procedure (never regenerate blindly).
5. Have **repository-intelligence** review fragment merging, symbol/hash storage in the SQLite
   index (ADR-0006), and cancellation behavior for large repos.
6. Present the proposal; on approval, hand to `/develop-feature` Stage 5 for TDD implementation.

## Required outputs

- Completed `.claude/templates/language-adapter-proposal.md`.
- Fixture-repo file list and golden-test plan (`pnpm test:analyzers` target).
- Explicit fallback-behavior section.
- Statement on whether ADR-0008's revisit trigger fires (first Python adapter → revisit the ADR).

## Stop conditions

- **The shared adapter interface (PRD §30 `LanguageAdapter`) needs to change → stop and run
  `/architecture-review`.** The interface is a port; changing it affects every adapter and needs
  product-architecture's verdict (and likely an ADR) before this design continues.
- The design requires executing repository code → reject outright (PRD §47.17).
- The design requires AI inference inside the adapter → reject; inference belongs to
  `packages/ai-inference` behind the ModelProvider port (ADR-0010).

## Human-review points

- New adapter = new dependency surface (tree-sitter grammar, WASM artifacts) → human approval
  (mandatory-approval list).
- Proposal acceptance before implementation.

## Completion criteria

- Proposal complete including fallback and golden-test sections; fixture plan concrete; interface
  unchanged or `/architecture-review` completed; human approval for the new adapter recorded.
