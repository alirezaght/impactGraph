# Persistence Schema Change: <artifact or table name>

_Required for every change to a persisted shape: SQLite index tables or JSON artifacts (ADR-0006),
or committed YAML config in `.impactgraph/` (PRD §28). Reviewed by the local-persistence agent.
Schema changes require human approval (CLAUDE.md)._

- **Artifact / table affected:** <e.g. artifacts/impact-analysis.json | SQLite `edges` | .impactgraph/contexts.yaml>
- **Store:** SQLite index (disposable cache) | JSON artifact (record) | YAML config (committed)
- **schemaVersion:** <old> → <new>
- **PRD grounding:** §28.<n>, §Z12 if config audit is touched; epic backlog/epic-<NN>-<name>.md
- **Author / date:** <name> / <YYYY-MM-DD>

## Change description

- Fields added: <name: type — semantics, default for old records>
- Fields changed / removed: <...>
- **Classification:** additive | breaking

## Migration plan

- SQLite index: <rebuild from source (preferred — it is a disposable cache) | in-place migration
  because <...>>
- JSON artifacts: <reader upgrades on load, writes only new version | one-shot migration on first
  open | no migration — old versions still parse>
- Migration is idempotent and re-runnable: <how>

## Migration tests (vitest `contract` + `analyzers`/`application` as applicable)

- [ ] Fixture file(s) at version <old> in test-kit: <path>
- [ ] Old fixture loads and migrates to <new> with expected values
- [ ] Corrupted/truncated fixture: typed error, no partial write
- [ ] New writer output validates against version <new> schema

## Backward-compatible reader?

- Can version <new> code read version <old> data: yes / no — <mechanism>
- Can version <old> code encounter version <new> data (e.g. branch switch, shared
  `.impactgraph/`): <behavior — must fail with a typed, actionable error, never corrupt>

## Corruption / rollback behavior (PRD §34)

- Write strategy: <write-temp-then-rename / transaction> — a failed write never destroys the
  previous valid state
- Rollback: <how a user/agent returns to the prior version; rollback identifier recorded (§Z12)?>

## Append-only history preserved?

_Artifacts are records: supersession adds records, never rewrites (PRD §3, main skill §3)._

- yes — change is additive to history | justify any exception (needs ADR + human approval)

## Audit-trail impact (PRD §Z12)

- Config changes only: audit entry fields affected (timestamp, agent identity, model/provider,
  previous value, new value, reason, evidence, confidence, validation result, auto/approved,
  snapshot, rollback ID): <none | which>
- Audit entries for old schema remain readable: <confirmed>

## Size impact

- Expected per-workspace growth: <estimate> — ADR-0006 threshold: artifacts move to SQLite only
  when cross-run queries or >~25 MB stores make load-whole-file impractical. This change
  <stays clear of / approaches> that threshold.
