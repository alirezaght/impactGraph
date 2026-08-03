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

| Producer                                | Actual relationship                     | Now emits              |
| --------------------------------------- | --------------------------------------- | ---------------------- |
| `assemble.ts` (`injects`)               | constructor injection (DI)              | `INJECTS`              |
| `spring-injection.ts`                   | Spring dependency injection             | `INJECTS`              |
| `express-adapter.ts`                    | application middleware attachment       | `USES_MIDDLEWARE`      |
| `cross-stack/page-links.ts`             | page-to-page navigation reference       | `NAVIGATES_TO`         |
| `cross-stack/template-calls.ts`         | template path matched to a route        | see below              |
| `terraform-graph.ts`                    | Terraform secret reference              | `REFERENCES_RESOURCE`  |
| pub/sub adapters (`?? 'USES'` fallback) | nothing — the path is unreachable       | `USES_UNKNOWN`, unused |

`template-calls.ts` emits three types, not one, because a reference site states which: a `fetch`
crosses a network boundary (`CALLS_ENDPOINT`), a `form.action` submits (`SUBMITS_TO`), and an
`a[href]` navigates (`NAVIGATES_TO`). `ROUTES_TO` was proposed for this row and withdrawn — one type
over three obligations would have re-created the problem the split was fixing.

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

## Route parameter requiredness is `unknown` for brace-syntax frameworks

A route contract records its path parameters with three-state requiredness
(`packages/domain/src/repository/graph-node.ts`), populated per path notation by
`framework-adapters/src/route-parameters.ts`:

| Notation | Frameworks       | What the notation states       | Recorded                |
| -------- | ---------------- | ------------------------------ | ----------------------- |
| `:id`    | Express, NestJS  | required, and `:id?` optional  | `required` / `optional` |
| `{id}`   | Spring, FastAPI  | dynamic segment only           | `unknown`               |
| `[id]`   | Astro file route | required; `[...rest]` optional | `required` / `optional` |

**Why brace syntax cannot do better.** Optionality lives outside the path: Spring puts it in
`@PathVariable(required = false)`, FastAPI in the handler signature's default value. Neither is read
by a route producer, so `unknown` is the observation. It must stay `unknown` until a producer reads
one of them — a rule that treated it as `required` would be conditioning on a guess.

**Query parameters are always empty, and the emptiness is not an observation.** A route path does not
declare them (`normalizeRoutePath` drops the query string because it is an argument to an endpoint,
not part of its identity). No rule may read an empty `queryParameters` as "accepts none".

## No evaluation sample constrains parameter-level impact

The two fixtures the evaluation harnesses run against contain no parameterized route:

- `ts-basic` (the §41 accuracy samples) has one `api-endpoint`, `symbol:src/api/deals.ts#getDeals`,
  detected by convention with no route contract at all.
- `cross-stack` (the §C16 reach samples) declares `/api/deals` only — static, no path parameters.

Parameterized routes exist only in `express-app`, `nestjs-app`, `fastapi-app` and `java-spring`,
none of which has an evaluation harness. A probe confirmed the consequence directly: a requirement
reading "the deal detail endpoint must accept an optional `include` parameter" produces
`unmatched-requirement` against `cross-stack`, because there is nothing to match.

**Consequence.** Parameter requiredness is persisted, serialized, movement-tracked and unit-tested,
but no ground truth constrains an impact conclusion drawn from it. That is stated rather than papered
over: a sample written against a fixture with no parameterized route could only have recorded engine
behaviour, which is what ground truth exists not to do.

**What is constrained instead.** The verb is observable in both harness fixtures, so the routing
samples pin the capability that genuinely exists — `route path rename` and `route handler behaviour`
in `CROSS_STACK_EVALUATIONS` are a pair over one endpoint. A path-scoped requirement obliges every
verb at that path (`POST /api/deals` is `required`); a verb-scoped one obliges exactly one and leaves
the other `possible`. `requiredTier.mustNotContain` asserts that boundary, and the assertion was
sabotage-verified to fail when the two are conflated.

**What would close the parameter gap.** A parameterized route in a harness fixture — an Astro
`web/src/pages/api/deals/[id].ts` would give `cross-stack` a contract with an observable `required`
parameter. That is fixture work with its own golden movement, and it should be done when a rule
actually reads a parameter, not before: a sample constraining a rule that does not exist would pin
the absence of behaviour.
