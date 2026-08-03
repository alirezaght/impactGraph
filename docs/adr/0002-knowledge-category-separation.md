# ADR-0002: Knowledge-Category Separation as Engineering Law

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

PRD §3 is the core product principle: ImpactGraph must distinguish (1) deterministically discovered
facts, (2) AI-inferred architectural interpretations, and (3) human-confirmed architectural
knowledge, and "these categories must never be visually or semantically mixed". PRD §12.3 encodes
this as the `Provenance` type (`static-analysis`, `configuration`, `git-history`,
`framework-convention` for facts; `llm-inferred`; `human-confirmed`; `runtime-observation` reserved
for the future). PRD §34 requires rejecting AI references to nonexistent nodes and downgrading
unsupported claims; PRD §47.9–10 forbid AI-generated graph nodes that do not exist in the repository
graph and require persisting facts separately from inferences. PRD §16 requires that user
corrections never be silently overwritten.

This ADR elevates the product principle into an engineering rule that binds every package, schema,
and UI component we write — because a principle enforced only in one engine will erode at every
boundary it crosses.

## Options Considered

### Option A — One blended knowledge store, confidence score as the only discriminator

Store all nodes/edges in one pool; a float confidence expresses how trustworthy each item is.

- Pros: simplest schema; queries need no category joins; confidence already exists (PRD §14).
- Cons: violates PRD §3 outright — a 0.95-confidence inference and a deterministic fact become
  indistinguishable after one aggregation step; UI cannot honestly render the FACT / INFERENCE /
  CONFIRMED distinction of PRD §3; the "false authority" risk (PRD §43.6) is realized by design.

### Option B — Categories separated, corrections applied by mutation

Provenance is first-class, but a human correction rewrites the corrected record in place.

- Pros: honest display; storage stays compact; no supersession chains to traverse.
- Cons: destroys audit history — PRD §16 and §34 ("avoid overwriting user-confirmed architecture
  silently") demand traceability in both directions; a re-index that regenerates the deterministic
  fact would silently resurrect what the human overrode; review reports (PRD §38.2) can no longer
  explain _why_ the model disagreed with the code at approval time.

### Option C — Provenance-typed records with append-only supersession (chosen)

Every node, edge, impact, requirement mapping, discrepancy, and configuration value carries
provenance, evidence IDs, confidence, timestamps, repository-snapshot ID, specification version,
and analysis-run ID. Human confirmation _supersedes_ prior deterministic or AI evidence via a new
record pointing at what it supersedes — nothing is rewritten or deleted. AI output is validated
against the deterministic graph: it may only reference existing nodes; unsupported claims are
downgraded, never deleted and never promoted.

- Pros: PRD §3/§12.3/§16/§34/§47 satisfied structurally; every disagreement between human, AI, and
  code is reconstructible; re-indexing cannot clobber human knowledge; the three categories can be
  enforced by schema (Zod, ADR-0009) rather than by reviewer vigilance.
- Cons: more storage and more complex read paths (queries must resolve supersession chains); every
  feature pays a provenance tax — there is no "quick" node type; contributors must learn the model
  before writing any graph code.

## Decision

Option C. Concretely, as engineering law:

1. No type in `packages/domain` represents graph knowledge without provenance, evidence, confidence,
   and snapshot/run identity.
2. Persistence (ADR-0006), contracts (ADR-0009), and the webview never merge categories into a
   single undifferentiated collection; filtering by category is always possible.
3. Supersession is append-only. Deleting or rewriting historical analysis data requires explicit
   human approval (see `.claude/CLAUDE.md`, "When human approval is mandatory").
4. `packages/ai-inference` output passes a validation gate against the deterministic graph before
   anything is persisted; violations are downgraded with a recorded reason.

## Consequences

- Positive: the product's trust story ("never present unsupported AI reasoning as a repository
  fact", PRD §3) is enforced by types and gates, not convention; drift and review features get audit
  trails for free; hallucinated-impact risk (PRD §43.2) has a structural mitigation.
- Negative: schema and query complexity everywhere; artifact stores grow monotonically (see the
  migration threshold in ADR-0006); some UX flows feel indirect because "just edit the node" is
  forbidden.

## Revisit Trigger

Only if the PRD's core principle itself changes, or if `runtime-observation` provenance (PRD §12.3)
is activated and does not fit the supersession model. Storage-growth pressure alone routes to
ADR-0006, not here.

## Links

- PRD §3, §12.3, §14, §16, §34, §38.2, §43.2, §43.6, §47.9–10
- Related: ADR-0006 (where each category is persisted), ADR-0009 (schemas that enforce it),
  ADR-0010 (the AI boundary being validated)
- docs/engineering/provenance-model.md, docs/engineering/artifact-versioning.md
