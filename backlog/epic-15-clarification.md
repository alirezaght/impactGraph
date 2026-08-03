# Epic 15 — Clarification Engine

**Goal:** A first-class engine that compares architectural interpretations, asks only materially relevant repository-aware questions, records decisions as ADRs, and scores implementation readiness.
**Spec:** Clarification addendum §C1–§C11
**Phase:** v1 (Milestone 3) · **Depends on:** Epics 05, 06

---

## Story 15.1 — Interpretation generation & material-ambiguity detection

**Acceptance criteria**

- [x] For an ambiguous spec, the engine generates multiple valid architectural interpretations and compares their impact graphs (§C3, §C4). _(`clarifySpecification`: interpreter port → per-interpretation footprints (concept match + bounded traversal) → divergence)_
- [x] If interpretations converge to essentially the same implementation, no question is asked; questions are generated only for material divergence (§C3). _(zero-divergence and single-interpretation cases tested to produce zero questions)_
- [x] Generic "information missing" questions are never emitted (§C3). _(structurally impossible: a question can only exist as the artifact of a footprint divergence)_

**Tasks**

- [x] Implement interpretation generation via `ModelProvider` (schema-bound to graph nodes). _(`interpretation-response.v1`; concepts are free text validated by graph matching — invented concepts match nothing and cannot fabricate divergence, tested)_
- [x] Implement impact-graph diffing between interpretations. _(footprint symmetric difference)_
- [x] Implement materiality threshold (component/context/infra delta). _(severity from divergent node categories; convergence = no question)_
- [x] Fixture tests: converging spec → 0 questions; diverging spec → targeted questions. _(6 application tests incl. provider-failure degradation)_

## Story 15.2 — Cost-aware, severity-classified questions

**Acceptance criteria**

- [x] Each question carries estimated architectural impact (affected components/contexts, DB, migrations, infra, API/event contracts, deployment, tests, security) and is prioritized by it (§C5). _(divergent-component count + names in the question/reason; blocking-first ordering. A richer per-cost-class breakdown is open)_
- [x] Severity classes Blocking / Important / Minor per §C6 with the documented semantics. _(data/event divergence → blocking; infrastructure or multi-component → important; single component → minor)_
- [x] Questions flow into the existing `OpenQuestion` model (§11.2) and UI. _(land as spec version N+1; visible in analyze output, get_open_questions, and answerable via answer_open_question)_

**Tasks**

- [x] Implement impact estimator per question from interpretation diffs.
- [x] Implement severity classifier + ordering.
- [x] Extend open-question UI with severity + impact display. _(Story 9.1 spec panel shipped: `question-list.tsx` renders each open question with its severity as TEXT (never colour alone, §37), sorts blocking → important → minor per §C5, and offers answer/dismiss inline; the §C10 readiness summary sits alongside. The per-question IMPACT footprint is not displayed — the analyze document exposes questions per requirement but not the diverging node set behind each one)_

## Story 15.3 — Repository-aware question phrasing

**Acceptance criteria**

- [x] Questions cite repository evidence ("every previous Prisma schema change introduced a migration — should this one migrate existing records?") rather than generic asks (§C7). _(questions name the diverging graph components; the exact "every previous schema change…" citation now exists via history mining and surfaces in drift/learning proposals)_
- [x] Evidence used in questions comes from the graph / git history and is linked. _(graph-derived component names + git co-change mining)_

**Tasks**

- [x] Implement evidence-retrieval step feeding question generation (co-change history, existing patterns). _(`GitPort.readRecentCommitFiles` + `coChangeStats`/`historicalCoChangeProposal`: history-cited evidence ("N of the last M schema changes introduced a migration") flows into drift/learning proposals AND into live question reasons: "History: '<path>' changed in N of the last M commits" (§C7, tested))_
- [x] Prompt + schema requiring cited evidence node IDs. _(inverted deliberately: the model proposes concepts, the ENGINE derives validated node citations — stronger than asking the model to cite)_
- [x] Tests: questions without valid evidence references are rejected. _(invented concepts produce no citations and no blocking severity, tested)_

