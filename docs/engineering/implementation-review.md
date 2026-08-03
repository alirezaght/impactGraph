# Review Engine (Implementation Review)

Design reference for the review half of the Impact & Review Engine (PRD §C15.3) — the **product
feature** "Review Implementation" that compares a user's approved impact model against their
actual Git changes (PRD §10.5, §24). Naming note: this is not our dev workflow — reviewing _our
own_ PRs happens via `/review-contracts`, `/architecture-review`, etc. See the terminology guard
in `bounded-contexts.md`. Code: `application/review-implementation` + `domain/review`, diffs from
`packages/git` (ADR-0007), symbol-level interpretation via `LanguageAdapter.analyzeDiff`
(`language-adapters.md`). Owner: implementation-review agent.

## Inputs and baselines (PRD §23.2)

A review takes exactly three inputs, all identified by stable IDs (`data-contracts.md`):

1. **Approved analysis snapshot** — the immutable approved `ImpactAnalysis` (PRD §40.3) with its
   `repositorySnapshotId` (the _baseline_ state the prediction was made against).
2. **Review target** — MVP: current working tree vs. current commit
   (`impactgraph review --working-tree`), or current commit snapshot
   (`--commit HEAD`). Branch/range/PR targets are post-MVP (PRD §23.3) but the target descriptor
   is already a polymorphic contract so they slot in without schema surgery.
3. **Current index** — the knowledge graph bound to the target state
   (`repository-analysis.md`); the review triggers an incremental reindex of changed files first.

If the approved analysis's baseline snapshot no longer matches the merge-base of the target (the
repo moved on since approval), the review still runs but is flagged **stale baseline** — reported,
never silently ignored (`provenance-model.md` staleness).

## Diff interpretation (never filename-only — PRD §24)

`packages/git` produces the raw diff (rename/copy detection on); language adapters lift it to
symbol level (`GraphChangeSet`): changed files, changed/added/removed symbols, changed imports,
calls, routes, database models, migrations, events, Pub/Sub relationships, Terraform resources,
Cloud Run configuration, tests, and architectural edge changes.

Edge cases with defined behavior (each has a fixture diff + golden test, PRD §42.3):

