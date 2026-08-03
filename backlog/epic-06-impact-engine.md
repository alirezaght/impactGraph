# Epic 06 — Impact Engine

**Goal:** Map requirements to repository nodes and produce evidence-backed, confidence-scored candidate impacts. Deterministic candidate generation; the LLM only classifies bounded candidate sets (§43.5). No hallucinated nodes, ever.
**Spec:** §13, §14, §26, §40.3, Epic F (§45), §44 Phase 4
**Phase:** 4 · **Depends on:** Epics 02, 05

---

## Story 6.1 — Concept extraction & concept-to-node matching

**Acceptance criteria**

- [x] Concepts from requirements match repository symbols via exact, alias (config `aliases`), and semantic matching — each match records which mechanism produced it. _(semantic = normalized name-similarity; embedding matching arrives with a provider + privacy modes)_
- [x] Matches carry evidence (symbol, file, range) and a match-strength signal for the confidence engine.
- [x] Unknown concepts produce warnings, not invented nodes.

**Tasks**

- [x] Implement exact + alias matcher over the graph symbol index.
- [x] Implement semantic matching (embeddings optional per privacy mode; name-similarity fallback). _(name-similarity fallback; embeddings later)_
- [x] Emit match evidence records. _(matches reference the node's declaration evidence)_
- [x] Unit tests incl. ambiguous concept (two candidate symbols).

## Story 6.2 — Candidate graph traversal

**Acceptance criteria**

- [x] From matched nodes, traversal follows typed edges (imports, calls, data access, events, tests, infrastructure) to build a bounded candidate set with dependency paths (§13.1 `dependencyPath`).
- [x] Traversal depth/breadth limits are configurable; candidates record graph distance.
- [x] Candidate generation is deterministic for a given graph + spec (§43.5). _(under test: identical inputs → byte-identical analyses)_

**Tasks**

- [x] Implement traversal with per-edge-type expansion rules. _(CONTAINS walked upward only — no sibling explosion)_
- [x] Record dependency path per candidate.
- [x] Determinism test: identical inputs → identical candidate sets.

## Story 6.3 — Impact classification

**Acceptance criteria**

- [x] Each candidate gets `likelihood` (required/likely/possible/unlikely), `impactType` (16 types per §13.1), `directness`, `explanation`, `expectedChanges` (§13.1).
- [x] The LLM classifies only the bounded candidate set; any reference to a node outside the set is rejected (§40.3, §43.2, §47.9). _(`refineWithClassifier` whitelists ids against the deterministic candidates; violations become `invalid-reference` warnings, under test)_
- [x] Every inferred impact has explanation + confidence + provenance `llm-inferred` (§40.3). _(confidence stays signal-computed — the response schema has no confidence field at all)_
- [x] Deterministic-only mode still classifies direct matches (required) and 1-hop dependents (likely) by rules.

**Tasks**

- [x] Design classification prompt + strict JSON Schema keyed by candidate node IDs. _(`contracts/ai/classification`; prompt declares repo content untrusted + candidate ids the only legal references)_
- [x] Implement post-validation: node-ID whitelist, downgrade unsupported claims (§34). _(invalid references rejected; taxonomy-invalid claims downgraded to `unsupported-claim` warnings keeping the deterministic result)_
- [x] Implement deterministic rule-based classifier fallback.
- [x] Golden tests: sample specs → expected impact results on fixtures (§42.3). _(pinned in-memory graph goldens; fixture-repo end-to-end with the CLI `analyze` wiring)_

## Story 6.4 — Confidence engine

**Acceptance criteria**

- [x] Confidence is computed from weighted system signals (§14 list: exact match, direct import, direct call, data access, event relation, shared context, framework convention, historical co-change, test association, human confirmation, graph distance, ambiguity, conflicting evidence) — never just an LLM-emitted number. _(weight table in domain under test)_
- [x] Contributing signals per score are stored and exposable to the UI ("why 0.88") (§14). _(`confidenceSignals` on every impact)_
- [x] Ambiguity and conflicting evidence apply penalties (Epic F "ambiguity penalties"). _(ambiguity wired into matching; conflicting-evidence weight defined, applied when contradictions exist)_

**Tasks**

- [x] Implement signal collectors + weighted aggregation in `packages/impact-engine`. _(collectors in `application/build-impact-model`, weights in `domain/impact` per architecture.md)_
- [x] Persist signal breakdown with each impact.
- [x] Unit tests per signal + aggregate calibration tests (§42.1).

## Story 6.5 — Evidence validation & analysis persistence

**Acceptance criteria**

- [x] `ImpactAnalysis` matches §13; references spec version + repository snapshot; statuses draft/reviewed/approved/superseded.
- [x] Every impact references existing graph nodes and evidence IDs; violations are rejected before persistence (§40.3).
- [x] Approved analyses are immutable and versioned (§40.3); re-running creates a new version that supersedes the old draft. _(store rejects any content change; only forward status transitions + pre-approval decision appends)_
- [x] Unsupported-claim rate is measurable from stored data (§41.3). _(warnings carry `unsupported-claim`/`invalid-reference` codes)_

**Tasks**

- [x] Implement analysis store with status lifecycle.
- [x] Implement evidence-validation gate.
- [x] Implement user-decision records (accept/reject/manual add — consumed by Epic 09 UI and CLI). _(append-only; rejected impacts stay in the analysis)_
- [x] Unit tests: immutability of approved analyses, supersede flow.

## Story 6.6 — Architectural alternatives (AI-assisted)

**Acceptance criteria**

- [x] The engine can generate labeled alternative approaches (e.g. query-time vs. materialized vs. scheduled), each with affected components, new/removed dependencies, data/performance/operational implications, complexity, migration and testing needs, advantages, risks (§26). _(each §C8 option now carries `implications` DERIVED from its graph footprint: affected-component count, data/migration changes, API + event contract changes, infrastructure changes, existing test coverage, a weighted complexity band, and risk statements each traceable to a footprint fact — the model proposes the reading, the engine states the consequences; explicit new/removed-dependency deltas between options remain open)_
- [x] Alternatives are clearly labeled AI-assisted; selecting one records it as the approved architectural direction (§26). _(options carry the AI-assisted label in their description; `selectArchitecturalOption` records the selection as a human-confirmed `ArchitecturalDecision` (with `optionId` + `decidedAt`) on specification version N+1 — the analysis is never mutated)_

**Tasks**

- [x] Design alternatives prompt + schema (components restricted to graph nodes). _(inverted deliberately: the interpreter proposes CONCEPTS, the engine derives the footprint — options can only reference nodes that exist, so the restriction is structural rather than prompt-enforced)_
- [x] Persist `ArchitecturalOption` records on the analysis (§13). _(clarification-derived §C8 options bound into `ImpactAnalysis.architecturalOptions` and emitted in the analyze document; full §26 implication fields (perf/migration/risks) remain post-MVP)_
- [x] Implement option selection → `ArchitecturalDecision` on the specification (§11). _(`workspace-engine/src/option-selection.ts` + MCP `select_architectural_option` + `impactgraph select-option <analysisId> <optionId> [description]`; the linked open question is NOT auto-answered — option ids carry no derivable question linkage, so `answer_open_question` stays the explicit path)_
- [x] Fixture test with the §26 visibility example. _(the query-time vs. event-publication divergence is the standing clarification fixture: options, implications, and the linked question are asserted in clarify-specification.test.ts; option selection round-trips in option-selection.test.ts)_
