# ADR-0019 — Provisional review baselines

Date: 2026-08-14
Status: Accepted
Relates to: ADR-0002 (knowledge categories), ADR-0009 (versioned boundary contracts). Extends the
review model of PRD §23–25 and the approval semantics of §40.3.

## Context

A field evaluation ended with the developer wanting exactly one thing from ImpactGraph after
implementing: "did what I build match what ImpactGraph predicted?" The review pipeline refused,
because review has always required a human-approved analysis as its baseline — and the developer
had never approved one, because the analysis was a prediction they were evaluating, not a plan
they had committed to.

The refusal protected something real. §40.3 exists so that "the approved analysis" is a frozen
contract: it cannot be edited after the fact to make a review report look right, and there is
exactly one of it per specification version, so a report's baseline is never silently chosen.
But an inspection of the comparison engine showed that nothing in it reads the analysis status:
diff comparison, plan-contract checking, drift classification and coverage estimation work
identically on a draft. Approval buys authority and immutability, not computability. Requiring it
for every comparison made the feature unavailable at the moment it is most informative — and the
practical workaround, retroactively approving a stale prediction purely to unlock a read-only
report, would be a semantically false statement that also freezes the draft.

## Decision

Review baselines carry an explicit **authority axis**: `approved-contract` or
`unapproved-prediction`.

1. The default is unchanged: with no arguments, review resolves the single approved analysis and
   refuses when none exists. The refusal now names the newest live draft and the flag that would
   compare against it, so the capability is discoverable exactly where it is wanted.
2. Comparing against a draft requires an explicit acknowledgement (`allowUnapprovedBaseline:
true`, mirroring the `confirmedByUser` idiom) — an agent can never wander into a draft
   comparison silently. Superseded analyses are never accepted; a retired record is not a
   prediction.
3. A provisional review must say so everywhere a reader could form a conclusion: the report
   carries a `baseline` block naming the analysis, its status and its authority; confidence is
   capped at `limited` with the reason stated; the scope limitations name the draft; the markdown
   headings say "unapproved draft" where the approved wording said "Approved".
4. The one mechanic that only makes sense against a commitment stays gated: accepting a review
   deviation against an unapproved baseline is refused, because "accepted deviation from a plan
   nobody committed to" would launder a draft into a contract. `export_implementation_context`
   likewise still requires approval — a plan handed to an implementer is a commitment.

## Alternatives considered

**Auto-approve on review.** Rejected: it destroys the draft's editability and forges a human
statement (§35 — ImpactGraph never approves its own assessment).

**Relax `loadApprovedAnalysis` in place.** Rejected: it would silently weaken every caller,
including the implementation-context export, and make baseline selection ambiguous (many drafts
may exist; only one approved analysis can).

**A separate "compare" tool distinct from review.** Rejected: it duplicates the entire report
surface, and the distinction the reader needs is authority, not tool name.

## Consequences

- The review output and artifact schemas gain an additive optional `baseline` block; artifacts
  without it are approved-era reviews and are read as `approved-contract`.
- A provisional report can never be mistaken for a contract review by a consumer that reads
  either the authority field, the confidence level, or the limitations — the claim is carried
  redundantly on purpose.
- Post-hoc accuracy work (record_actual_impact) and provisional review now compose: a prediction
  can be measured without ever being promoted.

## Revisit triggers

- If provisional reviews turn out to be the dominant usage, revisit whether approval should
  remain the default resolution rather than an explicit mode.
- If accepted deviations are requested against drafts repeatedly, design a draft-scoped
  annotation that does not share vocabulary with accepted deviations.
