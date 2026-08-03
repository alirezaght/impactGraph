# Capability limitations

What the engine cannot currently know, stated as capability gaps rather than as bugs. Each entry
names the evidence that is missing, what the engine does in its absence, and what would close it.

These exist because the alternative is worse. A heuristic that guesses past a missing capability
looks right on fixtures and fails on real repositories, and once a prediction is presented
confidently nobody re-examines the evidence behind it. Where a capability is absent the engine
reports the weaker claim it can actually support.

## File-level dependency evidence cannot distinguish re-export from symbol usage

The graph records that one file imports another. It does not record **which symbols** crossed, so
these are indistinguishable:

- a `export * from './deal-service'` barrel that re-exports without referencing anything;
- an aggregation module that re-exports a curated subset;
- a consumer that imports one symbol and calls it;
- a consumer that imports a type for annotation only, with no runtime dependency.

**Consequence.** A barrel and a genuine consumer are the same shape: both simply import the file
declaring an anchored symbol. Since PRD §46 promises to surface dependents the specification never
named, the ambiguity is resolved toward recall — both are admitted, and both stay at `possible`.
Promoting either to `likely` would present a re-export as predicted change.

**Do not** close this with filename heuristics (`index.ts`, `exports.ts`, `barrel.ts`). Those
improve fixtures and fail on repositories that name aggregation modules differently, or that use
`index.ts` for real logic.

**What would close it.** Symbol-level import indexing: imported symbol names, type-only versus
runtime imports, re-export-only relationships, direct references, and call sites. With those, a
re-export-only relationship can be excluded while a call site is promoted.

## `USES` conflates relationships with different propagation semantics

RESOLVED by the PRD §12.2.1 relationship split — retained here for the reachability finding, which
was not what the original entry assumed.

`USES` was emitted for at least six unrelated facts, and appeared to double as the fallback when a
more specific classification failed (`EDGE_TYPE.get(kind) ?? 'USES'` in the pub/sub adapters):

| Producer                                | Actual relationship               |
| --------------------------------------- | --------------------------------- |
| `assemble.ts` (`injects`)               | constructor injection (DI)        |
| `spring-injection.ts`                   | Spring dependency injection       |
| `express-adapter.ts`                    | middleware and route usage        |
| `cross-stack/page-links.ts`             | page → HTTP route reference       |
| `cross-stack/template-calls.ts`         | template → symbol call            |
| `terraform-graph.ts`                    | Terraform resource reference      |
| pub/sub adapters (`?? 'USES'` fallback) | an unclassified messaging binding |

Each producer now emits a named relationship, so a type annotation and a runtime registry binding no
longer propagate identically. No `USES` edge remains in any fixture golden.

**The unknown bucket was not real.** Those `?? 'USES'` fallbacks are UNREACHABLE. `HandleKind` and
`PubSubResourceKind` are both exactly `'topic' | 'subscription'` and the maps cover both entries; the
TypeScript producer is additionally guarded by `isNamed(handle)`, and a `'client'` handle is
constructed without a name. So the "USES is also where classification failures land" reading —
including in the first version of this entry — described code that cannot execute.

They are migrated to `USES_UNKNOWN` regardless, so that a kind added to one of those unions fails
loudly as an unknown rather than silently borrowing a relationship it is not. What follows from the
reachability finding is that `USES_UNKNOWN` has no live producer, so a by-producer unknown-bucket
metric would report zero by construction, and attaching derivation provenance to those paths would
instrument code that never runs. Both wait for a producer that can actually fail to classify.

## The predicted change kind is inferred from specification wording only

Propagation depends on what kind of change a requirement implies — adding a method obliges no
caller, while changing a required parameter obliges every call site. The engine reads that from
explicit specification language (see `build-impact-model/change-kind.ts`); it performs no semantic
analysis of the described change.

**Consequence.** Wording that does not match a known pattern yields `unknown`, and dependents stay
at `possible`. This under-promotes rather than over-promotes, which is the safe direction.

**What would close it.** Nothing cheaply. Deeper inference would need the AI layer, whose output is
never authoritative (§34), so any promotion derived from it would still require deterministic
corroboration.
