# ADR-0017 — Constraint and runtime graph layers, and findings as a first-class output

Date: 2026-08-12
Status: Accepted
Supersedes: nothing. Extends ADR-0002 (knowledge categories), ADR-0015 (evidence basis and bounded
output), ADR-0016 (architecture-aware concept matching).

## Context

Repeated evaluations showed the same pattern. ImpactGraph reliably found structurally related
files, and those results had low marginal value because an agent reading the repository finds the
same files unaided — most sharply when the specification itself named them, and the engine returned
them at `required` tier.

Meanwhile four classes of expensive failure went undetected, each discoverable from the repository
at the time the plan was written:

1. A design introduced peer-service HTTP that `ci/scripts/check-service-peer-http.py` forbids,
   discovered by CI several commits after implementation.
2. A change configured a service, while admin traffic reached it through an aggregator process
   that never received the configuration. Live 503.
3. An implementation assumed `ItemType.ANGEBOT`, which did not exist.
4. A `"{}"` default was truthy and semantically meant "not configured".

The common shape: the facts were all present, and nothing in the model could put two of them side
by side. The graph held code relationships and nothing else — no repository rules, no deployment
topology, no symbol members — and the analysis produced only one output type, impacts, so the only
expressible failure was "nothing found".

## Decision

**1. Findings become a second, co-equal output type.** `PreflightFinding` states something wrong,
incomplete, impossible or dangerous, with evidence, confidence and the producing analyzer.
`PlanAssessment` becomes the primary result; the readiness score is retained as a secondary field.

**2. Repository rules are indexed as entities.** A new `governance` node category
(`repository-constraint`, `ci-check`, `constraint-exemption`) and a closed set of governance edge
types (`FORBIDS`, `ONLY_ALLOWED_FROM`, `ONLY_ALLOWED_TO`, `MUST_PASS`, `RESTRICTS_DEPENDENCY`,
`REQUIRES_CONFIG`, `REQUIRES_RUNTIME`, `EXEMPTS`, `GOVERNS`) carry the semantics. They are not
flattened into `DEPENDS_ON` or `USES`: direction of prohibition and applicability of exemption are
exactly the information a planner needs, and a generic edge destroys both.

**3. Runtime topology is modelled separately from source dependencies.** New infrastructure node
types (`runtime-process`, `container`, `service-url`, `terraform-local`, `terraform-output`,
`terraform-variable`) and edges (`ROUTES_TO`, `RESOLVES_TO`, `RUNS_IN`, `RECEIVES_ENV`). A `locals`
entry becomes a node — previously `locals` was skipped as a "configuration setting", which was
self-consistent and was also the exact hop where a nominal service name became an aggregator.

**4. Symbol members are indexed.** `enum`, `enum-member`, `union-literal`, `config-key`,
`feature-flag` node types with `DECLARES_MEMBER` edges, so `ItemType.ANGEBOT` can be contradicted.

**5. Evidence gains a provenance axis.** `EvidenceProvenance` answers "did we find this, or did the
specification hand it to us", orthogonal to the existing evidence-basis axis which answers "what
sort of proof is this". A spec-named component keeps its tier and is labelled confirmation.

## Alternatives considered

**Keep constraints as configuration only (`.impactgraph/rules.yml`).** Rejected: it requires every
team to restate rules they have already written and CI already enforces, and a restated rule drifts
from the guard it mirrors. The manifest is kept as an escape hatch, not the primary source.

**Model constraints as ordinary nodes with `DEPENDS_ON` edges.** Rejected: a constraint does not
depend on what it governs, and collapsing the relation loses direction and exemptions.

**Retype `locals` blocks instead of adding node types.** Rejected: a Terraform local and the URL a
caller is configured with are different things, and conflating them makes "what does the frontend
call" and "what does this local contain" the same question.

**Let AI read guard scripts as the primary extractor.** Rejected under ADR-0018.

## Consequences

- The index is a disposable cache, so new node and edge types require a re-index, not a migration.
- Graph goldens gained containers, `RECEIVES_ENV`, `RESOLVES_TO`/`ROUTES_TO` and `locals` entries;
  every added line is additive and named in the movement baselines.
- `analyze-output` and `implementation-review` gained additive optional blocks. v1 consumers are
  unaffected; absence of the blocks means the pass did not run, never that it ran and found nothing.
- `RequirementImpact.evidenceProvenance` is optional and read as `WEAK_LEXICAL` when absent, so
  analyses stored before the axis existed are never treated as independently evidenced.

## Revisit triggers

- If runtime modelling is asked to cover a platform beyond Terraform/Cloud Run, revisit before
  generalising — the current shape is deliberately fitted to what the repositories at hand contain.
- If the governance edge roster grows past roughly a dozen types, the vocabulary is probably
  encoding policy detail that belongs in the constraint's typed `rule` instead.
