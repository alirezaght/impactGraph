# ADR-0025 — Separate planning impact from dependency context, and model absence as a finding

Date: 2026-08-18
Status: Accepted
Extends: ADR-0015 (evidence basis and bounded output), ADR-0016 (architecture-aware concept
matching), ADR-0017 (evidence provenance), ADR-0022 (decision-first outputs), ADR-0023 (evidence
grades). Constrains ADR-0005 (graph view) further.

## Context

ADR-0022 made the default surfaces decision-first: the verdict leads, volume is opt-in, and the
diagram is scoped. It did not change what an impact _is_. The result on a production repository:
106 impacts, of which 11 were concept matches and 95 were dependency traversal from them. Every
one of the 95 was factually true — those files really do depend on components the specification
touches — and none of them was a planning decision.

The evaluation harness reproduces this on the reference fixture: 58 `possible`-tier candidates
across eight sample specifications, of which hand-written ground truth allows 7. Strict precision
0.121 on the tier that dominates every default view.

Three causes, and none of them is a display problem:

1. **The model has no axis for "is this a decision".** `likelihood` answers _how strongly is this
   implicated_, `evidenceTypes` _why_, `evidenceProvenance` _where the evidence came from_,
   `changeExpectation` _what should happen there_. None answers the question a reader opens the
   analysis with. `possible` is the proof: its own documentation says it is not a prediction of
   change, and it sits inside `PREDICTIVE_LIKELIHOODS`, so reachability and obligation render
   identically.

2. **Every surface had its own private theory of what mattered.** The impact diagram filtered on
   "strong tier AND structural basis, OR named by the specification"; `selectImpacts` filtered on
   `minLikelihood`; the CLI printed whatever it was handed. Three filters, three answers, no
   stored record of the decision.

3. **Absence was a warning.** A specification introducing `/threshold-eval/export` produced an
   `unresolved-concept` warning nobody reads, plus impacts on every existing artifact whose name
   happens to contain "export". The absence _was_ the finding — there is no such surface and
   building it is the work — and the output presented the coincidences as the answer.

A node cap does not fix any of this. Truncation picks by score, and score cannot tell "the payment
webhook now receives a new field" (two hops, must plan for it) from "a test helper imports the
module we are touching" (one hop, nothing to decide).

## Decision

**Add a `planningRole` axis to the impact record, derived deterministically from the evidence
already on it, and model an unresolved specification term as a first-class finding rather than as
the absence of one.**

**1. Three roles, one derivation, stored with the rule that produced it.**
`planning-impact` (evidence it matters to satisfying the specification), `dependency-context`
(structurally reachable, insufficient evidence of impact), `investigation-lead` (a name or meaning
resemblance). The derivation is a pure domain function over `likelihood`, `evidenceTypes`,
`evidenceProvenance`, `impactType`, `changeExpectation` and `directness` — every input already on
the record — and it stores `planningRoleRule` and `planningRoleReason` so a reader argues with a
named rule rather than reverse-engineering a filter. `createImpactAnalysis` REJECTS a stored role
that contradicts what the rules derive, the same way it rejects an over-claimed tier.

**2. The ladder promotes as well as demotes.** Demotions: a resemblance reached by traversal is a
lead; plain reachability over ordinary code dependencies is context. Promotions, and these are the
point — a merely-`possible` finding is a planning impact when its route crossed an architectural
boundary (async-event, external-contract, field-data-flow, configuration-asset) or when the surface
it reached carries a contract beyond its own module (api-contract, data-model, migration,
event-contract, background-processing, integration, security, infrastructure, deployment,
business-rule). A regression boundary the author protected, a constraint- or runtime-derived
surface from the adversarial pass, and a component the specification named outright are planning
impacts whatever their tier. So the primary view gains the non-obvious consequences at the same
time as it loses the reachable noise.

**3. A resemblance-resolved SUBJECT stays; a resemblance-reached neighbour does not.** "The `Base`
helper" resolving to `BaseService` is a guess, but it is a guess about what the requirement is
_about_; hiding it leaves an empty plan and nothing to correct. Past distance 0 the guess has been
compounded by traversal. The subject case gets its own rule (`resolved-by-resemblance`) and says on
the line that the name needs confirming.

**4. One selection, echoed.** `selectImpacts` gains a `roles` filter defaulting to
`['planning-impact']`, ranks by role before tier, and echoes the applied roles. The diagram, the
bounded summary, the CLI, `list_impacts` and the HTML export all read that one selection. The
tier-level opt-ins (`includeLexicalOnly`, `includeExcluded`) bypass the role gate, because they are
asks for a named category and answering them with nothing would make them lies.

