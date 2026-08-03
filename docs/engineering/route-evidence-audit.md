# Route evidence audit

What the graph can actually prove about routes, established before any `ROUTES_TO` propagation rule
is written. The question this answers is not "which rule should `ROUTES_TO` use" but whether
`ROUTES_TO` represents a single fact at all.

**It does not.** It fuses three different source facts, and the evidence that distinguishes them is
observed by the producers and then discarded.

## 1. Route node identity

A route is `route:<VERB> <path>` and nothing else:

```
route:GET /api/deals|api-endpoint|application|GET /api/deals|framework-convention
```

| Field                | Available?                                                            |
| -------------------- | --------------------------------------------------------------------- |
| path                 | only inside the id and the display name                               |
| HTTP verb            | only inside the id and the display name                               |
| required path params | **no** — not modelled anywhere                                        |
| query params         | **no** — dropped by `normalizeRoutePath` as "arguments, not identity" |
| handler symbol       | not on the node; a separate `EXPOSES` edge carries it                 |
| declaring file       | not on the route node (`GraphNode.path` is a file path, unused here)  |
| route kind           | only `api-endpoint` type vs a `page:` id prefix                       |

`GraphNode` has no field for any of this — id, category, type, name, path, knowledge — so a route's
verb and path exist **only as a substring of its name**.

The consequence is already visible in the codebase: `cross-stack/route-index.ts#routeNameParts`
recovers verb and path by splitting the name at its first space. That produces a structured
`RouteEntry { path, verb }`, which the matcher uses and then throws away. The design smell is
already present at index time; building propagation on top would repeat it further from the source.

## 2. Producer meaning

| Producer             | Source                              | Target        | Observed fact                                                                                       | Best relationship |
| -------------------- | ----------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| `page-links.ts`      | page/template symbol                | `page:` node  | `<a href>` / `<area href>` path equals a declared page route; `<form action>` deliberately EXCLUDED | `NAVIGATES_TO`    |
| `template-calls.ts`  | enclosing symbol / component / file | `route:` node | `a.href`                                                                                            | `NAVIGATES_TO`    |
| `template-calls.ts`  | same                                | `route:` node | `form.action`, plus `method` when the form states one                                               | `SUBMITS_TO`      |
| `template-calls.ts`  | same                                | `route:` node | a client `fetch` call to a same-origin path                                                         | `CALLS_ENDPOINT`  |
| `express-adapter.ts` | registering file / handler symbol   | `route:` node | route registration                                                                                  | already `EXPOSES` |

So route registration is **already** a distinct relationship and needs no new type. What is fused is
the client side: navigation, submission, and programmatic fetch share one type today.

The producers can make this split **without guessing**. `reference-targets.ts` keeps two explicit
tables — `NAVIGATION_ATTRIBUTES` (`a.href`, `area.href`, `form.action`) versus `ASSET_ATTRIBUTES` —
and `template-calls.ts` gates on `ENDPOINT_ATTRIBUTES = {'a.href', 'form.action'}`, with a separate
receiver for HTTP calls. The distinction is observed, not inferred.

`page-links.ts` says so in its own module comment: "the honest type would be a `NAVIGATES_TO`, which
is a §12 addition and therefore the domain-provenance agent's decision, not this adapter's." The
producer's author already reached this conclusion and deferred it.

## 3. Evidence attached to the edge

Evidence is `kind: 'call-site'` with `source: { kind: 'file', filePath, range, symbolName }`.

| Evidence needed for propagation  | Retained on the edge?                                      |
| -------------------------------- | ---------------------------------------------------------- |
| source location                  | **yes** — file path and range                              |
| matched route identity           | **yes** — it is the edge target                            |
| literal path used by the source  | **no** — lives in the transient `CallFact.stringArguments` |
| attribute name (`href`/`action`) | **no** — lives in `CallFact.calleeName`                    |
| HTTP method stated by the source | **no** — lives in `CallFact.keywordStringArguments.method` |
| dynamic versus static path       | **no** — never computed                                    |
| parameter placeholders           | **no** — never computed                                    |
| match quality / normalization    | **no** — `normalizeRoutePath` leaves no record             |

This is the load-bearing finding. `template-calls.ts` **does** read the form's method and uses it to
filter candidate routes by verb — then keeps none of it. Everything that could condition a
propagation rule is observed at match time and dropped.

`EvidenceDerivation` (§12.2.1) is the right vehicle for the ones worth keeping: it is typed, it lives
on evidence rather than on the graph schema, and it already carries `mechanism` and `reason`. No
producer populates it yet.

## 4. Capability gaps

```
Can detect path rename impact:                  partially
Can detect verb change impact:                  no
Can detect required parameter impact:           no
Can distinguish navigation from submission:     yes at producer time, no in the graph
Can distinguish dynamic from exact paths:       no
```

**Path rename — partially.** The path is the node's identity, so renaming `/deals` to `/offers`
removes one route node and adds another; the edge to it disappears and a new one appears. That is
detectable as graph movement, but the engine cannot state the useful thing — "this `href` literal
must change" — because it does not retain which literal the source used.

**Verb change — no.** The method is observed for forms only, and not persisted. Nothing downstream
can tell a `GET` link from a `POST` form.

**Required parameter — no.** Parameters are not modelled at any level. `/deals/:id` is an opaque
string; `normalizeRoutePath` explicitly performs no placeholder unification.

## Conclusion, against the agreed decision rule

Route identity is a combined display string, so the rule says: **fix route modelling first, and do
not build propagation logic that reparses names.** And the page and template producers observe
different source facts, so the rule says: **split the vocabulary before adding propagation.**

Both apply. The order that follows:

1. **Split the client-side vocabulary** into `NAVIGATES_TO`, `SUBMITS_TO` and `CALLS_ENDPOINT`,
   driven by the attribute and receiver the producers already observe. Behaviour-neutral, measurable
   by the movement report, and it makes the distinction survive into the graph.
2. **Model routes structurally** — verb, path, and path parameters as fields or as related nodes
   rather than as a name substring — so a rule can compare a route contract instead of splitting a
   string. This is the prerequisite for verb and parameter propagation, and it is a larger change
   than the vocabulary split.
3. **Persist the source-side literal** (the path used, the attribute, the stated method) via
   `EvidenceDerivation`, which is what lets a rule say why a specific reference must change.
4. **Only then** write counterexamples and conditional propagation.

Of the five counterexamples proposed for routing, only two are legitimate today: the path rename
(detectable as node churn) and the handler behaviour change (which should stay `possible`). The verb
change, the required-parameter change, and the additive-route case cannot be expressed as
constraints until steps 2 and 3 exist — writing them now would produce fixtures that record
behaviour instead of constraining a rule, which is the failure already seen twice in the
`change-configuration` sample.
