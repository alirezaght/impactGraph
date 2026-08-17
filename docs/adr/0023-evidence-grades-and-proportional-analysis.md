# ADR-0023 — Evidence grades, one authoritative verdict, and analysis proportional to the change

Date: 2026-08-17
Status: Accepted
Extends: ADR-0017 (findings as a first-class output), ADR-0018 (constraint extraction trust model),
ADR-0021 (built-in red-team analysis), ADR-0022 (decision-first outputs).

## Context

A third real-world evaluation, run before ADR-0022 shipped, reported problems that survive it.

**A false BLOCKED verdict is far more damaging than an uncertain warning.** A developer who watches
the gate stop a valid specification learns to override the gate, and every later legitimate block
is worth less. The evaluation's blocking findings did not distinguish three different claims:

- ImpactGraph has evidence the plan **contradicts** the repository;
- ImpactGraph **could not establish** whether an assumption holds;
- ImpactGraph's **own model, index or resolver** did not reach far enough to say.

Only the first justifies stopping work. In the code, `BLOCKABLE_KINDS` gated blocking by finding
KIND, and `runtime-topology-gap` — a kind that is by nature an absence ("we did not find the
config on that path") — was blockable.

**The verdict contradicted itself.** The evaluation produced `readiness: 94` beside
`feasibility: BLOCKED`. Both halves were internally defensible: the score counts open questions,
the verdict weighs findings. A reader cannot tell which to believe. The existing reconciliation
overrode only the recommendation _sentence_; the number stood.

**Limitations of the analysis masqueraded as risks in the plan.** Terraform expressions such as
`local.*_service_url` that ImpactGraph's resolver cannot follow produced runtime-topology findings
attributed to _every requirement in the run_ (`requirementIds: [...input.requirementIds]`), so one
pre-existing unreadable expression appeared as a fresh risk under each requirement. Nothing in the
finding model distinguished "your plan may be wrong" from "we could not see".

**Preservation requirements were invisible or inverted.** Real specifications say "The send job
must not change behavior" and "Existing lookup behaviour remains unchanged" to establish a
regression boundary. A heading of "Unchanged behaviour" matched the `requirements` rule and its
bullets became positive change requirements; "must not change" hit the strong-modal branch and
became a requirement predicting change; "Explicitly unchanged" matched nothing and was dropped.

**Analysis cost did not track task complexity.** A change local to one service, cleanly factored
and exhaustively traceable with a few greps, received the same traversal budget and the same
analyzer depth as a cross-service event-driven change.

## Decision

**1. Blocking is a claim about evidence, not a severity a producer may assert.** Findings carry
`verification: verified-contradiction | unverified-assumption`. `isBlocking` is a conjunction —
blocking severity AND a verified contradiction AND a finding about the plan — and the domain
constructor _refuses_ to build a blocking finding that does not state a verified contradiction. A
member absent from a closed member set, an authoritative path-matched guard, a config gap on a
fully-read runtime path are contradictions. Everything else asks.

**2. `NEEDS_VERIFICATION` is its own verdict.** When assumptions could not be established and no
contradiction was found, the plan is not BLOCKED and not silently READY: the verdict says so, and
its decision sentence states explicitly that this is not evidence the assumption is false.

**3. Findings declare whose problem they are.** `origin: plan-finding | analysis-caveat |
background-condition`. Only plan findings are red-team findings: they alone feed the assessment
counts and the `preflightFindings` slice. Analysis caveats are reported in their own
`analysisCaveats` block, carry no requirement attribution (their subject is our resolution, not
the plan), and are collapsed by repository subject — one unreadable deployment chain is one
caveat however many requirements were in the run, and a wide spread of the same limitation
collapses into a single statement that says how many it stands for.

**4. The verdict is authoritative; the score is reconciled to it.** Each feasibility carries a
score ceiling (BLOCKED 20, INSUFFICIENT_COVERAGE 40, NEEDS_CLARIFICATION 60, NEEDS_VERIFICATION 70,
READY/READY_WITH_WARNINGS 100). A score above its ceiling is reported at the ceiling with
`scoreCappedReason` naming the original figure. The pair (94, BLOCKED) is now unrepresentable.

**5. "Must remain unchanged" is a first-class requirement kind.** A preservation section role and a
requirement `intent` axis keep regression guards distinct from both positive requirements and
non-goals: a non-goal is out of scope (its impacts are `excluded`; a change there is unexpected),
while a guard is IN scope, expected to be exercised, and must show no behavioural diff. Guards
carry into the impact model on the ADR-0022 `changeExpectation` axis and into review, which can
answer "did the implementation alter something the specification intended to preserve".

**6. Analysis depth follows the shape of the change.** Before traversal, the anchors concept
matching already produced are judged: a change whose resolved surfaces sit in one top-level
component, touch no queue/contract/deployment surface, and take part in no async or deployment
chain is `contained`, and walks a shorter chain budget (1 hop rather than 8) with an order of
magnitude fewer expansions. Anything else keeps the full walk. The judgement reads anchors and
their own incident edges — no extra traversal — and is conservative by construction: an anchor
that merely publishes to a topic is distributed, because the cost of under-analyzing a distributed
change is much higher than the cost of over-analyzing a local one.

## Options considered

- **Rename existing warnings** ("blocking" → "critical warning"): rejected. The evaluation
  explicitly asked for the decision semantics to be correct, not the labels softened.
- **Keep gating blocking by finding kind**: rejected. Kind describes the subject matter; whether a
  particular finding is proof or suspicion varies within a kind (a runtime gap on a fully-read path
  vs one on a chain we could not finish reading).
- **Solve the score contradiction in presentation**: rejected explicitly by the feedback — a state
  that can produce contradictory conclusions will eventually surface one.
- **Model preservation as a non-goal**: rejected. It would demote the protected surface out of the
  predictive set, so review could no longer verify the guard held — the opposite of the intent.

## Consequences

- Positive: BLOCKED regains meaning; uncertainty routes to investigation; a tool limitation can no
  longer read as a flaw in the user's plan; readiness and verdict cannot disagree; regression
  boundaries are understood and verifiable; contained changes cost less to analyze.
- Negative / accepted costs: producers must now state their evidence grade — an omission means
  "unverified", so a genuine contradiction reported without the field is under-claimed rather than
  over-claimed (the safe direction). The containment heuristic can under-analyze a change whose
  reach is invisible at its anchors and one hop out; the conservative bias limits but does not
  eliminate this.
- Packages affected: domain (preflight, specification, impact, review), application (preflight,
  build-impact-model, analyze-specification, review-implementation), workspace-engine (reports),
  contracts, apps/cli.
- Backward compatibility: all contract changes additive-optional with defaulting readers; stored
  artifacts remain readable. `NEEDS_VERIFICATION` is a new enum value consumers must tolerate.
- New human-approval obligations: none beyond the existing schema-change and ADR rules.

## Revisit trigger

The next evaluation that reports a BLOCKED verdict the developer judged wrong — or a contained
change where the shortened walk missed a surface that mattered. Either observation reopens the
evidence grades or the containment heuristic respectively.

## Links

- PRD: §11, §13, §14, §24, §25, §C2–C10
- Related ADRs: ADR-0017, ADR-0018, ADR-0021, ADR-0022 (builds on)
- Docs updated: docs/engineering/provenance-model.md, implementation-review.md
