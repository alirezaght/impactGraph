# Data Contracts

The engineering rules for every typed boundary in ImpactGraph. All contracts live in
`packages/contracts` (Zod schemas + generated JSON Schema in `packages/contracts/schemas/`,
committed) and are validated **at both ends** of every boundary: the producer validates before
sending/writing, the consumer validates before trusting. Decided in ADR-0009; storage specifics in
`artifact-versioning.md`; the boundary map in `architecture.md`. Contract changes go through
`/review-contracts` and the mandatory-approval list in CLAUDE.md.

## Non-negotiable contract rules

1. **Stable identifiers.** Every record has an ID that survives edits, migrations, and
   export/import. Deterministic (content-derived) IDs where reproducibility helps — evidence,
   graph nodes, snapshots; event-identity IDs (via the identifier port) elsewhere. See the ID
   scheme in `artifact-versioning.md`.
2. **Explicit `schemaVersion` on everything persisted or transmitted.** No unversioned persisted
   record, webview message, MCP payload, or CLI JSON document — ever.
3. **Runtime validation with Zod on both ends.** TypeScript types are compile-time comfort;
   the Zod parse is the contract. Types are inferred from schemas (`z.infer`), never hand-written
   in parallel.
4. **No implicit enum expansion.** Adding a value to a persisted/transmitted enum (Provenance,
   likelihood, impactType, review category, node/edge types from PRD §12) is a schema change:
   version bump, migration note, and explicit handling in every consumer. Readers treat unknown
   enum values as typed errors, not as pass-through strings.
5. **Backward-compatible readers.** Readers accept all historical schema versions and upgrade on
   read; writers write only the current version. Readers refuse _future_ versions explicitly.
6. **Migration tests are part of the change.** A schema bump without fixture-based migration tests
   (vitest `contract` project) does not merge. Template:
   `.claude/templates/persistence-schema-change.md`.
7. **Source-location preservation.** Any claim grounded in source carries file path + range
   (start/end line, column) end-to-end — domain → artifact → webview/report — so PRD §18.5
   ("open source file from node", "relevant source ranges") never degrades to "somewhere in this
   file".
8. **Full identifier set on knowledge records.** Evidence IDs, `repositorySnapshotId`,
   `specificationId` + `specificationVersion`, `analysisRunId`, approval ID where applicable, and
   human-decision IDs — the seven provenance questions (`provenance-model.md`) must be answerable
   from the record alone.
9. **Provider + model metadata on AI records.** Every `llm-inferred` record stores provider ID,
   model ID, and (where available) request parameters — required for audit (PRD §Z12) and for
   debugging provider inconsistency (§43.5).
10. **Clock port for timestamps.** All `createdAt`/`updatedAt` values flow from the application
    clock port; no `Date.now()` in domain or contract-producing code. Timestamps are ISO-8601 UTC
    strings in DTOs.

## The five DTO families

One domain model, five representations. Never let one family's shape leak into another's role.

| Family               | Location                                                | Consumed by                   | Notes                                                                                                                                                           |
| -------------------- | ------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Domain models**    | `packages/domain`                                       | application, adapters         | Rich invariant-holding types. NOT serialized directly — no domain type is ever written to disk or a wire                                                        |
| **Persistence DTOs** | `contracts/artifacts`, `contracts/config`               | `packages/persistence`        | Flat, versioned, migration-friendly. Optimized for durability, not ergonomics                                                                                   |
| **Webview DTOs**     | `contracts/webview`                                     | extension shell ↔ webview     | View-shaped (display labels, pre-grouped nodes, filter states). The webview imports contracts ONLY — never domain                                               |
| **AI response DTOs** | `contracts/ai`                                          | `packages/ai-inference`       | The schemas passed to `generateStructuredOutput<T>` (PRD §8) and enforced on receipt; model output failing the parse is a provider failure, not a lenient parse |
| **Command DTOs**     | `contracts/tools` (MCP §21, §Z7), `contracts/cli` (§20) | `apps/mcp-server`, `apps/cli` | Agent-readable request/response shapes; stable command contracts (PRD §29.4)                                                                                    |

