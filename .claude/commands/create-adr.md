---
description: Write an ADR into docs/adr/ from the template — options with real pros/cons; unresolved tradeoffs stay Proposed with revisit triggers
argument-hint: <decision title, e.g. "worker-thread pool for indexing">
---

## Purpose

Have the **product-architecture** agent write an Architecture Decision Record for
`$ARGUMENTS` into `docs/adr/`, using `.claude/templates/adr.md` and following
`docs/engineering/adr-process.md`. ADRs exist for hard-to-reverse decisions (new dependency, new
boundary, persistence format, parser strategy, provider surface) — not for routine implementation
choices.

## Inputs

- `$ARGUMENTS` — the decision title.
- Context: the triggering `/impact-plan`, `/architecture-review` finding, or discussion.
- Existing ADRs `docs/adr/0001…0013` (numbering, style, and prior decisions to reference),
  `.claude/templates/adr.md`, `docs/engineering/adr-process.md`.

## Preconditions

- The decision is genuinely architectural: expensive to reverse, or it constrains other packages.
  If not, stop and record the choice in the feature plan or code comments instead.
- The decision does not re-litigate an Accepted ADR without new evidence; if it revises one, the
  new ADR must say which one it supersedes and why the situation changed.

## Agent sequence

1. **product-architecture** (primary) — drafts the ADR.
2. The agent owning the affected context (collaborating) — supplies option details and
   consequences (e.g. local-persistence for a storage decision, language-adapter for a parser
   decision, ai-inference-privacy for a provider-surface decision).

## Skills used

- `impactgraph-modular-development` (locked decisions it must not contradict).

## Steps

1. Determine the next ADR number: list `docs/adr/`, take the highest `NNNN` prefix, add one.
   Filename: `docs/adr/NNNN-<kebab-case-title>.md`.
2. Delegate drafting to **product-architecture** with the template's fixed section order:
   **Status / Context / Decision / Options considered / Consequences / Revisit trigger.**
3. Write **Context** from the actual trigger: the PRD sections (§n/§Zn/§Cn) and epic involved, the
   constraint hit, and which existing ADRs bear on it. No generic motivation text.
4. Write **Options considered** with at least two real options, each with concrete pros AND cons
   (see ADR-0005's Cytoscape vs React Flow vs D3 and ADR-0006's JSON vs SQLite comparisons as the
   bar). An option nobody would pick is not an option; drop it or steelman it.
5. Write **Decision** as one committed choice with its rationale tied to the pros/cons — or, if
   the tradeoff is genuinely unresolved, decide _provisionally_ and set Status accordingly (step 6).
6. Set **Status** honestly:
   - `Accepted` only when the decision is final and human-approved.
   - `Proposed` when a tradeoff is unresolved — with an explicit, testable **Revisit trigger**
     (event or milestone, e.g. ADR-0008's "first Python adapter milestone"), never a vague
     "revisit later". **Never fake resolution to get to Accepted.**
7. Write **Consequences** including the uncomfortable ones: what gets harder, what is now
   enforced (ESLint boundary? CI job? doc update?), and which docs/engineering pages must change
   in the same PR.
8. Cross-link: reference the ADR from the affected `docs/engineering/*` page(s) and from the
   feature plan/PR that triggered it.
9. Present the draft to the human for status decision.

## Required outputs

- `docs/adr/NNNN-<title>.md` following the template, correctly numbered.
- Updated cross-references in the relevant `docs/engineering/*` page(s).
- A one-paragraph summary for the triggering plan/PR.

## Stop conditions

- The decision contradicts a locked decision or Accepted ADR without superseding evidence → stop;
  report to the human instead of writing a conflicting ADR.
- Options cannot be compared because facts are missing (no measurement, no spike) → stop; the ADR
  waits for the spike; do not fill pros/cons with speculation.

## Human-review points

- **ADR acceptance is human-only** (mandatory-approval list in `.claude/CLAUDE.md`). The agent may
  draft with Status `Proposed`; only a human moves it to `Accepted`.

## Completion criteria

- ADR file exists with all six sections substantive; number and filename correct; cross-links
  added; Status reflects reality (`Proposed` + revisit trigger if unresolved); human has seen it.
