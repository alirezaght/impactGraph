# ADR-0023: Model "must remain unchanged" as a requirement intent, not an exclusion

- **Status:** Proposed
- **Date:** 2026-08-17
- **Deciders:** product owner (pending), specification-intelligence, impact-modeling,
  implementation-review, domain-provenance
- **Extends:** ADR-0022 (decision-first outputs and structural trust — the change-expectation axis)

## Context

A real evaluation surfaced a sentence shape ImpactGraph had no model for. Specifications routinely
write:

- "The send job must not change behavior."
- "Existing lookup behaviour remains unchanged."
- "Deduplication behaviour must remain unchanged."

These are requirements. They draw a **regression boundary** around a change: they name the surfaces
that must survive it intact. They are the highest-value thing a post-implementation review can
verify, because a diff answers them with certainty — either the protected surface moved or it did
not.

The engine read each of them wrongly, in three different places:

1. **Section vocabulary.** `## Unchanged behaviour` matched the `requirements` heading rule (the
   rule's `behaviou?rs?` alternative), so a list of things that must NOT change became a list of
   positive change predictions — the inverted meaning of the document. `## Explicitly unchanged`
   and `## Regression boundary` matched nothing, so their bullets were dropped silently.
2. **Prose classifier.** "must" fired the strong-modal branch before anything read the negation, so
   "The send job must not change behavior" was admitted as a requirement predicting that the send
   job changes. The unmodal form, "Existing lookup behaviour remains unchanged", fell through to
   `uncertain` and became an open question instead of the requirement it is.
3. **No axis to carry it.** `Requirement.type` says subject matter, `priority` says strength,
   `origin` says where the statement came from, `status` says whether a human confirmed it. None of
   them could say which DIRECTION the requirement points in.

The obvious-looking fix — treat these as non-goals — is wrong, and wrong in a way that would have
looked plausible. A non-goal EXCLUDES a component from the analysis: its impacts are demoted to
`excluded`, and a change there is reported as `unexpected`. A preservation requirement does the
opposite: it keeps the component **in scope**, expects it to be exercised by the change, and demands
that it come out behaviourally identical. Collapsing the two would silently drop the protected
surfaces out of the model — deleting exactly the verification the author asked for.

## Options considered

### Option 1: Treat preservation statements as non-goals

- Pros: no new domain field; reuses the existing exclusion machinery end to end.
- Cons: semantically inverted. Exclusion removes the surface from the analysis, so the guard could
  never be checked; and a legitimate change elsewhere in the file would be reported as
  `unexpected`, contradicting a specification that never said "do not touch this area", only "do
  not change this behaviour". It also conflates two things authors write side by side in the same
  document ("No backfill of previously missed editions" vs "Existing send behaviour must remain
  unchanged").
- Effect on knowledge-category separation: none.
- Effect on privacy posture: none.
- Effect on performance budgets: none.

### Option 2: Reuse `changeExpectation: 'reuse-unchanged'` from ADR-0022

- Pros: no new enum value; review already reports it positively when the surface is untouched.
- Cons: says the wrong thing on the failing side. `reuse-unchanged` is a DESIGN CHOICE ("we plan to
  reuse this as it is"), so a diff there is honestly `divergent` — the implementer may simply have
  found a better route. A regression boundary is the AUTHOR forbidding the change, so crossing it is
  a violated requirement, not a revised plan. Reporting both identically loses the only distinction a
  reader acts on. It also mis-describes the passing side: "planned reuse" claims something about how
  the work should be built that the author never said.
- Effect on knowledge-category separation: none.
- Effect on privacy posture: none.
- Effect on performance budgets: none.

### Option 3: A requirement `intent` axis plus a `preserve` expectation and a `guard-violated` finding

- Pros: each of the three layers says exactly one thing. The specification layer records the
  author's direction (`intent: 'change' | 'preserve'`), the impact layer records what the plan
  expects at a surface (`changeExpectation: 'preserve'`), and the review layer records what the diff
  did about it (`guard-violated` / `reuse-confirmed`). Every field stays additive and optional, with
  a defaulting accessor that preserves the pre-axis reading exactly.
- Cons: three additive contract fields and one enum value ripple through the domain, application,
  contracts, workspace-engine and both shells, with the test churn that implies.
- Effect on knowledge-category separation: none — intent is a deterministic reading of the author's
  own words, provenance unchanged; the extraction records the cue that produced it.
- Effect on privacy posture: none — all classification is local and pattern-based.
- Effect on performance budgets: none — one extra regex pass per statement.

## Decision

We choose **Option 3**. The deciding argument is that the two mistakes here are asymmetric and both
expensive: reading a guard as a change request predicts work nobody asked for, and reading it as an
exclusion deletes the verification the author explicitly requested. Only a distinct axis can avoid
both, and only a distinct review category preserves the difference between "the implementer chose a
different route" and "the implementer crossed a boundary the specification drew".

Concretely:

1. **Section role `preservation`**, ordered ahead of `requirements` (so "Unchanged behaviour" stops
   being read as requirements) and ahead of `non-goals` (safe — the two vocabularies are disjoint).
   Vocabulary: explicitly unchanged, (must) remain unchanged, unchanged/preserved behaviour,
   regression boundary/guards, backwards compatibility, no behaviour/functional change. Its items
   are requirements carrying `intent: 'preserve'`.
2. **`Requirement.intent`**, additive and optional, read through `intentOf` (absence → `change`).
3. **A negated-preservation branch in the prose classifier**, running BEFORE the positive
   strong-modal branch. Its vocabulary lives in one module (`no-change-language.ts`) shared with the
   impact engine's reuse recognizer, so the two never drift apart.
4. **`changeExpectation: 'preserve'`** on the impacts of a preserve-intent requirement, applied to
   the ANCHORED surfaces only (distance 0), exactly as ADR-0022 applies the reuse cue. A guard
   protects what the author named; extending it to traversal-reached neighbours would freeze the
   callers of every protected component and manufacture violations out of ordinary work.
5. **Review category `guard-violated`**, ranked second in the discrepancy order (behind `missing`,
   ahead of `divergent`), counted in the verdict, and worded as a crossed regression boundary. The
   passing side reuses `reuse-confirmed` but says "Regression boundary held", never "planned reuse",
   and counts toward requirement coverage — that satisfaction is the whole verification value of
   stating a boundary.
6. **A forcing function instead of an invented guard.** "Nothing else should change" names no
   surface, so it becomes an `important` open question recommending an explicit boundary section,
   never a guard over components nobody chose. This is the behaviour the evaluation valued: it made
   the author write an "Explicitly unchanged" section naming the send job, lookup and dedup
   surfaces.

Section role outranks wording throughout: a preservation-worded bullet inside a Non-goals section
stays a non-goal.

## Consequences

- Positive: an "Explicitly unchanged" section stops inverting the analysis; the surfaces an author
  protects are predicted, checked against the diff, and reported as satisfied when they hold; a
  crossed boundary is visible as its own thing rather than buried in `divergent`; vague boundaries
  produce a question that improves the specification instead of fake protection.
- Negative / accepted costs: one more review category for every consumer to render; a preservation
  requirement whose surface a diff touches now fails a review that previously passed (intended, but
  it is a behaviour change for existing specs written with this wording); the guard vocabulary is
  pattern-based, so unusual phrasings fall back to the previous reading rather than erroring.
- Packages and boundaries affected: `packages/domain` (specification, impact, review),
  `packages/application` (analyze-specification, build-impact-model, review-implementation),
  `packages/contracts` (cli review output, AI extraction), `packages/workspace-engine` (review
  markdown), `apps/cli`, `apps/vscode-extension`.
- Backward compatibility: all three contract fields are additive and optional with defaulting
  accessors (`intentOf` → `change`, `changeExpectationOf` → `must-change`); persisted specifications
  and analyses stored before this change read back with identical meaning. The `guard-violated`
  category and the `guardViolated` verdict count are additive values on v1 documents — no producer
  emitted them before, so no reader loses anything; JSON Schemas are regenerated.
- New human-approval obligations created: yes. Per CLAUDE.md, expanding a transmitted enum (review
  category) and adding contract fields require human approval before merge, and this ADR requires
  acceptance before its Status moves off Proposed.

## Revisit trigger

The next real-world evaluation. Revisit if `guard-violated` fires on a change the author considered
in-bounds (the boundary is being read too widely — the distance-0 anchoring rule is the first thing
to re-examine), or if a stated regression boundary in a real specification produces no guard at all
(the vocabulary is too narrow). Also revisit if authors start needing to ACCEPT guard violations
routinely, which would mean `ACCEPTABLE_DEVIATION_CATEGORIES` should include the category rather
than forcing a specification edit.
