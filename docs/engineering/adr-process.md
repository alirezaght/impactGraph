# ADR Process

How we record architecture decisions for **building** ImpactGraph. Template:
`.claude/templates/adr.md`. Command: `/create-adr`. Existing decisions:
`docs/adr/0001…0013`. Guardian agent: `product-architecture`.

## 1. When an ADR is required

Write an ADR when a decision is **irreversible or expensive to reverse**. Concretely:

- Changing a dependency boundary or layer responsibility (`dependency-rules.md`,
  `architecture.md`) — e.g. moving logic between `application` and an adapter.
- **New runtime dependencies** (any library shipped in the extension/CLI/MCP server) — new dev
  tooling of consequence too.
- **Persistence/schema strategy**: storage engines, artifact formats, migration approach
  (ADR-0006 territory; individual schema bumps use
  `.claude/templates/persistence-schema-change.md` instead — an ADR is for the _strategy_).
- Provider strategy, privacy-mode semantics, provenance/knowledge-category semantics
  (ADR-0002, ADR-0010 territory).
- Parser/analysis technology choices (ADR-0008 territory).
- Anything where two competent engineers would plausibly choose differently and the loser of the
  argument needs to know _why_ in a year.

Not ADR material: naming, file moves within a package, refactors that keep boundaries intact,
choices trivially reversed by a small PR. Those belong in PR descriptions.

## 2. Workflow

1. Run `/create-adr`. It instantiates `.claude/templates/adr.md` with the format:
   **Status / Context / Decision / Options considered (pros & cons) / Consequences / Revisit
   trigger.**
2. Number and slug: `docs/adr/NNNN-slug.md`, zero-padded, **next free number after 0013** (the
   first new one is `0014-…`). Numbers are never reused, even for rejected proposals.
3. Options considered must be real: at least the serious alternatives with honest pros and cons —
   ADR-0005's Cytoscape vs React Flow vs D3 comparison and ADR-0006's JSON vs SQLite comparison
   are the bar.
4. Review by the **`product-architecture` agent** (boundary and consistency check against
   ADRs 0001–0013 and `architecture.md`), plus any owning agent whose context is affected.
5. **Human approval is mandatory for acceptance** (CLAUDE.md mandatory-approval list). Until a
   human accepts it, the ADR stays `Proposed` no matter how confident the analysis is.
6. Update the affected `docs/engineering/*` pages in the same PR — an ADR that contradicts the
   docs is a bug.

## 3. Statuses

| Status       | Meaning                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Proposed`   | Under consideration, or accepted-in-spirit but with **unresolved tradeoffs**. Must carry an explicit **revisit trigger** (e.g. ADR-0008: "revisit at the first Python adapter milestone"). |
| `Accepted`   | A human approved it; it binds until superseded.                                                                                                                                            |
| `Superseded` | Replaced by a newer ADR; both link to each other. The old file is never edited into agreement or deleted — history stays honest.                                                           |

Unresolved tradeoffs stay `Proposed` with explicit revisit triggers — **never faked as settled**.
"We chose X for now, unsure about Y" written down truthfully beats a confident-sounding
`Accepted` that nobody believes. Revisit triggers are checked at each release
(`release-process.md` §5).

Amending an `Accepted` ADR's decision means writing a new ADR that supersedes it; only
typo/link-level fixes edit an accepted ADR in place.

## 4. IMPORTANT: two different kinds of "ADR"

Do not confuse these — same acronym, different artifacts, different lifecycles:

|           | Engineering ADRs (this process)                                        | Product ADRs (PRD §C9)                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What      | Decisions about **how we build** ImpactGraph                           | **Persisted clarification decisions** the _product_ records for the analyzed repository — every resolved clarification becomes one                                                       |
| Where     | Markdown in `docs/adr/NNNN-slug.md` in this repo                       | Versioned artifacts inside ImpactGraph's own storage (`.impactgraph/` artifacts of the analyzed workspace)                                                                               |
| Shape     | Status / Context / Decision / Options / Consequences / Revisit trigger | Question, decision, reason, repository snapshot, related requirements/components/contexts, timestamp, author (user or agent), confidence, manual-confirmation flag (PRD §C9)             |
| Lifecycle | Proposed → Accepted → Superseded, human-approved, git-versioned        | Created by the Clarification Engine at analysis time; carries provenance like every knowledge record; reduces repeated questions in future analyses; superseded append-only per ADR-0002 |
| Owner     | `product-architecture` agent + humans                                  | The product code (Clarification Engine); we _implement_ it under the `impact-modeling` / `specification-intelligence` agents                                                             |

When a PRD section, epic, or test mentions "ADR", check which one it means before touching
anything. Implementing the product's ADR artifact schema is contract work
(`packages/contracts/artifacts`, `data-contracts.md`, `artifact-versioning.md`) — it does not go
through this process; changing our _approach_ to implementing it might.

## 5. Current roster (for cross-reference)

0001 local-first architecture · 0002 knowledge-category separation · 0003 TypeScript primary ·
0004 ports and adapters · 0005 Cytoscape for graph view · 0006 hybrid persistence (SQLite index +
JSON artifacts) · 0007 git CLI adapter · 0008 parser strategy (TS compiler API + tree-sitter —
**Proposed**) · 0009 versioned boundary contracts · 0010 AI provider abstraction · 0011 no hosted
backend V1 · 0012 effective-LOC enforcement · 0013 pnpm monorepo. All `Accepted` except 0008.
