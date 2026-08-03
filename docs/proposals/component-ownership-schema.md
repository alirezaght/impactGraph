# Persistence Schema Change: `architecture.yml` component ownership

_Required for every change to a persisted shape (ADR-0006, PRD §28). Schema changes require
human approval (CLAUDE.md)._

- **Artifact / table affected:** `.impactgraph/architecture.yml` (committed YAML config)
- **Store:** YAML config (committed)
- **schemaVersion:** 1 → 1 (additive optional; no bump)
- **PRD grounding:** §16 ("add ownership" is one of the thirteen listed corrections), §Z5
  precedence; `backlog/epic-08-architecture-config.md` Story 8.2 line 29
- **Author / date:** Claude Code / 2026-08-02 — **APPROVED AND IMPLEMENTED 2026-08-02**

## Why this was open

Eleven of the thirteen §16 corrections had shipped. Two had not, for different reasons:

- **split-component** is deliberately absent and stays absent — splitting one detected
  component into two requires inventing graph nodes no deterministic evidence produced, which
  the graph contract forbids. A contract test pins its absence so a future "convenience"
  addition has to be a conscious decision.
- **add-ownership** was absent only because no `.impactgraph/` document had a home for owner or
  team metadata. That was this proposal; it is now shipped, leaving §16 at 12 of 13.

## Change description

`componentAssignmentSchema` (each entry of `architecture.yml` `components[]`) gains one optional
field alongside the existing `path` / `role` / `context` / `markers` / `source`:

- `owner?: string` — free-form owner identifier: a team name, a GitHub handle, a distribution
  list. **Deliberately not an enum and not validated as an email**: ownership vocabularies differ
  per organization, and rejecting a valid team name is worse than accepting an odd one.

Plus one new `configOperationSchema` variant, matching the existing correction shape:

- `{ kind: 'set-component-owner', component: <path glob>, owner: string, reason: string }`

- **Classification:** additive optional. Old documents parse unchanged; absent `owner` means
  "unowned", never "unknown yet".

## What it is NOT

- **Not an access-control mechanism.** ImpactGraph does not gate anything on ownership; nothing
  reads `owner` to permit or deny an operation. It is descriptive metadata surfaced in impact
  output so a human knows who to talk to.
- **Not inferred from git history.** `git blame` tells you who last touched a file, which is a
  different claim from who owns it. If ownership inference is ever wanted it must arrive as
  `llm-inferred` or `git-history` provenance through the normal channel and be confirmable —
  never written into this field as though a human had asserted it.

## Migration plan

- YAML config: none. The field is optional; existing files remain valid.
- Migration is idempotent and re-runnable: n/a.

## Migration tests

- [x] Existing `architecture.yml` fixtures (no `owner`) still parse
      _(`correction-contracts.test.ts`: the pre-corrections v1 document case, plus a new case
      asserting an unassigned component carries no `owner` key at all — absence means unowned,
      not "unknown yet")_
- [x] `set-component-owner` round-trips through the governed path: mode gate → §Z13 validation →
      atomic write → §Z12 audit, with rollback restoring the prior document
      _(`config-corrections.test.ts`, "§16 correction operations — component ownership")_
- [x] The overlay reports owner with its §Z5 precedence level, like every other correction
      _(`overlay.test.ts`, one test per reachable rung: 1 human-confirmed, 2 agent-approved,
      6 defaults — plus two tests pinning that rungs 3–5 are unreachable, see below)_
- [x] Setting an owner on a glob matching no files is a validation error, not a silent no-op
      _(`config-corrections.test.ts` and the MCP flow in `registry-flows.ts`; the glob is checked
      against the same file universe the indexer walks)_

## How "never inferred" is enforced

Not by convention — by having no code path that could do it:

- `resolveOwner` in `overlay-components.ts` takes exactly one candidate source, the committed
  `architecture.yml` assignments. There is no node-category, package-manifest, git-history or
  model candidate, so the resolved level is always 1, 2 or 6.
- `overlay.test.ts` walks every provenance the domain lets a node carry — including
  `git-history` — and asserts `owner` stays `undefined` at `defaults` for all of them, and that
  the set of levels the resolver can ever emit is exactly `{human-confirmed, defaults}` (plus
  `agent-approved` when an agent applies the operation under §Z6).
- `correction-contracts.test.ts` pins that no `infer-component-owner` / `detect-component-owner`
  operation parses, and that `set-component-owner` accepts no source hint (`derivedFrom`) that
  would let a heuristic masquerade as a human assertion. The `.strict()` variant is the guard.

## Backward-compatible reader?

- New code reading old data: yes — the field is optional.
- Old code reading new data: `architectureConfigSchema` is `.strict()`, so an older build
  encountering `owner` fails with a **typed** error and keeps the last valid config (§Z13). That
  is the intended behavior — noisy and safe rather than silently dropping the field — but it is
  the reason this needs approval rather than being additive-and-harmless.

## Corruption / rollback behavior (PRD §34)

Unchanged: the governed operation path writes temp-then-rename after validation, and rollback is
by append (§Z14).

## Append-only history preserved?

Yes — ownership changes are ordinary audited config operations.

## Audit-trail impact (PRD §Z12)

A `set-component-owner` operation produces a normal audit entry with full previous/new documents,
so ownership changes are as traceable as any other correction.

## Recommendation

Approve if you want §16 fully covered; decline if ownership belongs in an external system
(CODEOWNERS, a service catalog) rather than in ImpactGraph's own config — in which case Story 8.2
line 29 should be amended to say so explicitly rather than left looking unfinished.

## Outcome

Approved and implemented on 2026-08-02. Shipped surfaces: `componentAssignmentSchema.owner`, the
`set-component-owner` operation variant (governed applier, §Z12 audit, §Z14 rollback), the §Z5
overlay resolution, `explain_node.effective.owner`, `query_architecture.corrections.ownersSet`,
`detect_repository_structure.packages[].owner`, and the extended `apply_component_correction`
tool — no new tool, the roster stays at 39.
