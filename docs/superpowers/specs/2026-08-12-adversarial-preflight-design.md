# Design — Adversarial Architectural Preflight

Date: 2026-08-12
Status: approved
Specification: `specs/adversarial-preflight.spec.md`
Decision record: ADR-0017 (graph vocabulary), ADR-0018 (constraint extraction trust model)

## 1. Problem

ImpactGraph answers "what code is related to this specification?". Evaluations show that answer has
low marginal value: when a specification names `send_service.py`, returning `send_service.py` as a
`required` impact is the specification echoed back, and an agent reading the repository finds the
same files unaided.

Meanwhile the failures that caused real rework were invisible to it:

1. A design introduced peer-service HTTP that `ci/scripts/check-service-peer-http.py` forbids.
   Discovered by CI, several commits after implementation.
2. A change set environment variables on a service, but admin traffic reached that service through
   an aggregator process that never received them. Live 503.
3. An implementation assumed `ItemType.ANGEBOT`, which does not exist.
4. A `SENDGRID_TEMPLATE_IDS_JSON = "{}"` default was truthy but semantically absent configuration.

The only genuinely valuable output was `unmatchedRequirements` — and only because "this requirement
creates new surface" is a different planning decision from "this requirement modifies existing
behaviour". That distinction is currently not made.

### 1.1 Dogfooding baseline (recorded 2026-08-12, before implementation)

This specification was submitted to ImpactGraph itself at snapshot `snap-f34ae6660cfc`
(5,532 nodes, 9,734 edges).

Preserved strengths:

- `workspaceCoverage.status = insufficient-coverage` and the readiness score **withheld** rather
  than fabricated.
- Staleness detected (`working-tree-modified`).
- 22 of 23 requirements reported unmatched, with statements.
- `unresolvedConcepts` correctly reported `analyze_impact` as matching no indexed artifact.
- `evidenceQuality: mixed`, noting 22 of 25 impacts were two or more hops out.

Failures, each mapping to a requirement of this design:

| Observed                                                                                                 | Requirement |
| -------------------------------------------------------------------------------------------------------- | ----------- |
| Unmatched requirements diagnosed as "index more repositories" when the truth was new surface             | R13         |
| The single match (R16 → `submitSpecification`) was a spec echo, tiered `required` at 0.9                 | R11, R12    |
| 8 of the next 11 impacts were `.test.ts` files reached via `CONTAINS → IMPORTS`                          | R17         |
| Zero constraints found, though the repo enforces boundaries, domain purity, and a LOC gate               | R1–R4       |
| `find_components` returned 11 of 12 hits as fields of one interface in one file                          | R17         |
| `index_workspace` returned 91 KB / 792 raw warning strings and exceeded the tool token limit             | R20         |
| `predictedArtifacts` cited test fixtures (`fixtures/ts-basic/prisma/migrations/…`) as production surface | R20         |

## 2. Product shift

Before implementation, the primary question becomes:

> What is wrong, incomplete, impossible, or dangerous about this plan?

After implementation:

> Did the implementation satisfy the approved plan, and did it introduce anything the plan did not
> account for?

Component discovery remains, demoted to supporting detail.

## 3. Core architectural insight

The current pipeline is `spec → concepts → node match → traverse → impacts → readiness:N`.

Nothing in it can produce a _negative_ finding. Impacts are the only output type, so the only
expressible failure is "no impact found", and the only expressible confidence is a number that rises
when matching succeeds — including when matching succeeds tautologically.

The change is to introduce a second, co-equal output type — **findings** — produced by small
analyzers that consume the plan and answer "what is wrong with it", and to make **plan assessment**
the primary result.

Three graph layers feed those analyzers: the existing code graph, a new **constraint graph**, and a
new **runtime/deployment graph**.

### 3.1 What is reused rather than rebuilt

- `ImpactAnalysis.proposedStructure` already models "relationships the design WOULD create",
  deliberately kept separate from the deterministic graph. It is the correct input to constraint
  checking. It is extended from option-derived to requirement-derived proposed edges.
- `application/evaluate-rules` already models `ArchitectureRule` and `RuleViolation` with evidence.
  The constraint model subsumes it as one constraint _source_; it is not replaced.
- `domain/impact/evidence-basis.ts` already implements a closed evidence vocabulary with per-basis
  tier ceilings. Evidence provenance is a second, orthogonal axis using the same mechanism.
- `domain/impact/workspace-coverage.ts` already computes insufficient-coverage. It becomes the input
  that distinguishes `COVERAGE_GAP` from `NEW_SURFACE`.
