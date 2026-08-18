# Provenance and Knowledge Model

This is the deep reference for ImpactGraph's core invariant (PRD §3; ADR-0002; CLAUDE.md rule 1):
deterministic facts, AI-inferred interpretations, and human-confirmed knowledge are never mixed —
structurally, semantically, or visually. The types live in `packages/domain/src/provenance/`;
their persisted representations in `packages/contracts/artifacts` (see `data-contracts.md`,
`artifact-versioning.md`). Any change to the semantics described here requires human approval.

## The Provenance enum and the three knowledge categories

PRD §12.3 defines seven provenance values. They map onto exactly three knowledge categories:

| Knowledge category         | Provenance values                                                         | Produced by                                                    |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Deterministic fact         | `static-analysis`, `configuration`, `git-history`, `framework-convention` | Repository Intelligence Engine, adapters, `packages/git`       |
| AI-inferred interpretation | `llm-inferred`                                                            | `packages/ai-inference` via the `ModelProvider` port           |
| Human-confirmed knowledge  | `human-confirmed`                                                         | Explicit user action (accept/reject/correct/confirm)           |
| _(reserved)_               | `runtime-observation`                                                     | Nobody in V1 — the enum value exists, no code path may emit it |

Category is **derived** from provenance, never stored separately (one source of truth, no drift).
Domain code exposes `knowledgeCategoryOf(provenance)`; UI, exports, and reports must key their
visual/structural separation off that function.

## Every knowledge record carries

Every node, edge, impact, requirement mapping, discrepancy, and configuration value carries
(main skill §3):

- `provenance` (one of the seven values)
- `evidenceIds` — at least one for anything not `human-confirmed`; empty evidence on an
  `llm-inferred` record is invalid by construction
- `confidence` with stored contributing signals (below)
- `createdAt` — via the clock port, never `Date.now()` in domain code
- `repositorySnapshotId` (PRD §23.1), `specificationId` + `specificationVersion` (PRD §11),
  `analysisRunId`

## Evidence records

An evidence record is an immutable, individually addressable proof unit:

- **ID**: stable `EvidenceId`, deterministic where reproducibility helps
  (`artifact-versioning.md` ID scheme) so the same fact re-derived from the same snapshot gets the
  same ID.
- **Source binding**: file path + source range (start/end line and column — PRD §18.5 requires
  navigable "relevant source ranges"), symbol name where applicable, or the config key /
  git commit that grounds the claim.
- **Snapshot binding**: the `repositorySnapshotId` the evidence was read from. Evidence never
  claims to describe "the repository now" — only a specific snapshot.
- **Kind**: what sort of proof (import statement, call site, decorator, terraform resource,
  co-change history, config entry, human statement, model output reference, file presence,
  symbol declaration).

AI records additionally carry provider + model metadata (`data-contracts.md`). AI output may only
reference node IDs that exist in the deterministic graph; references to nonexistent nodes are
rejected, and claims whose cited evidence does not support them are **downgraded** — marked
unsupported with reduced confidence — never deleted and never promoted (PRD §34, §43.2).

## Confidence: weighted deterministic signals

Confidence is never a number an LLM produced on request (PRD §14). It is computed in
`application/build-impact-model` from weighted signals; both the score and the per-signal
contributions are stored on the record so the UI can always answer "why this number".

Signals (PRD §14): exact concept-to-symbol match; semantic concept match; direct import; direct
function call; direct data access; API ownership; event relationship; shared bounded context;
framework convention; historical co-change; test association; documentation match; human-confirmed
mapping; graph distance; ambiguity; conflicting evidence; unsupported inference. The last four are
penalties. Weights live in domain code under test — changing them is an impact-modeling decision
(`bounded-contexts.md`), and stored records keep the contributions they were computed with, so old
scores remain explainable after a re-weighting.

## Anchor grade: what a name match is worth (ADR-0022)

The `exact-concept-to-symbol-match` weight (0.9) is reserved for IDENTIFIER-GRADE anchors: a
concept that resolved to a component by path — verbatim, or by a unique path-boundary suffix, so a
service-relative `src/domain/alert/eligibility.py` resolves inside its package — or a name match to
a symbol-grade node. Two shapes are deliberately weaker, because equality of a string is not
evidence that the author meant that component:

- **Container names** (package, workspace, repository, directory nodes) cap at `possible` with the
  `container-name-match` signal. A specification that names the product it is about was
  anchoring `required` impacts on the root `package.json`.
- **Bare filenames** (an extension, no slash) are not identifier-grade: they take part in collision
  assessment, and even a unique match caps at `likely` under the ADR-0015 tier ceiling with the
  `basename-file-match` signal. `specification.ts` matched the wrong `specification.ts` at 0.9.

