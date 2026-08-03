# Artifact Versioning and Persistence Records

How ImpactGraph's persisted data is identified, versioned, migrated, and recovered. The storage
split is decided in ADR-0006; schemas live in `packages/contracts/artifacts` and
`packages/contracts/config`; the stores in `packages/persistence` (owned by local-persistence,
`bounded-contexts.md`). Field-level contract rules are in `data-contracts.md`; the knowledge
semantics carried by these artifacts are in `provenance-model.md`.

## The two-tier split (ADR-0006)

| Tier        | Format                                          | Contents                                                                                           | Nature                                                                                                          |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Records** | Versioned JSON artifacts (append-only)          | Specifications, analysis runs, approved models, review reports, config audit history, product ADRs | The system of record. Never rewritten, never disposable.                                                        |
| **Cache**   | SQLite via `better-sqlite3` (PRD §28.2, §47.15) | Repository index: nodes, edges, symbols, file hashes, provider cache                               | Derived, disposable. Rebuildable from the repository at any time; `ImpactGraph: Clear Local Cache` may drop it. |

Plus human-editable committed YAML in `.impactgraph/` (config, contexts, aliases, rules — PRD §28.1,
§16–17) validated against `contracts/config`. Generated caches are never committed (PRD §16).
Artifacts and the SQLite DB live in non-version-controlled workspace storage (PRD §28.2).

Migration threshold (ADR-0006): artifacts move to SQLite only when cross-run queries or >~25 MB
per-workspace artifact stores make load-whole-file impractical. Until then, JSON records stay
inspectable with a text editor — a deliberate trust property for a tool whose product is auditability.

## Persisted artifact types

| Artifact                                    | PRD basis                                | Mutability                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Specification version                       | §11 (`Specification`, `version: number`) | Append-only: editing creates version N+1; prior versions retained for comparison (§18.2)                                                                                                                                                                    |
| Analysis run (`ImpactAnalysis`)             | §13                                      | Append-only: status transitions `draft → reviewed → approved → superseded` are the only writes; content frozen at creation                                                                                                                                  |
| Approved impact model                       | §40.3                                    | **Immutable.** New information ⇒ new analysis version; old one gets status `superseded`. Never edited, never deleted                                                                                                                                        |
| Review report                               | §38.2                                    | Immutable once produced; a re-review is a new report referencing the same approved analysis                                                                                                                                                                 |
| User impact decisions / accepted deviations | §13 (`userDecisions`), §24.1             | Append-only human-decision records (see `provenance-model.md` supersession)                                                                                                                                                                                 |
| Configuration audit history                 | §Z12                                     | Append-only entries: timestamp, agent identity, provider/model, previous value, new value, reason, evidence, confidence, validation result, automatic-vs-approved, snapshot, rollback ID                                                                    |
| Product ADR records                         | §C9                                      | Append-only: question, decision, reason, snapshot, related requirements/components/contexts, timestamp, author, confidence, manually-confirmed flag. (These are the _product's_ ADRs, not `docs/adr/` — see the terminology guard in `bounded-contexts.md`) |
| Repository snapshot descriptor              | §23.1                                    | Immutable: repo identity, branch, commit, dirty status, index version, timestamp                                                                                                                                                                            |

## Identifier scheme

- **Stable IDs, assigned once.** Every artifact and every embedded record (requirement, impact,
  evidence, decision, audit entry) has an ID that never changes across edits, migrations, or
  export/import. IDs come from the **identifier port** (`application/ports`) — domain code never
  calls a RNG or UUID library directly, keeping domain tests deterministic.
- **Deterministic where reproducibility helps.** IDs derived from content are used where the same
  input must yield the same identity across runs: evidence IDs (hash of snapshot ID + file path +
  range + kind), graph node IDs (snapshot-scoped path/symbol identity), repository snapshot IDs
  (commit + dirty-state digest). This makes golden tests (PRD §42.3) and cross-run comparison
  stable. Random (UUID) IDs are used where identity is an event, not a content: analysis runs,
  review reports, human decisions, audit entries.
- **IDs are opaque to consumers.** No parsing IDs to recover meaning; the fields you'd parse out
  are stored explicitly beside the ID.

## schemaVersion rules

- Every persisted record carries an explicit integer `schemaVersion` — no unversioned record is
  ever written (main skill §5).
- Writers always write the current version. Readers accept every version from 1 to current and
  upgrade on read (backward-compatible readers, `data-contracts.md`).
- A `schemaVersion` bump is required for any change that is not purely additive-optional. Enum
  value additions count as bumps for artifact schemas (no implicit enum expansion).
- Every bump follows `.claude/templates/persistence-schema-change.md`, needs human approval
  (CLAUDE.md), and ships in the same PR as its migration + tests.
- The SQLite index has its own single `indexSchemaVersion` (PRAGMA `user_version`). Because the
  index is a disposable cache, its "migration" may legitimately be _drop and rebuild_ — that is
  never acceptable for JSON artifacts.

## Migration policy and tests

- Migrations for JSON artifacts are pure functions `vN → vN+1` in
  `packages/persistence/src/migrations/`, composed in sequence; a v1 file read by a v4 reader runs
  1→2→3→4.
- Migrations never drop information. If a field becomes obsolete it is preserved under a
  `legacy`-namespaced key or the migration is rejected in review. Append-only history (supersession
  chains, audit entries) must survive every migration bit-for-bit.
- Required tests (vitest `contract` project, run by `pnpm test:contract`): one committed fixture
  file per historical schema version per artifact type; each must load through the migration chain
  and validate against the current Zod schema; a round-trip test (write current → read → deep
  equal); and a "refuses unknown future version" test — a reader encountering
  `schemaVersion > current` fails with a typed error, never guesses.
- The `schema-compat` CI job diffs `packages/contracts/schemas/` (committed JSON Schemas) so any
  contract change is explicit in review.

## Export and import

Exports (implementation context §22, impact report §38.1, review report §38.2, JSON/Markdown per
§20, §10.5) embed: the artifact `schemaVersion`, all referenced IDs (snapshot, spec version, run,
approval, decisions), and the producing tool version. JSON exports validate against
`contracts/artifacts` on write; an import (config restore §Z14, artifact re-load) validates before
acceptance and is rejected atomically on failure — a rejected import changes nothing.

## Corruption recovery — never lose the last valid state (PRD §34, §Z13)

- **Atomic writes**: JSON artifacts are written to a temp file and renamed; a crash mid-write
  leaves the previous file intact.
- **Validate-before-replace**: a new index generation, artifact write, or configuration must fully
  validate before it replaces its predecessor. A failed index build never destroys the previous
  valid index (PRD §34); an invalid configuration never replaces the last valid configuration
  (§Z13), and `impactgraph config rollback` / `ImpactGraph: Undo Last Configuration Change`
  restore from the audit history (§Z14).
- **Corrupt-on-read**: an artifact that fails validation is quarantined (renamed
  `*.corrupt-<timestamp>`), reported via the logging port (never with file contents in the log),
  and the store continues serving remaining artifacts. The disposable SQLite index, if corrupt, is
  rebuilt from scratch.
- Recovery paths are tested with deliberately truncated/garbled fixtures in the `contract` and
  `analyzers` suites.
