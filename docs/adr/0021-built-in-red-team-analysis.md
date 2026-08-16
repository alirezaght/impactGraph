# ADR-0021 — Built-in red-team analysis: persisted preflight outcomes and the explicit red-team surface

Date: 2026-08-16
Status: Accepted
Extends: ADR-0017 (findings as a first-class output), ADR-0018 (constraint extraction trust
model), ADR-0020 (reference queries and typed member facts).

## Context

ADR-0017 made adversarial preflight part of analysis. Dogfooding the finished layers end to end —
a realistic specification against the `guarded-services` fixture through the real
`submit_specification → analyze_impact` path, not through unit-test inputs — showed the pass was
architecturally right and practically starved:

1. **The analyzers never received their inputs.** The analysis path wired
   `configRequirements: []` and `configDeclarations: []`, so the runtime-topology and
   config-semantics checks were unreachable outside unit tests. Concept extraction knew nothing of
   `SCREAMING_SNAKE` environment names, kebab-case service names, or prose service phrases
   ("the user-profile service"), so the constraint checker never saw the proposed relationship the
   guard forbids. Three of the four motivating failures did not surface end to end.
2. **Findings were not persisted.** They were recomputed per call, review could not consume the
   approval-time knowledge, and the `list_preflight_findings` tool the contract prose promised did
   not exist — every finding beyond the bounded summary slice was silently unreachable.
3. **The CLI text summary never rendered the verdict.** A BLOCKED assessment existed in JSON while
   the text output said "Readiness: 100% — Ready for implementation."
4. Two evidence sources the trials wanted were missing entirely: accepted architecture decisions
   (prose ADRs), and the database the test suite actually runs.

There was also an open product question: should there be an explicit "red-team only" analysis
mode?

## Decision

**1. The analysis path feeds every analyzer, deterministically.** Concept extraction adds
`SCREAMING_SNAKE`, kebab-case and lowercase architectural noun phrases; mined (speculative) shapes
resolve silently or drop silently, so hyphenated English cannot flood `unresolvedConcepts`. A
concept equal to a directory segment resolves to that directory's files (`path-segment` mechanism,
capped, `name-similarity` basis ceiling), so a manifest-less service is still an endpoint a
constraint can govern. What configuration the plan needs is derived from hop-zero config-node
matches; how the repository declares it is read from a bounded set of literal shapes
(`os.environ.get`, `process.env X ?? lit`, same-file attribute defaults). A frontend
`*_SERVICE_URL` env read joins the Terraform service-URL map that assembles it
(`framework-convention` provenance, both-sided evidence, ambiguity refuses to link), and hops
crossed on convention edges are `inferred` — they may warn, never block.

**2. The preflight outcome is persisted as its own frozen artifact**
(`artifacts/preflight-outcome.v1`, one per analysis id) rather than as a field on the analysis.
The analysis store's append-only rules stay untouched; approval freezes the analysis while the
adversarial knowledge stays readable. The artifact carries the full finding list, the assessment,
classifications, evidence independence, constraint coverage, and a `planContract` slice —
required configuration names, runtime process node ids, governing constraint ids — which review
merges into its plan-as-contract check. Re-running analysis creates a new analysis id and a new
artifact; nothing is rewritten.

**3. There is no separate red-team analysis mode.** Analysis red-teams unconditionally — a mode
would recreate the "nobody asked the question" failure as "nobody chose the mode". The explicit
"attack the design" surface is `list_preflight_findings`: the full persisted finding list behind
the bounded summary, plus what was checked (analyzer roster, indexed rule count, unreadable
guards), so an empty list is auditable rather than reassuring.

**4. Two new advisory evidence layers, each capped below deterministic enforcement.** Accepted
ADR-shaped documents become `architecture-guidance` constraints (relation `GOVERNS`), scoped to
the repository paths their text literally names; the domain constructor rejects any severity above
`advisory`, and the finding they produce says "read this before implementing", never "violated".
Test-scoped database declarations (connection-string markers in test config files) are compared
against engine-specific SQL in the specification; a mismatch warns with both files as evidence,
and an undeclared test environment produces silence, not suspicion.

**5. Presentation states the two jobs apart.** The text summary leads with the plan assessment,
renders red-team findings as their own section (never mixed into the impact list), and the §11
readiness sentence defers to the verdict whenever the verdict is the stronger claim. A spec-named
component stays a `confirmation` even when a constraint finding cites it — the finding is the
discovery, the echo is not.

## Consequences

- The four motivating failures plus test-environment mismatch, governing ADRs and the invalid
  symbol assumption all surface from one `analyze_impact` call on the fixture, with zero manual
  graph questions. The finding count for the five-problem acceptance spec is eight, not eighty.
- New persisted artifact and MCP tool are additive; v1 consumers keep working. The fragment cache
  is content-hashed, so facts added by newer adapters (Terraform entry selectors) appear only
  after a re-index — the disposable-cache rule of ADR-0017 §9 applies.
- Constraint kind `architecture-guidance` and relation `GOVERNS` extend the closed vocabularies;
  `path-segment` extends the match mechanisms with a `name-similarity` basis ceiling.
- Multi-entry service-URL maps still resolve to "routes to N targets" (an honest incomplete path)
  because map entries are not yet nodes; recorded as a limitation in
  `docs/engineering/capability-limitations.md`.
