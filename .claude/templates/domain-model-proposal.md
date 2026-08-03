# Domain Model Proposal: <concept name>

_For any new or reshaped concept in packages/domain. Reviewed by the domain-provenance agent with
the domain-provenance-development skill. Domain code is pure: no I/O, no Date.now(), clock and
identifier ports only._

- **PRD grounding:** §<n> <quote the sentence(s) that force this concept to exist>
- **Epic:** backlog/epic-<NN>-<name>.md
- **Author / date:** <name> / <YYYY-MM-DD>

## Concept definition

_What it models in the product's language (Specification, Requirement, ImpactAnalysis,
RepositorySnapshot, GraphNode, Evidence…). One paragraph, no TypeScript yet._

_TBD_

## Invariants

_Rules that can never be violated by any operation. Each becomes at least one unit test._

1. <e.g. "confidence is always 0..1 and always accompanied by ≥1 contributing signal (PRD §14)">
2. <...>

## Provenance fields carried (PRD §12.3)

- provenance: <which values are legal for this concept: static-analysis | configuration |
  git-history | framework-convention | llm-inferred | human-confirmed>
- evidenceIds: <required? min count?>
- confidence: <computed from which signals (PRD §14) — never model-authored>
- repositorySnapshotId / specificationVersion / analysisRunId: <which apply>
- createdAt: <via clock port>

## Evidence and confidence handling

_How evidence attaches, how confidence is derived, what happens with zero evidence (downgrade,
never delete — PRD §34)._

_TBD_

## Supersession and contradiction behavior (PRD §3, §16)

- What supersedes instances of this concept: <human confirmation | new analysis version | ...>
- Supersession mechanics: new record + `superseded` status on old; history append-only — confirm
  this concept follows that, or justify deviation (needs ADR)
- Contradicting evidence: <represented via CONTRADICTS edge / warning — never resolved by deletion>

## Staleness rules

_When does an instance become stale (snapshot mismatch, spec version change)? Stale = flagged,
never silently refreshed._

_TBD_

## Relationships to existing domain types

| Related type                                                              | Relationship                             | Edge type (if graph-visible, PRD §12.2) |
| ------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| <Specification / Requirement / ImpactAnalysis / RepositorySnapshot / ...> | <owns / references by ID / derived from> | <e.g. SATISFIES, MAY_AFFECT, n/a>       |

## Rejected alternatives

_Modeling options considered and why they lose. Prevents re-litigating in review._

- <alternative>: rejected because <...>

## Pure-domain test list (vitest `unit` project)

_Named tests to write first (test-first, per the main skill §6)._

- [ ] <invariant 1 holds on construction>
- [ ] <supersession produces new record, old marked superseded, history intact>
- [ ] <staleness flagged when snapshot ID mismatches>
- [ ] <illegal provenance value rejected with typed error>
- [ ] <...>