## Mapping rules between families

- Mapping code lives in **application and adapters**, never in `packages/contracts` (contracts
  depend on zod only, `dependency-rules.md`) and never in `packages/domain`.
- Each mapping is a pure, total, tested function pair (`toDto` / `fromDto` where round-trips
  exist). Persistence mappers live in `packages/persistence`; webview mappers in the extension
  shell; AI mappers in `packages/ai-inference`; command mappers in the respective app or in
  `application` use cases.
- Mappers may **narrow** (webview DTOs omit internals) but never **invent**: any field a DTO
  carries must be derivable from the domain model plus explicitly passed context.
- AI response DTOs are mapped into domain records only after validation: node references checked
  against the deterministic graph (nonexistent → rejected), unsupported claims downgraded
  (PRD §34), provenance forced to `llm-inferred` — a model can never mint any other provenance
  value, structurally.
- Domain models never implement serialization interfaces; if you need `toJSON`, you wanted a DTO.

## Representing contradictions and supersession without deleting history

- **Supersession**: the persistence DTO for any knowledge record has optional `supersedes`
  (ID it replaces) and `status` (`active | superseded | stale`). Superseding = append new record +
  flip old record's `status`. No other field of an existing record is ever rewritten; there is no
  delete operation in the artifact store's public API.
- **Contradiction**: a `CONTRADICTS` edge DTO linking two record IDs, itself carrying provenance
  and evidence. Both claims stay `active` until a `human-confirmed` record supersedes one side.
  Exports and webview DTOs carry contradictions explicitly so the UI can show the conflict rather
  than silently picking a winner.
- Readers must therefore always filter by `status` intentionally: "active view" for
  decision-making, full chain for audit. Contract helpers in `packages/contracts` provide both
  selectors so consumers don't hand-roll (and get wrong) the filtering.

## Implemented schemas

| Schema (Zod source, `packages/contracts/src`)                | Version | JSON Schema (committed)                                  |
| ------------------------------------------------------------ | ------- | -------------------------------------------------------- |
| `artifacts/graph.ts` — `graphNodeArtifactSchema`             | 1       | `schemas/artifacts/graph-node.v1.schema.json`            |
| `artifacts/graph.ts` — `graphEdgeArtifactSchema`             | 1       | `schemas/artifacts/graph-edge.v1.schema.json`            |
| `artifacts/evidence.ts` — `evidenceRecordArtifactSchema`     | 1       | `schemas/artifacts/evidence-record.v1.schema.json`       |
| `artifacts/snapshot.ts` — `repositorySnapshotArtifactSchema` | 1       | `schemas/artifacts/repository-snapshot.v1.schema.json`   |
| `artifacts/review-artifact.ts` — `reviewArtifactSchema`      | 1       | `schemas/artifacts/implementation-review.v1.schema.json` |

The review artifact (PRD §24.1, §28) stores a completed review under
`.impactgraph/artifacts/reviews/`: the frozen §38.2 document plus an append-only
`acceptedDeviations` list. The document is immutable once written — accepting a deviation
appends a decision and never rewrites or recategorizes a finding, and a re-run review is a new
artifact that does not inherit prior acceptance.

CLI output documents (`cli/outputs.ts` + `cli/decision-outputs.ts`, PRD §20) are all version 1
and committed under `schemas/cli/`: `init`, `index`, `status`, `architecture`, `config`,
`analyze` (each impact carries an optional `context` — the effective bounded context from the §Z5 overlay, absent when none is assigned so consumers render unknown rather than inferring from paths), `approve`, `review` (§38.2 report as JSON — findings use the closed §24.1 category
enum, coverage the §25 status/marker enums; the additive `reviewId` and per-finding
`acceptedDeviation` fields carry the §24.1 acceptance mark), `select-option` (§26/§C8 option
selection, with the optional `answeredQuestionId` naming the question the selection resolved),
`review-accept` (§24.1 accepted deviation), and `error`. The `analyze` document's optional
`architecturalOptions` entries carry an optional `linkedQuestionId` — the §C8 link that lets a
selection resolve its question instead of only recording a decision.

