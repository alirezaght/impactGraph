# ADR-0016: Architecture-Aware Concept Matching Under the Name-Similarity Ceiling

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** Project maintainer (approved 2026-08-07), Claude Code

## Context

Dogfooding item 5: a specification says "deals"; the repository says `DealsController`. The
matcher rejected the pair, the requirement anchored nowhere, and the analysis missed the single
most obvious component in the plan. This is the most common planning miss the trials produced,
and it is systematic: specification authors name the domain word, code appends a conventional
role suffix (`Controller`, `Service`, `Repository`, …).

The matcher was deliberately convention-blind. `matchConcepts` requires token alignment plus
character coverage ≥ 0.6, so `deals` → `DealsController` fails at 0.33 — the same rule that
correctly rejects `Storage` → `SecretStorage` (a bare head noun claiming every compound ending
in it). That blindness was a safety property when ANY name match could claim `required`: loosening
it would have presented keyword coincidences as obligations, the exact failure ADR-0015 item 1
records.

The safety landscape changed with the ADR-0015 addendum (2026-08-06): fuzzy name matches now
carry the distinct `name-similarity` evidence basis with a hard tier ceiling of `likely`, the
ceiling is enforced in the domain (`capLikelihood`), guessed anchors poison their whole route,
and the downgrade is auditable via `tierCappedBy`. The ceiling — not the matcher's blindness — is
now the safety valve. The matcher can become convention-aware without reopening the
misleading-confidence hole.

## Decision

Concept-to-component matching recognizes architectural naming conventions, gated to the capped
basis.

**The rule — "cover the whole stem", not "share a token".** A concept matches a component when,
after stripping a closed list of architectural suffix tokens from the trailing end of the
COMPONENT name, the concept IS the remaining stem — compared as normalized character strings, so
the same word behaves the same in every casing (`TypeScript` camel-splits into two tokens where
`typescript` stays one; characters erase that difference, for the same reason `nameCoverage`
measures characters).

**The closed suffix list** (lowercase name tokens): `controller`, `service`, `repository`,
`module`, `handler`, `adapter`, `provider`, `store`, `factory`, `gateway`, `client`, `dto`,
`config`. Finalized against what the fixture repositories and framework adapters actually
produce (`DealsController`/`DealsService`/`DealsModule` in nestjs-app, `DealRepository` in
ts-basic, `PubSubInboundChannelAdapter` in java-spring, `TestClient`, `DealDto`,
`provider-config`). Only trailing tokens are stripped, stacked ones included
(`DealServiceFactory` → `deal`): a suffix word mid-name describes what the component is about,
not its role.

**What still rejects, by construction:**

- `Storage` → `SecretStorage`: no listed suffix is stripped, so the stem rule does not apply and
  the ordinary alignment + coverage rule keeps rejecting it. Suffix-only concepts (`dto` →
  `DealDto`) add no stem token and reject likewise. The pinned matrix gate stays a gate.
- `deal` → `IdealService`, `index` → `reindexer`: token boundaries still hold.
- `deals` → `DealController`: stem equality is exact — no stemming, no plural folding.
- `user deals` → `DealsController`: the concept must BE the stem, not contain it.

**The ceiling is load-bearing.** Stem-covered matches use mechanism `name-similarity` → basis
`name-similarity` → tier ceiling `likely`, never `required`, with `tierCappedBy` recording the
downgrade. Every existing matcher guard applies unchanged: ambiguity escalation when more than
`MAX_SIMILAR_MATCHES` components share a stem (a NestJS feature folder holding a controller,
service, module, and repository escalates to a clarification question instead of four anchors),
test-artifact suppression, and dependency-ubiquity suppression. Exact and alias resolution still
short-circuit first.

## Options considered

1. **Stay convention-blind.** Keeps the matcher maximally precise but misses
   `deals` → `DealsController`, the most common planning miss observed. Rejected: the ceiling now
   provides the safety the blindness used to, so the miss buys nothing.
2. **Loosen `nameCoverage` globally.** One threshold cannot separate the pairs that must match
   from the pairs that must not: the calibration matrix proves `API key` → `ApiKeySecret`
   (must match) scores LOWER than `Storage` → `SecretStorage` (must reject). Lowering the
   threshold reopens coincidence matching everywhere, for every concept length. Rejected.
3. **Stem-covering match gated to the capped basis** (chosen). The widening is scoped to one
   auditable convention, and everything it admits is structurally prevented from claiming
   `required` by the domain-enforced ceiling.

## Consequences

- `matchConcepts` gains one resolution refinement inside the similarity step
  (`packages/application/src/build-impact-model/architectural-stem.ts`); mechanism, basis, and
  ceiling wiring are unchanged — no contract or schema change.
- The ts-basic evaluation sample "absent component near-name" was re-judged: `Base` →
  `BaseService` is now a correct `likely`-capped resolution rather than an unknown concept. The
  sample now pins both halves of the new judgment — the near-name MUST be surfaced, and MUST NOT
  reach `required` (`requiredTier.mustNotContain`). Analysis goldens moved by exactly the 12
  candidates of that sample, all on the `name-similarity` basis.
- A concept that is a bare domain word (`deal`) in a repository without an exact `Deal` node now
  resolves to its conventional variants — or escalates to ambiguity when they are many. Both
  outcomes are better answers than "unknown concept" for planning.

## Revisit triggers

- If measured precision at `possible`/`likely` (§41 eval, `record_actual_impact` outcomes) drops
  after this lands, the stem rule is admitting coincidences the ceiling does not neutralize —
  tighten the rule (minimum stem length, category constraints) before touching thresholds.
- If the suffix list starts growing per-framework (e.g. Rails `Concern`, Django `ViewSet`), move
  it to language/framework-adapter metadata so each stack declares its own conventions, instead
  of one global list absorbing every ecosystem.
- If ambiguity escalation fires on most stem matches in real repositories (feature folders
  routinely hold 4+ suffix variants), the escalation bound needs a convention-aware exception —
  a deliberate decision, not a bumped constant.
