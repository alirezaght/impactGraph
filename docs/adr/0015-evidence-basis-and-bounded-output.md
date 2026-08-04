# ADR-0015: Evidence Basis, Bounded Output, and Explicit Query Provenance

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Project maintainer, Claude Code

## Context

Two real-world trials of ImpactGraph found the core idea sound — it ranked true core files highly,
and the HTML export was useful as a ticket artifact — but the implementation unusable as a discovery
and planning tool. Reduced to mechanisms rather than symptoms, the trials exposed four distinct
design faults:

1. **Confidence was the only quality signal.** Two impacts could score 0.6 because one was a call
   away from a component the specification named and the other shared a word with it. A reader had no
   way to tell them apart, so a keyword coincidence could be presented as `required`.
2. **Every result was a full result.** `analyze_impact` returned every impact of every requirement
   with full dependency paths — hundreds of kilobytes on a real repository. An agent could not read
   its own tool's answer, so the answer got written to a file and grepped.
3. **Absence was ambiguous.** "No callers", "the query was not run", and "the index is two days old"
   all serialized to an empty array. An agent reading one picked the most useful reading and acted on
   it.
4. **Specification structure was discarded.** Prose was sentence-split into dozens of "requirements",
   non-goals became positive impacts, and explicit `R1`–`R7` lists were ignored — so every downstream
   count measured the extractor's guess rather than the specification.

## Decision

Four coupled changes, each in the domain so no adapter can bypass it.

### 1. Every impact records WHY it was selected, and the basis caps the tier

`RequirementImpact` carries `evidenceTypes` from a closed vocabulary (`direct-structural`,
`transitive-structural`, `async-event`, `external-contract`, `field-data-flow`,
`configuration-asset`, `semantic-match`, `lexical-only`), and each basis has a **tier ceiling**. The
`ImpactAnalysis` factory REJECTS a record claiming a tier its basis does not permit — a lexical match
cannot be labeled `required` by any code path, including a future model pass.

Rejected alternative: a numeric penalty on weak evidence. Penalties are commensurable, so enough
weak signals still add up to a strong claim; a ceiling is not.

Two tiers join `IMPACT_LIKELIHOODS`: `lexical-only` (a text overlap, a real result but not a
prediction) and `excluded` (a specification non-goal ruled it out). Both are hidden from default
views and both stay in the analysis, because an append-only record must show what was ruled out.

### 2. The default response is a bounded summary

`analyze_impact` and `impactgraph analyze` return `cliImpactSummarySchema`: status, extraction
quality, index freshness, coverage, counts by tier and by basis, the top structural impacts,
unmatched requirements, unresolved concepts, blocking questions, and the important warnings.
Full detail moved to `list_impacts` (paginated, filterable) and `--full`.

Rejected alternative: a `verbose` flag defaulting to the old behaviour. The failure was that the
expensive shape was the DEFAULT; leaving it there and adding an opt-out preserves the failure for
every caller who does not know to opt out.

### 3. Absence must state its own scope

`QueryOutcome` (`not-run` | `completed` | `completed-empty` | `partial` | `failed` |
`human-confirmed`) is required on every query surface, with a mandatory `scope` string and a
`limitations` list. Its constructor derives the status from the result count, so a producer cannot
report `completed` with nothing in hand, and validation rejects an outcome with a blank scope.

`IndexFreshness` is derived at READ time from HEAD, the working tree, the indexed timestamp and the
stored specification version — never persisted, because a persisted freshness flag is stale by the
next commit. Indexing warnings are grouped into categories and paired with whether they overlap the
predicted area, so a count becomes a caveat on a specific result.

### 4. Specification structure outranks heuristics

Requirements come from the author's own structure — explicit labels, numbered lists, acceptance
criteria, task lists — with headings classified into roles (requirements, context, constraints,
non-goals, implementation notes, open questions). Sentence-splitting runs only when the document
declares no structured content, and when it does the extraction reports it prominently; past a
threshold it is marked `provisional` and readiness is WITHHELD rather than lowered.

Non-goals act as exclusions: they downgrade impacts to `excluded`, and where a non-goal contradicts a
`required` structural impact the contradiction is reported rather than silently resolved.

## Consequences

- Contracts gained additive fields only; `cliAnalyzeOutputSchema` is unchanged and still reachable.
  `analyze_impact`'s OUTPUT schema changed, which is a breaking change for that tool, taken
  deliberately: the previous payload was unusable at its intended scale.
- The traversal roster gained async, contract, asset and field-flow relationships, plus a bounded
  **chain-hop budget** separate from the structural depth budget. An event chain can be followed to
  its end without widening every import walk; the tier still falls with distance, so the chain is made
  visible rather than made confident.
- `record_actual_impact` closes the measurement loop. Outcomes are strictly append-only evidence: they
  never mutate an analysis, never rewrite confirmed knowledge, and never train anything.
- Golden fixtures moved deliberately in the same commits, with the movement counts named in
  `graph-goldens.test.ts` and `analysis-goldens.test.ts`.

## Revisit triggers

- If measured precision at `required`/`likely` (from `record_actual_impact` records) stays below 0.6
  across ten real outcomes, the tier ceilings are not doing enough and the basis vocabulary needs
  splitting further.
- If `missedRelationshipTypes` repeatedly names the same relationship, that relationship needs an
  extractor rather than a wider traversal.
- If the bounded summary is routinely followed by a full `list_impacts` fetch, the summary is missing a
  field the reader needs; add it rather than raising `topN`.