### Proposed structure on the analyze document (§18.4)

`analyze` carries an **additive, optional** v1 field `proposedStructure`
(`{ nodes[], relationships[] }`) — the relationships (and, in principle, the components) an
architectural option would **create**. It is a separate channel from everything else in the
document on purpose: `requirements[].impacts` and their `dependencyPath`s describe structure that
exists **now**, so current and proposed can be **diffed rather than merged** (§3). Absence means
"the engine asserted no proposed structure", never "unknown", which is what keeps the field
additive — a reader of the prior shape loses nothing.

Each record carries the same envelope as any other knowledge record: `originOptionId` (the option
that implies it), `rationale`, `provenance`, `evidenceIds`, `confidence`, and the
`confidenceSignals` the score was computed from (§14). Relationships additionally carry
`status: 'proposed'` (a literal — the field cannot describe current structure) and
`sourceKind`/`targetKind` (`existing | proposed`): an `existing` endpoint must be a node in the
deterministic graph at the bound snapshot, a `proposed` endpoint must be one of the
`nodes[]` declared in the same structure. `packages/domain`'s `collectProposedStructureIssues`
enforces both, plus the rule that a proposed node may **never** reuse a real graph node id, and
`buildImpactModel` drops any record that fails and records an `invalid-reference` warning (§34).
The same document is the `analyze_impact` MCP tool's output; `get_impact_analysis` returns the
serialized artifact, whose `proposedStructure` is likewise an additive v1 field.

**What the engine derives today (v1) and what it deliberately does not.** Proposals come only
from an option's graph footprint plus the §12 vocabulary — never from free-form model output.
Two rules fire, both event-boundary: an application-category node paired with a
`topic`/`queue`/`pubsub-topic` the graph does not relate implies `PUBLISHES`; the same node paired
with a `subscription`/`pubsub-subscription` implies `SUBSCRIBES_TO`. The node types themselves fix
the direction, and the pair must have **no path of length ≤ 2** between them at the snapshot.
Provenance is `llm-inferred` because the interpretation that pairs the two components is
model-authored, even though the derivation step is deterministic; the score is computed from
`PROPOSED_RELATIONSHIP_SIGNAL_WEIGHTS` (a second table over the _same_ signal vocabulary — signal
meanings are unchanged). Deliberately **not** derived: data relationships (`READS_FROM` vs
`WRITES_TO` — the types do not fix the direction), `DEPLOYED_AS`/`MIGRATES` (an unlinked pair is
far more likely an indexing gap than a proposal), removed dependencies, and **proposed nodes** —
a component that does not exist has no evidence record to cite, and the only available signal, an
unmatched concept string, is indistinguishable from an alias gap (§17), so those stay
`unknown-concept` warnings. The schema carries proposed nodes so a future human-confirmed
addition has somewhere honest to live.

### Proposed structure on the impact-graph webview DTO (§18.4)

`contracts/webview`'s `impactGraphSchema` mirrors the same field as an **additive, optional**
`proposedStructure` (`{ nodes[], relationships[] }`), with the same envelope plus two
display-only additions the host resolves: `knowledgeCategory` (derived from `provenance`, exactly
as for current nodes) and `originOptionTitle` (from the analysis's `architecturalOptions`, absent
when the option is not in the document — never invented). It rides inside the existing
`host/graph` message, so it is Zod-validated on the host before `post` and in the webview before
render, like every other payload; no protocol-version bump is owed, because absence keeps a prior
reader's exact meaning (ADR-0009).

It is a **separate field, never merged into `nodes`/`edges`** — that separation is the feature.
The host mapper (`apps/vscode-extension/src/webview/proposed-model.ts`) enforces two rules and
warns visibly for each drop: a proposed node that reuses a real graph node id is dropped (it would
shadow a real component), and a relationship whose endpoint resolves to neither an existing graph
node nor a surviving proposed node is dropped rather than rendered dangling. `totalNodeCount`
counts current **and** proposed components, so the webview's "showing N of M" cannot understate the
graph, and proposed elements count against the §33 200-node budget like any other element.

