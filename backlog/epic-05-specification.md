# Epic 05 — Specification Engine & Model Provider Interface

**Goal:** Turn free-text specifications into structured, versioned requirement models with open questions — through an AI-agnostic provider interface that also works with no provider at all.
**Spec:** §8, §11, §40.2, Epic E (§45), §44 Phase 3
**Phase:** 3 · **Depends on:** Epic 01

---

## Story 5.1 — Specification model & versioning

**Acceptance criteria**

- [x] `Specification`, `Requirement`, `OpenQuestion` match §11 (all fields, source types, statuses). _(`packages/domain/src/specification`)_
- [x] Specifications are versioned; saving creates a new version, previous versions immutable (§40.2). _(append-only in the model AND the artifact store — overwriting an existing version is a typed error)_
- [x] Versions can be compared (structural diff of requirements/questions).
- [x] Persisted via `packages/storage`. _(versioned JSON artifacts under `.impactgraph/artifacts/`, atomic writes, per architecture.md naming: `packages/persistence`)_

**Tasks**

- [x] Implement model + JSON Schemas in `packages/specification`. _(domain model + `parseSpecification`; artifact JSON Schema pending contracts/artifacts entry)_
- [x] Implement version store + diff.
- [x] Unit tests: versioning, diff, schema validation.

## Story 5.2 — Model provider interface

**Acceptance criteria**

- [x] `ModelProvider.generateStructuredOutput(request, schema)` interface exists in `packages/provider-interface` (§8). _(as `ModelProviderPort` in `packages/application/src/ports` per architecture.md)_
- [x] Provider strategies supported: user-configured API provider, local model endpoint, external-agent (no direct calls), none/deterministic-only (§8). _(Epic 13 delivered all five: anthropic + openai-compatible (API), local (endpoint), external-agent, none — one guarded choke point, fetch-based, no SDKs)_
- [x] All model output is validated against the supplied JSON Schema; invalid output is rejected and retried/reported, never used (§34, §47.8). _(Zod parse gate baked into `StructuredOutputSchema`; one retry on invalid output)_
- [x] Provider failures are logged without exposing source code (§34). _(typed errors carry category + message only)_

**Tasks**

- [x] Define request/response types, error taxonomy, retry policy.
- [x] Implement provider registry + workspace configuration. _(`buildConfiguredProvider` in ai-inference/registry.ts over `provider.strategy/modelId/baseUrl` in config.yml; keys only via SecretStorage/env)_
- [x] Implement schema-validation wrapper around every provider call. _(`schemaFromZod` in ai-inference)_
- [x] Implement a mock provider for tests + a null provider for deterministic mode. _(test-kit `createFakeModelProvider`; `createNullProvider`)_

## Story 5.3 — Requirement extraction

**Acceptance criteria**

- [x] Extraction produces requirements typed per §11.1 (functional, business-rule, exception, state-transition, data, integration, security, performance, operational, observability, testing, documentation), plus actors, constraints, state changes (§10.3).
- [x] Each requirement keeps a `sourceRange` back to the raw text where possible. _(model returns verbatim excerpts; the use case maps them to offsets — models never emit offsets or ids)_
- [x] Ambiguities become `OpenQuestion` records with severity, displayed separately (§40.2). _(provider path only; prompt restricts questions to materially divergent interpretations, §C3)_
- [x] Without a provider, a deterministic fallback splits the spec into draft requirements (headings/sentences) so the pipeline still runs (§8). _(also used when a configured provider fails — degradation under test)_

**Tasks**

- [x] Design extraction prompt + JSON Schema for structured output. _(`contracts/ai` extraction schema; spec text delimited + declared untrusted)_
- [x] Implement extraction pipeline via `ModelProvider`.
- [x] Implement deterministic fallback extractor.
- [x] Golden tests: three sample specifications (§44 Phase 0) → expected requirement sets. _(SAMPLE_EVALUATIONS pins three specs (deal filtering §46, repository counting, deal expiry) with required direct sets + surprise cases, gated by the §41 metrics suite)_

## Dogfooding finding (2026-08-03) — deterministic extractor splits prose at line breaks

Running `analyze` on `specs/packaging-and-key-flow.md` (a normal two-section markdown spec) with
no AI provider configured produced **10 requirements from ~6 sentences**, several of them
fragments: "extension can open its SQLite index." and "`openSqliteIndexStore` currently fails in
an installed" were each extracted as separate requirements, because the deterministic fallback
segments on NEWLINES rather than sentence or paragraph boundaries. Hard-wrapped prose — the normal
way specs are written — therefore fragments.

- [ ] Segment the deterministic extractor on sentence/paragraph boundaries, not raw lines, so a
      hard-wrapped paragraph is one requirement. _(The impacts were still correct — `openSqliteIndexStore`
      came back `required` at 0.90 and `runConfigureModelProvider` / `SecretStorageLike` at 0.50, so
      the graph half is unaffected — but the requirement LIST is what a user reads first, and
      fragments make it look broken. Found by using the tool on its own repository, which is exactly
      what §44 Phase 0 asks for.)_

## Story 5.4 — Requirement editing & open-question workflow

**Acceptance criteria**

- [x] Users can edit, confirm, or reject extracted requirements; status transitions persist (§11.1, §40.2). _(each mutation persists as append-only spec version N+1; statement edits keep the ORIGINAL requirement id so impact/SATISFIES links survive)_
- [x] Open questions can be answered or dismissed; answers link back to affected requirements (§11.2). _(answer landed with Story 15.5; dismissal added here — status `dismissed`, question preserved; links via `affectedRequirementIds`)_
- [x] Editing a requirement or answering a question marks the current analysis stale (regeneration hint). _(derived, never written: `listAnalyses` computes `stale` from the current spec version; engine-level only — contracts/UI surfacing is a later story)_

**Tasks**

- [x] Implement mutation API on the specification model. _(domain `mutation.ts`: confirm/reject/editStatement/dismiss, typed Results; engine `spec-mutations.ts` wires load→mutate→saveVersion, no ADRs)_
- [x] Implement staleness tracking between spec version and analyses. _(domain `isAnalysisStale`; `AnalysisListing.stale` derived per listing; stored analyses untouched by mutations)_
- [x] Unit tests for all status transitions. _(domain: confirm/reject/edit/dismiss + answer (clarification.test.ts), append-only, stable ids; engine: submit→analyze→mutate→stale end-to-end)_
