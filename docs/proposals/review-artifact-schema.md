# Persistence Schema Change: `artifacts/reviews/<reviewId>.json`

_Required for every change to a persisted shape (ADR-0006, PRD §28). Schema changes require
human approval (CLAUDE.md)._

- **Artifact / table affected:** `.impactgraph/artifacts/reviews/<reviewId>.json` (new)
- **Store:** JSON artifact (record)
- **schemaVersion:** — → 1 (new artifact; no prior version exists)
- **PRD grounding:** §24.1 (Accepted deviation), §38.2 (review report), §23 (snapshot binding);
  `backlog/epic-11-review-engine.md` Story 11.2
- **Author / date:** Claude Code / 2026-08-02

## Change description

Reviews were previously computed and rendered but never persisted, so an accepted-deviation
decision had nothing to attach to. This artifact makes a review run a record.

- Fields added:
  - `schemaVersion: 1`
  - `id: string` — the review id, also the filename
  - `createdAt: string` — ISO timestamp from the clock port
  - `document: cliReviewOutput.v1` — the full §38.2 review document exactly as produced by the
    run, embedded verbatim rather than re-derived (so a re-render can never disagree with what
    was reviewed)
  - `acceptedDeviations: AcceptedDeviation[]` — append-only decisions bound to THIS review,
    each `{ nodeId, category, reason, actor: 'user' | 'agent', decidedAt }`
- Fields changed / removed: none
- **Classification:** additive (new artifact)

Two related additive-optional changes to `cliReviewOutput.v1` ship with it: an optional
`reviewId`, and an optional `acceptedDeviation: { reason }` per finding. Both are absent on
documents written before this change, and both are marks laid ALONGSIDE a finding — a finding
is never recategorized by an acceptance (§24.1).

## Migration plan

- JSON artifacts: no migration. No prior version of this artifact exists; readers of the review
  DOCUMENT (`cliReviewOutput.v1`) see only additive optional fields.
- Migration is idempotent and re-runnable: n/a — nothing to migrate.

## Migration tests

- [x] New writer output validates against version 1 (`review-artifact.test.ts`, contract project)
- [x] Corrupted/truncated fixture: typed error, no partial write (artifact store shared path)
- [x] A review document written before this change still parses (the added fields are optional)
- [ ] No version-0 fixture exists to migrate — deliberately, the artifact is new

## Backward-compatible reader?

- Can version 1 code read older data: yes — older _review documents_ (not artifacts) parse
  unchanged; the new fields are optional.
- Can older code encounter version 1 data: an older build simply does not look in
  `artifacts/reviews/`. If it reads a v1 review document, the optional `reviewId` /
  `acceptedDeviation` fields are ignored by a passthrough reader and rejected by a strict one
  with a typed error — never silently misread.

## Corruption / rollback behavior (PRD §34)

- Write strategy: the shared artifact-store path — write temp, fsync, atomic rename. A failed
  write never destroys a previous review.
- The stored document is **immutable once written**; accepting a deviation appends to
  `acceptedDeviations` and never rewrites `document`. Dropping or reordering an existing
  decision is rejected by the store guard.
- Rollback: a re-run review produces a NEW `reviewId` and a new artifact. Acceptance is
  deliberately **not** inherited across runs — each review binds its own decisions, so a stale
  acceptance can never silence a finding in a later review.

## Append-only history preserved?

Yes. Reviews accumulate as separate artifacts; decisions accumulate within one artifact. Nothing
is rewritten or deleted.

## Audit-trail impact (PRD §Z12)

Not a configuration change — no `.impactgraph/` config document is touched, so no §Z12 audit
entry is involved. The acceptance record itself carries actor and timestamp.

## Size impact

One artifact per review run, dominated by the embedded §38.2 document (kilobytes for the
fixtures; scales with finding count). Reviews are not pruned today — if a long-lived workspace
accumulates enough of them to matter, retention is a follow-up decision, not a schema change.

## Reviewer notes

The judgement worth checking: `document` embeds the whole review rather than storing findings
normalized. That costs duplication if the same review is re-rendered, and buys the guarantee
that what is displayed later is byte-identical to what was reviewed and accepted against.
