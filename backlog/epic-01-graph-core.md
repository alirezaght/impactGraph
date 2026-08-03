# Epic 01 — Graph Core & Local Storage

**Goal:** A language-neutral repository knowledge graph with typed nodes, edges, evidence and provenance, persisted in SQLite, tied to repository snapshots. Every later engine (impact, review, clarification) operates only on this graph.
**Spec:** §12, §28, §29, §23.1, §47 (13–15), §C14
**Phase:** 0–1 · **Depends on:** —

---

## Story 1.1 — Define the graph schema (nodes, edges, evidence, provenance)

The typed vocabulary of the whole product: node categories (intent, domain, application, data, integration, infrastructure, repository — §12.1), the 27 edge types (§12.2), and the `Provenance` union (§12.3).

> Implementation note: per `docs/engineering/architecture.md`, the PRD §29 `packages/graph`
> vocabulary lives in `packages/domain` (`src/repository/`, `src/provenance/`). Design record:
> `docs/proposals/domain-repository-graph-schema.md`.

**Acceptance criteria**

- [x] All node categories and edge types from §12 exist as typed definitions in `packages/graph`. _(implemented in `packages/domain`)_
- [x] Every node and edge carries a mandatory `provenance` field; construction without it fails at compile/validation time.
- [x] Evidence records link a claim to concrete sources (file, range, symbol, config key).
- [x] Schema is serializable to/from JSON with schema validation. _(pure-TS validated parse in domain; generated JSON Schema files arrive with `packages/contracts`)_
- [x] Repository facts and AI inferences are stored as distinct provenance values and are queryable separately (§3, §47.10). _(provenance stored on every node/edge; `knowledgeCategoryOf` + graph queries expose it; `find_components`/`explain_node` surface provenance + derived category)_

**Tasks**

- [x] Create `packages/graph` with node/edge/evidence type definitions. _(as `packages/domain`)_
- [x] Define JSON Schemas for node, edge, evidence. _(`contracts/artifacts`: graph-node/graph-edge/evidence-record/repository-snapshot v1 schemas, generated from Zod, with domain-alignment + json-schema-sync tests)_
- [x] Implement construction-time validation (reject unknown types, missing provenance).
- [x] Write unit tests for serialization round-trips and validation failures.

## Story 1.2 — SQLite persistence layer

**Acceptance criteria**

- [x] Graph nodes, edges, evidence, snapshots and analysis versions persist to a local SQLite database (§28.2). _(analysis-version records arrive with Epic 06 — no such domain type exists yet)_
- [x] DB lives outside version control (workspace storage or equivalent); nothing generated is committable (§16). _(the store takes its path from the composition root; nothing writes into the repo)_
- [x] Storage sits behind an abstraction that would permit a future team backend (§28.3) — no raw SQL outside `packages/storage`. _(`IndexStorePort` in `packages/application`; SQL only in `packages/persistence`)_
- [x] A failed write never corrupts the previous valid state (§34).

**Tasks**

- [x] Create `packages/storage` with schema migrations for the DB itself. _(as `packages/persistence` per architecture.md; `user_version` migrations)_
- [x] Implement node/edge/evidence repositories with batch upsert.
- [x] Implement transactional write with rollback on failure.
- [x] Add storage interface so core engines never touch SQLite directly.
- [x] Unit-test crash-mid-write recovery. _(mid-batch rollback + corrupt-file quarantine tests)_

## Story 1.3 — Repository snapshots

**Acceptance criteria**

- [x] A snapshot records repository identity, branch, commit, dirty-tree flag, index version, timestamp (§23.1). _(`packages/domain` `RepositorySnapshot`, immutable + validated)_
- [x] Every index run and every analysis references exactly one snapshot. _(indexRepository binds one captured snapshot per run; analyses carry `repositorySnapshotId`; enforced end to end since Epic 02)_
- [x] Snapshots are immutable once written. _(domain type frozen; the SQLite store ignores conflicting rewrites — first write wins, under test)_

**Tasks**

- [x] Implement Git metadata reader (no code execution, plain `git` plumbing or a lib). _(`packages/git` CLI adapter, argument arrays only)_
- [x] Persist snapshots; link index + analyses via foreign keys. _(nodes/edges/evidence FK → snapshots; analyses follow with Epic 06)_
- [x] Unit tests: dirty tree, detached HEAD, non-git folder (graceful error). _(plus no-commits repo and hostile filenames)_

## Story 1.4 — Graph query API

**Acceptance criteria**

- [x] Core API supports: find nodes by type/name/path, neighbors by edge type, shortest dependency path between two nodes, subgraph extraction by context.
- [x] Queries can filter by provenance (facts only / include inferences). _(record-wide `knowledgeCategories` filter — never returns or traverses a category outside the filter)_
- [x] Query results are deterministic (stable ordering) (§34).

**Tasks**

- [x] Implement query layer in `packages/graph` over the storage interface. _(pure in-memory `KnowledgeGraph` in `packages/domain`; a storage-backed view arrives with Story 1.2)_
- [x] Implement dependency-path search (BFS with edge-type filters).
- [x] Benchmark on a 5,000-file synthetic graph (§33 targets). _(measured 2026-08-01 on a 5,006-file synthetic TS repo: full index 0.7 s (budget 120 s), incremental after 1-file touch 0.61 s with 5,005 reused (budget 3 s) — both far inside §33)_
- [x] Unit tests for every query primitive.

## Story 1.5 — Monorepo package structure

**Acceptance criteria**

- [x] Repo scaffolded per §29: `apps/{vscode-extension,cli,mcp-server}`, `packages/{core,graph,storage,specification,impact-engine,review-engine,provider-interface,language-adapters,framework-adapters,shared}`. _(complete under the `docs/engineering/architecture.md` naming: domain/application/contracts/persistence/git/ai-inference/repository-intelligence/language-adapters/framework-adapters/workspace-engine/test-kit — same responsibilities, deliberately clearer names)_
- [x] `packages/*` build without any VS Code dependency (§47.5).
- [x] Lint rule or build check enforces the dependency direction (apps → packages, never reverse).

**Tasks**

- [x] Initialize workspace tooling (package manager workspaces, TS config, build, test runner).
- [x] Add CI pipeline: lint, typecheck, unit tests. _(.github/workflows/ci.yml)_
- [x] Add dependency-boundary enforcement. _(eslint-plugin-boundaries, docs/engineering/dependency-rules.md)_
