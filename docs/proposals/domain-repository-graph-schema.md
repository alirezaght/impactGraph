# Domain Model Proposal: Repository Knowledge Graph Schema (GraphNode, GraphEdge, EvidenceRecord, KnowledgeEnvelope)

_For any new or reshaped concept in packages/domain. Reviewed by the domain-provenance agent with
the domain-provenance-development skill. Domain code is pure: no I/O, no Date.now(), clock and
identifier ports only._

- **PRD grounding:** §12 "Architecture Graph Model" (node categories 12.1, edge types 12.2,
  "Every node and edge must have a provenance type" 12.3); §3 "the three categories are never
  mixed"; §14 "The confidence score must not be generated only by asking an LLM for a number."
- **Epic:** backlog/epic-01-graph-core.md (Story 1.1)
- **Author / date:** Claude (domain-provenance context) / 2026-07-31

## Concept definition

The typed vocabulary every ImpactGraph engine reasons over: **GraphNode** (a component of the
analyzed system — intent, domain, application, data, integration, infrastructure, or repository
node), **GraphEdge** (one of the PRD §12.2 relationship types between two nodes),
**EvidenceRecord** (an immutable, individually addressable proof unit binding a claim to a file
range, symbol, config key, or git commit within one repository snapshot), and the
**KnowledgeEnvelope** they all carry (provenance, evidence IDs, confidence with contributing
signals, clock-port timestamp, snapshot/spec/run IDs). **ConfidenceScore** is a value object that
cannot exist without at least one contributing signal.

## Invariants

1. A node or edge cannot be constructed without a valid `Provenance` value (§12.3); unknown
   values are rejected with a typed error.
2. `runtime-observation` exists in the `Provenance` type but no factory accepts it in V1
   (reserved — provenance-model.md).
3. A record whose provenance is not `human-confirmed` must cite ≥ 1 evidence ID; an
   `llm-inferred` record with empty evidence is invalid by construction.
4. Confidence is always 0..1 and always accompanied by ≥ 1 contributing signal (§14); penalty
   signals (graph distance, ambiguity, conflicting evidence, unsupported inference) contribute
   ≤ 0, all others ≥ 0.
5. A node's `type` must belong to its `category` per the §12.1 roster (e.g. `package` is legal
   in both `application` and `repository`, `table` only in `data`); unknown types are rejected.
6. Edge `type` must be one of the §12.2 edge types; source and target IDs must be non-blank.
7. All constructed objects are deeply frozen — no mutation path exists.
8. Serialization round-trips: `parse(serialize(x))` reproduces `x` exactly, and `parse` applies
   the same construction-time validation (single validation path).
9. Serialized forms carry an explicit `schemaVersion` (main skill §5).

## Provenance fields carried (PRD §12.3)

- provenance: all of `static-analysis | configuration | git-history | framework-convention |
llm-inferred | human-confirmed` are legal for nodes and edges; `runtime-observation` is
  type-only (reserved).
- evidenceIds: ≥ 1 required unless `human-confirmed` (human statements may stand alone;
  provenance-model.md).
- confidence: computed from PRD §14 weighted signals — never model-authored. The domain type
  only enforces shape (range + signals present + penalty sign); the weighting engine itself is
  Epic 06 (`application/build-impact-model`).
- repositorySnapshotId / analysisRunId: mandatory on every node, edge, and evidence record.
  specificationId + specificationVersion: optional on the envelope — a `static-analysis` IMPORTS
  edge produced by indexing exists before any specification does; intent nodes and impact records
  (Epic 06) will require it.
- createdAt: ISO-8601 string supplied by the caller from the clock port; the domain never reads
  time.

## Evidence and confidence handling

Evidence attaches by ID (`evidenceIds` on the envelope); the `EvidenceRecord` itself binds
kind (import-statement, call-site, decorator, terraform-resource, co-change-history,
config-entry, human-statement, model-output-reference) to a source binding union — `file`
(path + optional range + optional symbol), `config` (path + key), or `git-commit` (sha) — and to
the `repositorySnapshotId` it was read from. Zero evidence on a non-human record is a
construction error, not a downgrade — downgrade semantics (PRD §34) apply to AI claims at the
application layer, which will mark records unsupported rather than delete them.

## Supersession and contradiction behavior (PRD §3, §16)