- Terraform language and framework adapters already emit resources, modules, references and variable
  values. The runtime graph is enrichment over them, not a new parser.

## 4. Domain model (`packages/domain`)

### 4.1 `src/constraint/`

`RepositoryConstraint`:

| Field                                               | Meaning                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`, `name`                                        | stable identity                                                             |
| `kind`                                              | see below                                                                   |
| `severity`                                          | `blocking` \| `warning` \| `advisory`                                       |
| `scope`                                             | path globs, roles, or contexts the constraint governs                       |
| `rule`                                              | typed predicate (forbidden pattern, required pairing, required config key…) |
| `exemptions`                                        | allowlist entries, each with its own source location                        |
| `source`                                            | file path + range of the guard that declares it                             |
| `extraction`                                        | `recognized` \| `declared` \| `ai-proposed` \| `opaque`                     |
| `provenance`, `evidenceIds`, `repositorySnapshotId` | knowledge-category discipline                                               |

Kinds: `forbidden-dependency`, `forbidden-runtime-call`, `required-accompanying-change`,
`required-config`, `required-runtime`, `boundary-restriction`, `must-pass-check`, `opaque-check`.

**Only `recognized` and `declared` constraints may produce a blocking finding.** `ai-proposed` and
`opaque` constraints may only warn. This is the enforcement point for "no fabricated blocking
findings" and is validated in the constructor, not left to producers.

### 4.2 `src/preflight/`

- `PreflightFinding` — `kind`, `severity`, `requirementIds`, subject references (node / proposed
  edge / constraint / runtime path), `evidenceIds`, `confidence`, `provenance`, producing analyzer.
  Kinds: `blocking-constraint-violation`, `constraint-warning`, `runtime-topology-gap`,
  `invalid-assumption`, `config-semantics-risk`, `new-surface`, `coverage-gap`,
  `unresolved-architectural-question`, `missing-consumer`, `guard-not-updated`.
- `PlanAssessment` — `feasibility`, per-kind counts, one decision sentence, and the retained numeric
  score as a secondary internal field.
- `UnmatchedRequirementClass` — `NEW_SURFACE`, `COVERAGE_GAP`, `INVALID_ASSUMPTION`, `AMBIGUOUS`,
  `NO_EVIDENCE`, `EXTERNAL_DEPENDENCY`, with a deterministic classifier.
- `EvidenceProvenance` — `USER_SUPPLIED`, `INDEPENDENTLY_DISCOVERED`, `STRUCTURALLY_INFERRED`,
  `CONSTRAINT_DERIVED`, `RUNTIME_DERIVED`, `TRANSITIVE`, `WEAK_LEXICAL`, with
  `independenceWeight()`.

### 4.3 Evidence provenance semantics (R11, R12)

`USER_SUPPLIED` carries independence weight ~0.1 and is **excluded from the independent-evidence
count** that feeds plan assessment. It is _not_ downgraded in tier: a file the specification named
genuinely is required, and hiding it would be dishonest. It is relabelled as **confirmation**, so
that feasibility and readiness can no longer rise because the engine echoed the specification.

### 4.4 Assessment precedence (R14, R15)

```
BLOCKED > INSUFFICIENT_COVERAGE > NEEDS_CLARIFICATION > READY_WITH_WARNINGS > READY
```

A blocking constraint violation therefore outranks excellent structural coverage, satisfying R15.

### 4.5 Graph vocabulary additions (persisted schema change — ADR-0017)

New node category `governance`: `repository-constraint`, `ci-check`, `constraint-exemption`.

New `infrastructure` types: `runtime-process`, `container`, `service-url`, `terraform-local`,
`terraform-output`, `terraform-variable`.

New symbol-member types: `enum-member`, `union-literal` (`application`), `config-key`,
`feature-flag` (`asset`).

New governance edges: `FORBIDS`, `ONLY_ALLOWED_FROM`, `ONLY_ALLOWED_TO`, `MUST_PASS`,
`RESTRICTS_DEPENDENCY`, `REQUIRES_CONFIG`, `REQUIRES_RUNTIME`, `EXEMPTS`, `GOVERNS`.
`REQUIRES` and `OWNS` already exist and are reused.

New runtime edges: `ROUTES_TO`, `RESOLVES_TO`, `RUNS_IN`, `RECEIVES_ENV`. New member edge:
`DECLARES_MEMBER`.

Constraint semantics are carried by these edge types, never flattened into `DEPENDS_ON` or `USES`.

`RequirementImpact` gains one optional additive field, `evidenceProvenance`. Absence is read as the
weakest interpretation, mirroring how `evidenceTypes` absence is already handled.

## 5. Application layer (`packages/application`)

### 5.1 `extract-constraints/`

Deterministic guard-shape recognizers, each a small pattern matcher over scanned files:

- forbidden-import (ESLint boundaries config, dependency-cruiser, custom scripts pairing a forbidden
  pattern with an allowlist)
- forbidden peer-HTTP (a script scanning service directories for cross-service HTTP plus allowlist)
- must-pass (a CI workflow step becomes `MUST_PASS` over the paths it guards)
- architecture-enforcing tests (tests asserting import or dependency rules rather than behaviour)
- `.impactgraph/constraints.yml` loader, producing `declared` (human-confirmed) constraints

Guards matching no recognizer are indexed as `opaque` `must-pass-check` with an explicit
"semantics not extracted" marker, so an unparsed guard is a visible limitation rather than silent
absence. No individual rule is hardcoded; adding a recognizer is adding one file.

### 5.2 `build-runtime-topology/`

Resolves Terraform locals, outputs and variables, container environment blocks and service-URL maps
into runtime hops, answering:

- what process actually receives traffic for this URL in production
- if this service requires `ENV_X`, which runtime processes on the request path need `ENV_X`

### 5.3 `preflight/`

Small composable analyzers over one shared `PreflightInput`, each returning findings:

`check-constraints`, `check-runtime`, `check-assumptions`, `check-config-semantics`,
`classify-requirements`, `assess-plan`.

They run automatically inside `analyze_impact` (R16). The user never has to know which hidden graph
question to ask.

### 5.4 `review-implementation/`

`compare-against-plan.ts` treats the approved assessment as a contract, plus post-implementation
constraint re-evaluation over the diff.

## 6. Adapters, contracts, ergonomics, search

- `language-adapters`: symbol-member extraction (TypeScript enums / unions / const objects, Python
  `Enum` and Pydantic models, Java enums) and config-key extraction.
- `framework-adapters`: Terraform runtime enrichment.
- `contracts`: new `constraint.v1`, `preflight-finding.v1`, `plan-assessment.v1`, `runtime-path.v1`;
  `analyze-output` and `implementation-review` bumped additively to v2; new MCP tools
  `list_constraints`, `explain_constraint`, `query_runtime_path`, `list_preflight_findings`.
- Ergonomics (R20): `index_workspace` and peers return compact grouped summaries; full detail is
  behind explicit opt-in or pagination.
- Search (R17): `QueryIntent` (inferred and explicit), per-intent weighting, and a per-file
  diversity cap that fixes the single-interface flood observed in the baseline.

## 7. Fixtures and tests

New fixture repository `packages/test-kit/fixtures/guarded-services/`, reproducing the four real
failures literally:

- `ci/scripts/check-service-peer-http.py` with an allowlist exempting the send job
- `newsletter-service`, `user-profile-service`, `admin` frontend, `aggregator`
- Terraform wiring `frontend_service_urls.newsletter → _agg.newsletter`, with the required
  environment variables present on the nominal service and absent on the aggregator container
- an `ItemType` enum without `ANGEBOT`
- `SENDGRID_TEMPLATE_IDS_JSON = "{}"`

The ImpactGraph repository is never the primary analyzer fixture.

Required scenario tests: constraint violation → `BLOCKED`; exemption → no false positive; runtime
config gap; invalid enum member; new surface vs coverage gap; spec echo marked `USER_SUPPLIED`
without inflating independent evidence; intent-aware ranking; review drift from an unplanned
dependency.

## 8. Deliberate limitations

- **Configuration semantics (R10) is the weakest layer.** Truthy-but-empty defaults and fail-open
  behaviour are reliably decidable only for literal defaults in a small set of shapes. Those ship;
  everything else is reported `not-extracted` rather than guessed.
- **No general symbolic execution.** Symbol-member validation is declaration lookup, not evaluation.
- **No universal deployment language.** Runtime modelling targets the Terraform/Cloud Run patterns
  present in the repositories at hand.
- **Search is not reworked.** Intent, diversity and output size are addressed; deeper relevance
  modelling is out of scope because grep, LSPs and code-exploration agents already cover discovery.

## 9. Compatibility

All domain field additions are optional and read conservatively when absent. Contract versions are
bumped additively; v1 consumers keep working. The index is a disposable cache, so new node and edge
types require a re-index, not a data migration.