| Case                                                      | Behavior                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rename                                                    | Tracked as the same logical component (`git diff -M`); a rename alone is not an "unexpected change", but symbol-level diffs inside the renamed file still count |
| Copy                                                      | New component with lineage evidence to the source (`-C`); classified on its own merits                                                                          |
| Deletion                                                  | Removed nodes/edges; a deletion of a predicted-required component is Divergent or Missing depending on requirement semantics, never silently "matched"          |
| Binary file                                               | No symbol diff possible; file-level change only, contributes Unverifiable to any requirement that depends on its contents                                       |
| Submodule                                                 | Pointer change recorded as a single integration-boundary change; contents not analyzed in V1                                                                    |
| Untracked files (working-tree review)                     | Included — new untracked source is exactly the "unexpected change" case users need caught                                                                       |
| Merge commit                                              | MVP targets (working tree / single commit) avoid it; if encountered, diff against first parent and flag the review                                              |
| Empty diff                                                | Valid review: everything predicted `required` is Missing; report says so plainly rather than erroring                                                           |
| Missing baseline (approved snapshot's commit unreachable) | Review refuses with a typed error naming the missing snapshot — it never guesses a baseline                                                                     |

Adapters never see language specifics leak upward: the comparison below operates purely on the
neutral graph and `GraphChangeSet` (PRD §C14), which is what makes cross-stack review work
(PRD §C16: cross-stack implementation review).

## Before/after graph comparison

The engine compares the baseline graph (approved snapshot) with the target graph: nodes
added/removed/modified, and architectural edges introduced or removed — new `IMPORTS`, `CALLS`,
`PUBLISHES`, `SUBSCRIBES_TO`, `READS_FROM`/`WRITES_TO`, `DEPLOYED_AS` edges (PRD §10.5 "new
dependencies, removed dependencies"). Edge changes are evaluated against architecture rules
(PRD §27) — e.g. "domain must not import infrastructure" — producing rule-violation findings with
evidence (rule ID + the offending edge + source ranges).

## The six result categories (PRD §24.1)

Every (requirement-impact × actual-change) pairing lands in exactly one category:

| Category               | Classification rule                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Matched**            | Predicted node (or its rename-tracked successor) changed, and the change kind is consistent with the predicted `impactType` and expected changes (e.g. predicted `data-model` impact and the model symbol changed)                     |
| **Missing**            | Impact with likelihood `required` in the approved model, node unchanged, and no evidence explains the absence (no accepted deviation, no equivalent change elsewhere mapped to the same requirement)                                   |
| **Unexpected**         | A component changed that appears nowhere in the approved analysis (neither accepted nor explicitly rejected) — including brand-new untracked files                                                                                     |
| **Divergent**          | Predicted node changed, but differently from the approved architectural direction — e.g. approved Option A (query-time visibility) but the diff adds a scheduled job; or the change introduces edges the approved model excluded       |
| **Unverifiable**       | The engine cannot tell — binary files, fallback-only language coverage, adapter degradation (`language-adapters.md`), or requirements with no mappable concept. Stated honestly, never rounded to Matched or Missing                   |
| **Accepted deviation** | The user approved a discrepancy and recorded a reason — a human decision record (provenance `human-confirmed`) that supersedes the finding's open status, append-only per `provenance-model.md`. The finding itself remains in history |

Classification inputs are deterministic (graph diff + approved model). Where AI assists in judging
"consistent with the specification" for Matched-vs-Divergent, that judgment is provenance
`llm-inferred`, carries evidence, may only reference existing nodes, and is downgraded when
unsupported — same rules as everywhere else (PRD §34).

## Requirement coverage (PRD §25 — an estimate, not proof)

The engine maps actual changes back to requirements (via the approved model's
requirement→node mappings plus concept matching on new symbols) and reports per requirement:
implemented / partially implemented / not found / unverifiable, with per-evidence checkmarks in
the PRD §25 style (`✓` query filtering added, `✕` no background process found, `?` migration
unclear). Coverage is always labeled an **estimate**; the report never states "requirement R1 is
implemented" as fact — only what evidence was and was not found.

## Drift findings

Architectural drift (PRD §C15.3) = structural change beyond the feature's footprint: new
cross-context dependencies, rule violations, edge-direction reversals, contexts touched that no
requirement maps to. Drift findings carry the same record shape as impacts (provenance, evidence,
snapshot, run IDs) and feed the "Potential architectural violations" and rule-violation report
sections.

## Report structure (PRD §38.2)

The review report artifact (immutable, `artifact-versioning.md`; exportable as Markdown and JSON,
PRD §40.5) contains, in order: 1 review summary, 2 approved specification, 3 matched changes,
4 missing expected changes, 5 unexpected changes, 6 divergent changes, 7 requirement coverage,
8 architecture rule violations, 9 test discrepancies, 10 migration discrepancies,
11 infrastructure discrepancies, 12 accepted deviations, 13 recommended follow-up actions.
Every finding links its evidence IDs, the approved analysis ID, both snapshot IDs, and the review
run ID — the seven provenance questions must be answerable from the report alone.

## What the engine must NOT claim

- **A discrepancy is not a defect.** Missing/Unexpected/Divergent are findings for a human (or
  agent) to investigate (PRD §10.5) — the report's language is "did not change / was not in the
  approved model", never "bug" or "wrong".
- **No auto-approval.** The engine never approves an implementation, never marks its own review
  "passed", and never auto-converts findings into accepted deviations (PRD §7, §21: "ImpactGraph
  itself should not silently approve an analysis or implementation"). Acceptance is a human
  decision record, requiring confirmation through the UI/CLI/MCP (state-modifying MCP tools need
  confirmation, PRD §35).
- **No proof language.** Coverage is estimated; Unverifiable is a legitimate, prominent outcome
  (PRD §43.6 mitigates false authority with explicit uncertainty).
- **No silent baseline substitution** and no review of a model that was never approved — reviewing
  a `draft` analysis is a typed error.