- Supersession/decision records are **not** part of this proposal — they arrive with the human
  correction model (Epic 08) and impact approval (Epic 06). Nothing here mutates: all types are
  frozen and there is no update API, so the append-only invariant cannot be violated by this
  slice.
- Contradiction is representable from day one: `CONTRADICTS` is one of the §12.2 edge types.

## Staleness rules

Staleness is a read-time comparison of `repositorySnapshotId` (and later spec version) against
current state — a query/application concern (Story 1.4+). This slice guarantees the IDs needed
for that comparison are mandatory and immutable on every record.

## Relationships to existing domain types

| Related type             | Relationship                                     | Edge type (if graph-visible) |
| ------------------------ | ------------------------------------------------ | ---------------------------- |
| RepositorySnapshot (1.3) | referenced by ID from every envelope/evidence    | n/a                          |
| EvidenceRecord           | referenced by ID from KnowledgeEnvelope          | n/a                          |
| GraphNode ↔ GraphNode    | connected by GraphEdge                           | all §12.2 types              |
| ImpactAnalysis (Epic 06) | will reference NodeIds + carry the same envelope | AFFECTS / MAY_AFFECT         |

## Rejected alternatives

- **Namespaced node-type strings** (`application:package` vs `repository:package`): rejected —
  loses the PRD's own vocabulary; carrying `category` + `type` and validating the pair keeps
  §12.1 verbatim and lets queries filter by category cheaply.
- **Zod schemas in domain** for JSON validation: rejected — domain imports nothing
  (dependency-rules.md). Pure hand-rolled parsing with a shared field-reader keeps the package
  dependency-free; Zod DTOs live in `packages/contracts` when persistence arrives (ADR-0006/0009).
- **Deriving category from type** (drop the category field): rejected — `package` is
  legitimately in two categories, so type alone is ambiguous.
- **Storing knowledge category on records**: rejected — category is derived from provenance via
  `knowledgeCategoryOf` (one source of truth, no drift; provenance-model.md).

## Addendum (Stories 1.3 + 1.4, same PR series): RepositorySnapshot and KnowledgeGraph

- **RepositorySnapshot** (PRD §23.1): id, repository identity, head (`branch` | `detached`, commit
  SHA validated as 4–40 hex), dirty-working-tree flag, positive-integer index version, clock-port
  timestamp. Frozen; serialized with `schemaVersion: 1`. The git metadata _reader_ is
  `packages/git` (ADR-0007); persistence linkage is Story 1.2.
- **KnowledgeGraph** (Story 1.4): validated aggregate of nodes + edges. Construction rejects
  duplicate IDs and edges referencing nonexistent nodes (`unknown-node-reference` — the
  type-level half of "AI output may only reference nodes that exist", CLAUDE.md rule 4). Sorted
  adjacency indexes give deterministic traversal (PRD §34).
- **Query semantics**: `findNodes` (category/type/name/path), `neighbors`
  (direction + edge types), `findShortestPath` (BFS), `extractSubgraph` (induced, depth-limited).
  The `knowledgeCategories` filter is **record-wide**: a facts-only query never returns _or
  traverses_ an `llm-inferred` node or edge — categories are never mixed inside one filtered
  result (§3, §47.10). All results are in stable id order.
- Verified at 5,000 nodes (chain construction + full-length path + full scan) as a scale sanity
  check; the measured §33 benchmark on a synthetic 5,000-file fixture remains open
  (performance-scalability).

## Pure-domain test list (vitest `unit` project)

- [x] every §12.1 category/type pair constructs; type-in-wrong-category rejected with typed error
- [x] all §12.2 edge types construct; unknown edge type rejected
- [x] construction without provenance / with unknown provenance fails validation
- [x] `runtime-observation` rejected by every factory (reserved in V1)
- [x] `llm-inferred` (and every non-human provenance) with empty evidenceIds rejected;
      `human-confirmed` without evidence allowed
- [x] `knowledgeCategoryOf` maps the seven values onto the three categories + reserved
- [x] confidence out of range, empty signals, unknown signal type, wrong-sign penalty → rejected
- [x] node/edge/evidence JSON serialization round-trips exactly; corrupt/missing fields and wrong
      `schemaVersion` rejected on parse
- [x] constructed objects are frozen (mutation throws in strict mode)
