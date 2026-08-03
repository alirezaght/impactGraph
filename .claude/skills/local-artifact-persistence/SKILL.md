---
name: local-artifact-persistence
description: Use when writing or reviewing packages/persistence — SQLite index, JSON artifacts, YAML .impactgraph/ config, migrations, atomic writes, corruption recovery, config audit history and rollback. Triggers on better-sqlite3, schemaVersion, artifact stores, workspace storage paths, append-only records, and persistence DTO mapping.
---

# Local Artifact Persistence

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill adds rules for `packages/persistence`. Owning agent: `local-persistence`.
Decision record: ADR-0006. Backlog: `backlog/epic-01-graph-core.md`,
`backlog/epic-08-architecture-config.md`.

## Purpose

Implement the application persistence ports over the **hybrid storage model** (PRD §28,
ADR-0006) without ever losing a valid record, a valid index, or a line of history.

## When to use

- Any change under `packages/persistence`: SQLite schema, artifact stores, YAML config I/O,
  migrations, repository-identity resolution, audit history.
- Any persisted schema change (also requires `.claude/templates/persistence-schema-change.md`
  and `/review-contracts`).

## When NOT to use

- Defining artifact/config DTO schemas → `typed-message-contract-development`
  (`packages/contracts/artifacts`, `packages/contracts/config`); persistence consumes them.
- Deciding _what_ a record means (supersession semantics, staleness) → domain skills; this
  package stores decisions, it doesn't make them.
- Query performance tuning with measurements → `performance-investigation`.

## Required context

PRD §16 (human corrections → `.impactgraph/`), §17 (config shape + JSON Schema), §28 (storage
architecture), §34 (reliability), §Z12 (config audit record), §Z13 (config validation),
§Z14 (config rollback); `docs/engineering/artifact-versioning.md`, `data-contracts.md`; ADR-0006.

## The hybrid model (do not re-litigate — ADR-0006)

| Store                                                                  | Technology                                                                             | Role                                                         | Committed?          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| Repository index (nodes, edges, symbols, file hashes, evidence)        | SQLite via `better-sqlite3` (PRD §28.2, §47.15)                                        | **Disposable cache** — rebuildable from the repo at any time | Never               |
| Specifications, analysis runs, approved models, reviews, audit history | Versioned JSON artifacts                                                               | **Append-only records** — the system of record               | Never (local state) |
| Config, contexts, component mappings, aliases, rules, ignores          | YAML in `.impactgraph/` (`config.yml`, `architecture.yml`, `aliases.yml`, `rules.yml`) | Human-editable project knowledge (PRD §16, §28.1)            | Yes                 |

Artifacts move into SQLite only when cross-run queries or >~25 MB per-workspace stores make
load-whole-file impractical (ADR-0006 threshold) — that is an ADR revision, not a refactor.

## Architectural rules

- Persistence implements application **ports**; nothing outside this package touches SQLite,
  artifact files, or `.impactgraph/` parsing. No `fs` elsewhere in core (main skill §2).
- **Persistence DTOs never leak into domain.** Read: parse → Zod-validate
  (`packages/contracts/artifacts`) → map to domain at the adapter. Write: map domain → DTO →
  validate → serialize. A domain type in a table row or JSON file is a blocking review finding.
- **Atomic writes, always**: write to a temp file in the same directory, fsync, then `rename()`
  over the target. Same pattern for YAML config writes. Never truncate-then-write in place.
- **Every persisted record carries `schemaVersion`** plus stable IDs, repository-snapshot ID,
  and (where applicable) specification version and analysis-run ID (main skill §3).
- Migrations: SQLite schema changes use numbered forward migrations inside a transaction with
  `user_version` tracking; artifact schema bumps ship a versioned reader that upgrades old
  records on read. Both require migration tests against fixtures of every prior version.
- **Repository identity**: index and artifacts are keyed by a stable repository identity
  (workspace path + git remote/root hash), stored in VS Code workspace storage or an equivalent
  non-committed location (PRD §28.2). Two checkouts of the same repo must not corrupt each other.
- Storage abstraction must not preclude the future team backend (PRD §28.3) — no path literals
  above the adapter, no assumption of a single writer baked into the port.

## Domain rules

- **Append-only history.** Approved impact models are immutable; a new approval writes a new
  version and marks the prior one `superseded` (PRD §40.3). Human confirmation supersedes prior
  records — this package must make destructive update physically awkward: no generic
  `update(record)` on record stores; expose `append`, `supersede`, `markStale`.
- **Corruption recovery (PRD §34): never lose the last valid index.** A rebuild writes to a new
  SQLite file (or staging tables) and swaps only after integrity checks pass. On open, run
  `PRAGMA quick_check`; a corrupt index is quarantined (renamed, not deleted) and rebuilt —
  artifacts and `.impactgraph/` are untouched by any index failure.
- **Config audit history (PRD §Z12):** every AI-generated config change records timestamp, agent
  identity, model/provider, previous value, new value, reason, evidence, confidence, validation
  result, automatic-vs-approved, repository snapshot, and a rollback identifier.
- **Rollback (PRD §Z14):** support `config history` / `config diff` / `config rollback` /
  `config restore <version>` semantics — rollback appends a new config version referencing the
  rollback identifier; it never rewrites the audit trail.
- **Validation gate (PRD §Z13):** an invalid configuration must never replace the last valid
  configuration — validate before the atomic rename, keep the previous file on failure.

## Security & privacy rules

- No secrets, provider keys, prompts, or raw source bodies in SQLite, artifacts, or logs —
  evidence stores file paths, symbol IDs, and source _ranges_, not copied file contents beyond
  what the evidence model explicitly allows.
- `.impactgraph/.gitignore` ensures generated caches are never committed (PRD §16).
- Paths from config/repo are treated as untrusted: resolve and confine to the workspace root
  (path-traversal and symlink tests, PRD §42.5). Parse YAML safely (no custom tags).

## Testing requirements

- Vitest `unit` project for pure mapping; adapter tests against real temp-dir SQLite/files
  (better-sqlite3 is sync and fast — no mocking SQLite).
- Migration tests: fixture stores at every historical `schemaVersion` must open and upgrade.
- Crash-safety tests: kill between temp-write and rename → old file intact; corrupt SQLite
  fixture → quarantine + rebuild path exercised.
- Round-trip property: domain → DTO → bytes → DTO → domain is identity for every record type.
- Audit/rollback tests: apply → rollback → history shows both entries, config equals prior value.

## Common failure modes

- "Cleanup" that deletes superseded records or old analysis versions — history is the product.
- In-place `JSON.stringify` overwrite — a crash mid-write destroys the only copy.
- Bumping a Zod schema without bumping `schemaVersion` or adding the fixture for the old version.
- Rebuilding the index into the live file, then failing — the previous valid index is gone (§34).
- Rollback implemented as "restore file + delete newer audit rows" — audit is append-only.
- Reusing one SQLite file across repository identities because the workspace path matched.

## Checklist

- [ ] Change confined to persistence; DTO↔domain mapping at the adapter, no leaks either way
- [ ] Atomic write pattern used for every new write path
- [ ] `schemaVersion` present; migration + fixtures for every prior version; schema-change
      template filled; `/review-contracts` run
- [ ] Index failure paths keep the last valid index; artifacts unaffected
- [ ] Audit record complete per §Z12; rollback appends, never rewrites
- [ ] Crash-safety and round-trip tests added; `pnpm quality:gates` green

## Definition of done

The port is implemented with atomic, versioned, append-only storage; the last valid index and
config survive every failure path in tests; audit history explains every AI-driven change and
rollback; and no domain type or secret ever touches disk formats.
