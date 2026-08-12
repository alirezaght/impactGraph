# ADR-0018 — Constraint extraction trust model

Date: 2026-08-12
Status: Accepted
Relates to: ADR-0017 (constraint layer), ADR-0002 (knowledge categories), ADR-0010 (AI inference)

## Context

Repository guards are arbitrary code. `ci/scripts/check-service-peer-http.py` is a Python script; a
sibling repository's equivalent is a shell script, a custom ESLint rule, or a test that asserts an
import graph. ImpactGraph has to decide, for each one, whether it understands the rule well enough
to stop somebody's work.

The failure mode on each side is asymmetric and both are bad. Understating — reporting nothing for a
guard it cannot parse — reproduces the original failure exactly: the peer-HTTP rule was invisible
until CI failed. Overstating — asserting a rule it inferred — produces a BLOCKED verdict resting on
a guess, and a planner who is wrongly blocked once stops reading the findings.

## Decision

Constraints carry an `extraction` field with four values, and **only `recognized` and `declared`
may produce a blocking finding**. The rule is enforced in the domain constructor, which REJECTS a
`blocking` constraint on a weak extraction rather than quietly downgrading it — a quiet downgrade
hides the producer that fabricated it.

| Extraction    | Source                                                         | May block  |
| ------------- | -------------------------------------------------------------- | ---------- |
| `recognized`  | a deterministic extractor matched a guard shape it understands | yes        |
| `declared`    | a human wrote it in `.impactgraph/constraints.yml`             | yes        |
| `ai-proposed` | a model read a guard and described a rule                      | no — warns |
| `opaque`      | a guard exists and its rule was not extracted                  | no — warns |

Three further rules follow from the same principle:

**Unrecognized guards are indexed, not dropped.** A guard matching no recognizer becomes an
`opaque-check` constraint with a required `notExtractedReason`. "There is a guard here and we cannot
read it" is a finding; silence is not.

**Partially-readable data is treated as unreadable.** A guard whose allowlist contains a computed
member yields NO exemptions rather than the literal subset — a silently narrowed allowlist produces
a false blocking violation, which is the one output this system must never emit.

**Severity follows enforcement.** A guard that prints and exits zero is advice; only a guard that
can fail the build is `blocking`. Reporting advice as a blocker stops work on something CI itself
lets through.

## Alternatives considered

**AI-first extraction.** Broadest coverage, and rejected: it violates "no LLM-only detection for
what static analysis can determine", and the failure mode is a confident BLOCKED verdict on a rule
nobody wrote. AI extraction remains available as `ai-proposed`, where it can surface a candidate a
human then confirms into `declared`.

**Deterministic and declared only, with no AI path at all.** Considered seriously; rejected only
because `ai-proposed` costs nothing when disabled and gives unfamiliar repositories a route from
`opaque` to `declared` that does not require someone to reverse-engineer their own CI.

**Executing guards to observe their behaviour.** Rejected outright: ImpactGraph never executes
repository code.

## Consequences

- Adding support for a new guard shape means adding one recognizer file. No individual repository
  rule is hardcoded anywhere; recognizers know shapes, not instances.
- Coverage of the constraint layer is itself reportable: `opaqueGuardPaths` states which guards were
  seen and not understood, so a clean assessment can be read against what was actually checked.
- On a repository whose guards match no known shape, the system degrades to "there are guards here,
  and we cannot tell you what they say" — which is honest, and materially better than silence.

## Revisit triggers

- If `opaqueGuardPaths` is routinely large on real repositories, the recognizer set is too narrow
  and the answer is more recognizers, not a lower bar for blocking.
- If `ai-proposed` constraints are being confirmed into `declared` unchanged at a high rate, revisit
  whether the model's reading should be promotable with lighter human review.