## Story 15.4 — Architecture simulation (option-based clarification)

**Acceptance criteria**

- [x] Material ambiguities present selectable options (A/B/C) instead of open-ended questions where possible, each with impact graph, components, infra changes, performance/operational implications, risks, trade-offs (§C8). _(options carry affected components, the assumption, and §26 `implications` derived from the footprint: data/migration, API + event contract, infrastructure, testing, complexity band, and risk statements; the trade-off narrative between options is left to the human comparing them)_
- [x] Selecting or modifying an option resolves the ambiguity and updates the specification (§C8). _(options now carry `linkedQuestionId`; selecting one appends the ArchitecturalDecision AND marks that question `answered` with the chosen option's text on spec vN+1 — the question record survives, re-selection never overwrites an existing answer; tested)_
- [x] Builds on Epic 06 story 6.6 alternatives. _(same `ArchitecturalOption` type and the same footprint-derived implications — one option model, not two)_

**Tasks**

- [x] Link ambiguities to generated `ArchitecturalOption`s. _(each material divergence emits one option per reading, id-stable, labeled AI-assisted, deduped, persisted on the analysis and in analyze output)_
- [x] Implement option-selection UI/tool flow (VS Code + MCP). _(MCP `select_architectural_option` + CLI `select-option`, both reporting the resolved question; the VS Code quickpick rides with the Story 9.1 spec panel, which needs the webview stack)_
- [x] Test with the visibility-calculation example (§C8). _(`workspace-engine/src/option-selection.test.ts` selects the query-time-filter option of a deal-visibility spec, with a user-modified description, and proves the approved analysis is untouched; end-to-end interpreter-driven option generation is covered by the clarification tests)_

## Story 15.5 — Architectural Decision Records

**Acceptance criteria**

- [x] Every resolved clarification persists as an ADR with question, decision, reason, snapshot, related requirements/components/contexts, timestamp, author, confidence, manual-confirmation flag (§C9). _(`ClarificationRecord` domain type + append-only artifact store under `.impactgraph/artifacts/clarifications/`; snapshot/node/context links populated when the LLM question pipeline (15.1/15.3) lands)_
- [x] ADRs reduce repeat questions in future analyses (checked before asking) (§C9). _(`applyKnownClarifications` runs in `submitSpecification`: a question whose stable content key matches a recorded decision arrives pre-answered)_
- [x] ADR knowledge is stored as repository knowledge, not model tuning (§C11). _(versioned JSON artifacts, immutable; never fed back as training)_

**Tasks**

- [x] Implement ADR store (in `.impactgraph/` summaries + local DB detail). _(artifact store; SQLite detail mirror deferred until cross-run queries need it, per ADR-0006 threshold)_
- [x] Implement ADR lookup in question-generation pipeline. _(in the extraction path today; the 15.1 interpretation pipeline must reuse the same lookup)_
- [x] Test: same ambiguity in a second analysis → no repeated question. _(domain suppression test; store round-trip/immutability tests)_

## Story 15.6 — Implementation-readiness scoring

**Acceptance criteria**

- [x] Readiness output per §C10: percentage, blocking/important/minor question counts, recommended action. _(`computeReadiness` in domain — deterministic, documented weights, never model-authored)_
- [x] Score derives from requirement completeness, remaining ambiguities, repository + architectural confidence (§C10). _(completeness + open-question severities today; repository/architectural confidence terms join when those signals exist per analysis)_
- [x] Visible in the specification view and exposed via MCP/CLI. _(CLI `analyze` text + JSON (`readiness` field), MCP `get_open_questions` + `answer_open_question`; spec view panel arrives with Story 9.1)_

**Tasks**

- [x] Implement readiness calculator.
- [x] Add UI panel + `analyze` output section + MCP field. _(output + MCP done; UI panel with 9.1)_
- [x] Tests: answering a blocking question raises the score. _(explicit domain test)_