Ambiguous suffix resolutions never anchor a `required` impact; they become clarification questions
listing the candidates, which is the honest reading of "several places match this".

## Supersession: append-only, human-confirmed wins

Human confirmation **supersedes** prior knowledge; it never rewrites it (CLAUDE.md rule 1):

- A confirmation/correction creates a **new** record with `provenance: human-confirmed` and a
  `supersedes: <recordId>` link. The old record gains status `superseded` (a status change, not a
  content change) and is retained forever.
- Chains are walkable in both directions: latest-active ← … ← original. Queries default to the
  active head; audit views show the chain.
- Only `human-confirmed` records supersede across categories. Re-running analysis produces new
  records in a new `analysisRunId` — it never supersedes a human-confirmed record (PRD §43.3,
  §Z5 precedence). A human decision loses authority only when the user changes it or the
  referenced component no longer exists (§Z5) — the latter makes it _stale_, not deleted.

## Contradictions

When two claims conflict (deterministic evidence vs. an inference, or two inferences), both are
retained and linked with a `CONTRADICTS` edge (PRD §12.2). Contradiction is a first-class state:
it lowers confidence (the "conflicting evidence" signal), is surfaced in the evidence panel, and
is resolved only by a human-confirmed record that supersedes one side. Deletion is never a
resolution mechanism.

## Staleness

A record is **stale** when its `repositorySnapshotId` or `specificationVersion` no longer matches
the current snapshot/spec. Staleness is detected by comparison at read time (or at reindex), is
flagged — never silently refreshed — and stale records are excluded from new confidence
computations until re-derived under the current snapshot. Approved analyses whose snapshot has
moved on stay valid _as records of what was approved_ (PRD §40.3) but are marked stale for
decision-making purposes.

## Role is not provenance (ADR-0025)

`planningRole` says what a record is FOR — a planning decision, dependency context, or a lead. It
is **derived** from provenance, evidence basis, tier, impact type, change expectation and
directness; it never replaces any of them and never crosses a knowledge category. A
`dependency-context` impact is still a deterministic fact with full evidence and a dependency path;
it is filed as context because nothing establishes that it must change, not because it is less
trustworthy. Demoting a record's role is therefore not a provenance operation: no supersession is
created, no history is rewritten, and the record answers all seven questions below exactly as it
did.

The rule that produced the role (`planningRoleRule`) and its sentence (`planningRoleReason`) are
stored with it, so "why is this in my plan" is answerable from stored data alone — the same
standard every other claim is held to.

## The questions the system must always answer

For every displayed or exported claim, the model must be able to answer, from stored data alone:

1. Where did this come from? (provenance value)
2. Is it deterministic, AI-inferred, or human-confirmed? (derived category)
3. What is the evidence? (evidence IDs → source ranges, navigable)
4. When was it established? (clock-port timestamp)
5. Against which repository snapshot, specification version, and analysis run?
6. Is it stale?
7. Has it been superseded, and by what?

A record type that cannot answer all seven is not a valid knowledge record. `/review-provenance`
checks exactly this list.

## Worked example (PRD §3)

The PRD's canonical example, as records:

1. **FACT** — edge `DealService —IMPORTS→ DealRepository`. Provenance `static-analysis`;
   evidence: import statement at `src/deals/application/DealService.ts` lines 3–3, bound to
   snapshot `snap-4f8a29c`; confidence 1.0 (direct import signal only).
2. **INFERENCE** — impact "the new visibility rule may affect `DealSearchIndexer`" as a
   `MAY_AFFECT` edge / `RequirementImpact` with provenance `llm-inferred`, likelihood `likely`.
   Evidence: the deterministic dependency path `DealService → DealUpdated (PUBLISHES) →
DealSearchIndexer (SUBSCRIBES_TO)` plus the concept match "visibility". Confidence 0.74:
   +event relationship, +semantic concept match, −graph distance 2, −one ambiguity (spec does not
   say whether search results must hide expired deals). It references only node IDs present in the
   deterministic graph.
3. **CONFIRMED** — the user confirms "DealSearchIndexer belongs to the Search context". New record,
   provenance `human-confirmed`, `supersedes` the earlier `llm-inferred` context assignment; the
   old record is retained with status `superseded`. On the next analysis run, the
   "human-confirmed mapping" and "shared bounded context" signals now contribute, and the
   `MAY_AFFECT` inference is re-derived with higher confidence — as a **new** record in the new
   run, leaving the 0.74 record intact in history.

At no point do the three records share a category, and each can answer all seven questions above.