AI response DTOs (`ai/extraction.ts`, `ai/classification.ts`)
are under `schemas/ai/`. Clarification ADRs (`clarification.v1`, PRD §C9) are domain-serialized
artifacts under `.impactgraph/artifacts/clarifications/`; the MCP tool roster is 30 tools
(§21's initial 18, the §Z7 configuration tools, `answer_open_question`, and the two
human-decision tools `select_architectural_option` / `accept_review_deviation`, both of which
require `confirmedByUser: true` in the contract itself, §35). The `.impactgraph/` YAML documents (`config/`, PRD §16–17, §27) are
`workspace-config`, `architecture-config`, `aliases-config`, and `rules-config`, all v1 —
these back editor validation (§17) and the persistence read/write gates (§Z13).

The §16 human corrections are part of the same `config/operation.v1` vocabulary
(`config/component-correction.v1` is the correction-only subset, used by the
`apply_component_correction` tool): `rename-component`, `assign-context`, `set-component-role`,
`mark-component` (closed marker enum `generated | ignored | infrastructure | shared`),
`set-component-owner`, and
`set-relationship-confirmation` (one operation carrying an explicit `confirmed` boolean rather
than two mirrored ops). They persist to `architecture-config.v1` through **additive, optional**
v1 fields: `renames[]`, `relationships[]`, `components[].markers`, `components[].owner`, and a `source`
(`human-confirmed | agent-approved`) on `contexts[]`/`components[]`/`renames[]`/`relationships[]`
recording which §Z5 level wrote the record — absent means human-confirmed, since hand-written
YAML is human knowledge. **Splitting a component is deliberately not expressible**: it would
require inventing graph nodes no evidence produced. Merging is expressed as renaming several
names onto one canonical name.

`components[].owner` is free-form (a team name, a GitHub handle, a distribution list) — not an
enum and not email-validated, because ownership vocabularies differ per organization. It is
**descriptive metadata only**: nothing in the system permits or denies an operation based on it.
It is also **never inferred** — no detection, manifest, or git-history path writes it, so the
overlay resolves an owner at §Z5 level 1/2 (committed configuration) or 6 (defaults) and never in
between. `set-component-owner` rejects a glob matching no file rather than persisting a no-op.

`config/overlay.ts` carries the §Z5 read-side vocabulary — the six precedence levels
(`human-confirmed > agent-approved > repo-metadata > deterministic-detection > ai-inferred >
defaults`) plus `effectiveComponentSchema` / `effectiveRelationshipSchema` /
`correctionSummarySchema`. These appear as additive optional `effective` blocks on
`explain_node` / `explain_edge`, as additive `corrections` / `effectiveTotalEdges` /
`rejectedEdges` on `cli/architecture-output.v1`, and as additive per-package correction fields on
`detect_repository_structure`. `totalEdges` keeps its meaning (edges in the deterministic graph):
rejected relationships are listed explicitly and counted apart, never silently subtracted. The agent
export (`export/implementation-context.v1`, PRD §22) embeds the domain-serialized specification
and analysis documents and is wrapped for the CLI as `cli/export-output.v1`.

Regenerate with `pnpm --filter @impactgraph/contracts generate:schemas`; the
`json-schema-sync` contract test fails when the committed files drift from the Zod source.
Node category/type and edge type are open strings at this boundary (the exact PRD §12 vocabulary
is enforced by `packages/domain` at the adapter) so vocabulary growth is not a breaking schema
change; `provenance` is a closed enum. `supersedes`/`status` fields arrive with the first
supersession-bearing artifact (Epic 06/08).

## Enforcement

- `pnpm test:contract` — schema validation, migration chains, round-trips, refuse-future-version.
- `schema-compat` CI job — diffs committed `packages/contracts/schemas/`.
- `pnpm lint` — boundary rules keep contracts standalone and the webview contracts-only.
- `/review-contracts` before human review whenever any boundary schema changed.
