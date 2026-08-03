# Persistence Schema Change: `.impactgraph/architecture.yml` — §16 human corrections

_Required for every change to a persisted shape: SQLite index tables or JSON artifacts (ADR-0006),
or committed YAML config in `.impactgraph/` (PRD §28). Reviewed by the local-persistence agent.
Schema changes require human approval (CLAUDE.md)._

- **Artifact / table affected:** `.impactgraph/architecture.yml` (`config/architecture-config.v1`),
  plus the operation vocabulary `config/operation.v1` and the new correction-only subset
  `config/component-correction.v1`
- **Store:** YAML config (committed)
- **schemaVersion:** 1 → 1 (no bump — every added field is optional)
- **PRD grounding:** §16 (human correction model), §17, §Z5 (source priority), §Z7, §Z12, §Z13;
  `backlog/epic-08-architecture-config.md` Stories 8.2 and 8.3
- **Author / date:** local-persistence agent / 2026-08-02

## Change description

Fields added to `architecture-config.v1`, all optional:

- `renames[]`: `{ from, to, reason, confirmedAt, source? }` — §16 canonical-name mapping. Renaming
  several names onto one canonical name is how §16 "merge duplicate components" is expressed.
- `relationships[]`: `{ edgeId, confirmed, reason, confirmedAt, source? }` — §16 confirm/reject a
  graph edge. One record per edge; `confirmed: false` excludes the edge from the effective view.
- `components[].markers`: `('generated' | 'ignored' | 'infrastructure' | 'shared')[]`, min length 1
  when present — the §16 marker vocabulary, closed from day one (§16 enumerates exactly four).
- `components[].source`, `contexts[].source`: `'human-confirmed' | 'agent-approved'` — the §Z5
  level that wrote the record. **Absent means human-confirmed**: hand-written YAML and every entry
  written before this change is human project knowledge (§16).

Added to `config/operation.v1` (spread from `config/component-correction.v1`, so the two cannot
drift): `rename-component`, `assign-context`, `set-component-role`, `mark-component`,
`set-relationship-confirmation`. All strict, all carrying the existing `reason` / `confidence`
audit fields.

**Classification:** additive.

**Deliberately not added:** a `split-component` operation. Splitting one detected component into
two would have to invent graph nodes that no deterministic evidence produced — the graph contract
forbids it and no committed-configuration shape represents it honestly. A contract test pins its
absence so a future "convenience" addition is a conscious decision. `§16 add ownership` is also
still open: no `.impactgraph/` document has a home for owner/team metadata yet.

## Migration plan

- SQLite index: untouched. Corrections are read-time overlay input, never index rows; the index
  stays a disposable cache and reindexing cannot overwrite a correction (§34, §43.3).
- YAML config: no migration. Every new field is optional, so a v1 document written before this
  change parses unchanged (contract test: "a v1 document written before corrections existed still
  parses"). New writers emit the new fields; old fields keep their exact semantics.
- Migration is idempotent and re-runnable: there is no migration step to run.

## Migration tests (vitest `contract` + `analyzers`)

- [x] Fixture at the prior shape: `correction-contracts.test.ts` parses a pre-corrections v1
      document (contexts + components, no `source`, no `markers`).
- [x] Old fixture loads under the new schema with expected values; the overlay reads a missing
      `source` as `human-confirmed` (`overlay.test.ts`).
- [x] Invalid document: an unknown `source` level and an empty `markers` array are rejected; the
      §Z13 gate keeps the last valid file (existing `config-operations.test.ts` duplicate test).
- [x] New writer output validates against v1 — persistence validates on read AND write, and every
      correction round-trips through `readArchitectureConfig` in `config-corrections.test.ts`.

## Backward-compatible reader?

- New code reading old data: yes — all added fields optional, with documented absence semantics.
- Old code encountering new data: **rejected with a typed error**, because
  `architectureConfigSchema` is `.strict()`. A checkout that predates this change reports
  `invalid .impactgraph/architecture.yml` and keeps the last valid configuration rather than
  dropping the unknown fields. That is the intended §Z13 behaviour: never silently discard human
  knowledge it cannot represent.

## Corruption / rollback behavior (PRD §34)

- Write strategy: unchanged — schema validation, then write-temp + `rename()`
  (`packages/persistence/src/config/project-config.ts`). A failed write leaves the previous valid
  document byte-identical.
- Rollback: every correction goes through `applyConfigOperation`, so each one appends a §Z12 audit
  entry with a `rollbackId` and the complete previous document.
  `impactgraph.rollback_configuration_change` / "Undo Last Configuration Change" restores it by
  appending, never by rewriting the trail (§Z14). Tested per correction type.

## Append-only history preserved?

- Yes. The YAML documents are current-state, but every transition is recorded in the append-only
  `config-audit.jsonl` with both documents. Corrections that change an existing assignment
  (re-assigning a context, flipping a relationship decision) update the current document in place
  and leave the prior state fully recoverable from the audit trail.

## Audit-trail impact (PRD §Z12)

- No audit-entry field changes. `operation` now carries the new correction kinds; `file` is always
  `architecture.yml` for them; `previousDocument` / `newDocument` carry the full YAML documents, so
  rollback restores the exact prior state.
- Audit entries written before this change remain readable — `configAuditEntrySchema` is unchanged.

## Size impact

- One short record per correction (roughly 120–200 bytes). A workspace with hundreds of
  corrections stays in the low tens of kilobytes. Far clear of the ADR-0006 ~25 MB threshold;
  `architecture.yml` remains a human-editable, committed document.