**5. Nothing is discarded.** Dependency context and leads are reported as counts, kinds and entry
points in a `dependencyContext` block that names the exact `list_impacts` call that pages them; the
stored artifact keeps every impact with its full dependency path, evidence and confidence signals.
An empty primary view over a non-empty analysis marks the result provisional and emits
`report-limited-evidence` — an empty plan is a louder warning than a weak one, not the absence of
one.

**6. Unresolved surfaces are findings with preserved uncertainty.** A specification term that
resolves to no indexed artifact is classified as `new-surface`, `external-dependency`,
`coverage-gap`, `terminology-mismatch` or `insufficient-evidence` — carrying BOTH the best-supported
reading and `alternativeKinds`, the readings the evidence leaves open, because those readings imply
opposite plans. `insufficient-evidence` carries all four alternatives, which is what it means. The
coverage reading is fed by the same roster fact the coverage verdict reads, so the two can never
disagree. Indexed names that came close are reported as `nearestExisting` — vocabulary evidence,
never predictions of change. They are carried beside the impacts, never merged into them, exactly
as `proposedStructure` is, and no node is ever created for them.

**7. A path- or route-shaped concept never falls back to name similarity.** A concept written with
a separator names one specific place: it resolves verbatim, by unique suffix, or by the directory it
names — or it does not exist here. A component whose name merely resembles it is a different
component, not a weaker reading of the same one.

## Options considered

- **Cap the primary graph at N nodes.** Rejected: truncation ranks by score, and score is exactly
  the thing that cannot distinguish a consequence from a neighbour. It would also hide the same
  proportion of good findings as bad ones.
- **Reduce `maxDepth` / prune the traversal.** Rejected: the traversal is what finds the
  boundary-crossing consequences the primary view should GAIN. Pruning it makes the analysis worse
  and the graph smaller at the same time.
- **Redefine the `possible` tier instead of adding an axis.** Rejected: the tier is a claim about
  change likelihood and is used that way by review, coverage and confidence. Overloading it with
  "is this a decision" is how `possible` came to mean two things at once.
- **Filter in the presentation layer only.** Rejected as already tried — ADR-0022 §7 did exactly
  that, and the result was four surfaces with four private theories of relevance and none of them
  recorded.

## Consequences

- Positive: measured on the reference fixture — 5 of 58 `possible`-tier candidates survive into the
  primary view, of which exactly one is judged unsupported by ground truth; all 8 ground-truth
  direct impacts are retained; the primary set is 30 of 85 impacts. Absences are readable before
  the components that do exist. Every surface labels the same record identically.
- Negative / accepted costs: one additional axis on the impact record and its DTOs (additive, with
  a re-deriving accessor); `list_impacts` changes its default result set, which is a behaviour
  change for existing callers even though the data is one filter away; the architectural-consequence
  rule is deliberately generous about contract-bearing surfaces, so an API handler reached from a
  changed repository stays in the plan even when it would not have changed.
- Packages affected: domain (impact), application (build-impact-model, analyze-specification),
  contracts (cli, tools), workspace-engine (reports, specifications), test-kit (evaluation metrics),
  apps/cli, apps/mcp-server.
- Backward compatibility: `planningRole` is additive and re-derives when absent, so stored analyses
  classify identically to fresh ones. `unresolvedSurfaces` is additive and absent on older
  artifacts, which reads as "the producer predates the axis", never as "every concept resolved".
  `unresolvedConcepts` is still emitted beside `unresolvedSurfaces` so no consumer breaks.
- New human-approval obligations: none beyond the existing schema-change and ADR rules.

## Revisit trigger

Revisit if a real run shows a planning impact a reader would have wanted demoted more often than
one they would have wanted promoted — specifically if the `architectural-consequence` rule is
observed admitting whole controller layers — or if the evaluation harness's
`keptButUnsupported` gate has to be raised to accommodate an otherwise-correct change. Revisit the
unresolved-surface classifier if `insufficient-evidence` becomes the majority verdict in practice,
which would mean the signals are too weak to be worth classifying on.

## Links

- PRD: §13, §14, §18, §41, §46, §C2
- Related ADRs: ADR-0015, ADR-0016, ADR-0017, ADR-0022, ADR-0023 (builds on); ADR-0005 (scopes)
- Docs updated: docs/engineering/provenance-model.md, data-contracts.md
