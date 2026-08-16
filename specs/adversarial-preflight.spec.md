# Specification — Adversarial Architectural Preflight

## Goal

Move ImpactGraph from "what code is related to this specification?" toward "what is wrong,
incomplete, impossible, or dangerous about this plan before someone implements it?", and after
implementation toward "did the implementation satisfy the approved plan, and did it introduce
anything the plan did not account for?".

## Non-goals

- ImpactGraph must not become an implementation assistant.
- It must not replace grep, LSP, or code-exploration agents.
- No general symbolic execution engine.
- No universal deployment-description language.

## Requirements

R1. Index repository rules and invariants as first-class constraint entities, with sources such as
CI scripts, architecture validation scripts, lint rules, dependency rules, allowlists, denylists,
and tests that enforce architecture rather than behaviour.

R2. Constraint relationships must carry explicit semantics — FORBIDS, REQUIRES, ONLY_ALLOWED_FROM,
ONLY_ALLOWED_TO, MUST_PASS, RESTRICTS_DEPENDENCY, REQUIRES_CONFIG, REQUIRES_RUNTIME, OWNS,
EXEMPTS — and must not be flattened into generic dependency edges.

R3. Extract constraints from `ci/scripts/*`, custom lint scripts, forbidden-import checks,
forbidden peer-HTTP checks, Terraform checks, and shell/Python/TypeScript validation scripts, with
their scope, rule, exemptions and severity. The representation must be extensible; no single rule
may be hardcoded.

R4. Evaluate every requirement against the indexed constraints and report blocking architectural
violations, naming the requirement, the proposed relationship, and the governing constraint with
its source location.

R5. Honour exemptions: the same relationship proposed from an allowlisted location must not produce
a blocking violation.

R6. Model runtime and deployment topology as distinct from source dependencies: Terraform modules,
resources, locals, variables, outputs, Cloud Run services, containers, environment variables,
secrets, gateways, aggregators, service URLs, and frontend-to-backend routing.

R7. Support runtime traversal from a frontend surface through a configured URL, a Terraform
output/local, a runtime resource, a container, and a handler to the required configuration, and
detect gaps in that chain.

R8. Detect runtime configuration gaps: when a plan configures service X but production traffic
reaches X through process Y that does not receive the required configuration, report a runtime
topology gap.

R9. Validate symbol members beyond the file level — enum members, class members, TypeScript union
literals, Pydantic/schema fields, route identifiers, event names, config keys, environment variable
names, localization keys, and feature flags — and report an invalid assumption when a referenced
member does not exist at the indexed revision.

R10. Understand basic configuration semantics where high-confidence static conclusions are
possible: required vs optional, defaults, nullability, fallback chains, environment overrides,
truthy-but-empty defaults, and fail-open vs fail-closed behaviour.

R11. Record evidence provenance on every impact — USER_SUPPLIED, INDEPENDENTLY_DISCOVERED,
STRUCTURALLY_INFERRED, CONSTRAINT_DERIVED, RUNTIME_DERIVED, TRANSITIVE, WEAK_LEXICAL — so that a
component the specification named is represented as confirmation, not discovery.

R12. A match that merely echoes a filename or symbol supplied by the specification must contribute
very little to readiness or confidence; independent evidence must count much more strongly.

R13. Classify unmatched requirements as NEW_SURFACE, COVERAGE_GAP, INVALID_ASSUMPTION, AMBIGUOUS,
NO_EVIDENCE, or EXTERNAL_DEPENDENCY instead of reporting a generic "unmatched" result.

R14. Replace the single readiness number as the primary result with a decision-oriented plan
assessment carrying feasibility READY, READY_WITH_WARNINGS, NEEDS_CLARIFICATION,
INSUFFICIENT_COVERAGE or BLOCKED, finding counts, and an explicit decision statement.

R15. A hard repository invariant violation must be able to produce BLOCKED even when structural
coverage is excellent.

R16. Preflight analysis must run its architectural checks automatically as part of
submit_specification / analyze_impact — the user must not need to know which hidden graph question
to ask.

R17. Introduce query intent for component search — architecture, planning, implementation,
validation, tests, runtime, ownership — inferred when possible and explicit when necessary, and
rank results by intent so an implementation-intent query favours production source over tests.

R18. Post-implementation review must treat the approved preflight plan as a contract and compare
expected surfaces, constraints, runtime assumptions and relationships against the actual Git diff.

R19. Review must report implemented, missing and partially implemented requirements, expected
surfaces not changed, unexpected changed surfaces, unexpected new dependencies, forbidden
relationships, missing deployment changes, missing configuration propagation, architectural drift,
new surface absent from the plan, plan assumptions disproven by implementation, violated CI
invariants, guards not updated, and changes unrelated to the plan.

R20. Normal command output must be compact: summary counts, top findings and IDs, with large graph
or index payloads behind explicit opt-in or pagination.

R21. Preserve honest coverage reporting, staleness detection, refusal to fabricate confidence,
unmatched requirement detection, and existing compatible graph functionality.

R22. Every new persisted artifact and tool payload must be schema-versioned, Zod-validated at the
boundary, and backward compatible where reasonable.

R23. Add fixture-backed tests proving detection of: constraint violation, exemption without false
positive, runtime config gap, invalid enum member, new surface, coverage gap, spec echo marked
user-supplied, intent-aware ranking, and review drift from an unplanned dependency.

## Phase 2 requirements (built-in red-team analysis, ADR-0021)

R24. The analysis path must feed every analyzer end to end: configuration requirements and
declarations derived deterministically (never wired empty), concept extraction covering
SCREAMING_SNAKE, kebab-case and lowercase architectural noun phrases, and directory-segment
resolution for components that exist only as directories.

R25. Speculative (mined) concepts resolve silently or drop silently; only author-written identifier
shapes may produce an unresolved-concept warning.

R26. A frontend `*_SERVICE_URL` environment read must join the Terraform service-URL map that
assembles it when exactly one map names its stem; hops crossed on convention edges are inferred and
may warn, never block.

R27. The preflight outcome is persisted as a frozen artifact per analysis id, carrying the full
finding list, assessment, classifications, independence, constraint coverage and a plan-contract
slice (required config names, runtime process node ids, governing constraint ids).

R28. Post-implementation review merges the persisted plan contract into its checks; a
`list_preflight_findings` tool serves the full finding list with what-was-checked, as the explicit
red-team surface. There is no separate red-team analysis mode — analysis red-teams unconditionally.

R29. Accepted ADR-shaped documents are indexed as advisory `architecture-guidance` constraints
scoped to literally named paths; the domain rejects any stronger severity; analysis surfaces them
as informational pointers when the plan enters their scope.

R30. Engine-specific SQL in a specification is compared against the database engines the test
configuration declares; a mismatch warns with both files as evidence; an undeclared test
environment produces silence.

R31. Presentation separates the two jobs: the plan assessment is the headline, red-team findings
are their own section, the §11 readiness sentence defers to a stronger verdict, and a runtime path
yields one finding, not three. A spec-named component stays a confirmation even when a constraint
finding cites it.
