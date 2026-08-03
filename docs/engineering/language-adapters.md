# Language and Framework Adapters

Design reference for `packages/language-adapters` and `packages/framework-adapters` — the only
place language- and framework-specific knowledge may live. Owner: language-adapter agent, with the
`language-adapter-development` skill and `.claude/templates/language-adapter-proposal.md` for new
adapters (new adapters require human approval, CLAUDE.md). Pipeline context:
`repository-analysis.md`. Parser choices: ADR-0008 (Accepted 2026-08-02 at the Python adapter
milestone) and ADR-0014, which resolved the HCL/Astro grammar gap ADR-0008 left open: Astro needs
no grammar, and HCL is parsed with the `@tree-sitter-grammars/tree-sitter-hcl` grammar (installed
and in use since Story 16.1).

## The two interfaces (PRD §30–31)

Verbatim from the PRD — these signatures are the contract the whole engine layer builds on:

```ts
interface LanguageAdapter {
  id: string;
  supportedExtensions: string[];
  detectProject(context: RepositoryContext): Promise<DetectionResult>;
  indexFiles(files: RepositoryFile[], context: IndexingContext): Promise<GraphFragment>;
  analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet>;
}
```

```ts
interface FrameworkAdapter {
  id: string;
  languageIds: string[];
  detect(graph: CodeGraph): Promise<FrameworkDetection>;
  enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment>;
}
```

Language adapters see files and produce facts. Framework adapters see the assembled graph (they
run _after_ language parsing — the detection handoff in `repository-analysis.md`) and enrich it
with convention-derived facts (provenance `framework-convention`). `analyzeDiff` is what the
Review Engine uses for symbol-level diff interpretation (`implementation-review.md`).

### `analyzeDiff` semantics

One shared implementation (`src/diff/analyze-diff.ts`) serves every adapter; it re-uses the
adapter's own `indexFiles` — there is never a second parser — and never executes repository code.

- `AnalysisContext.files` carries the **new** content of surviving changed files;
  `AnalysisContext.previousFiles` carries the same files' content at the review baseline, keyed
  by their **baseline** path. Without baseline content the file is reported as not comparable at
  symbol level; nothing is guessed.
- Symbols are fingerprinted from the declaration text the parser already pointed at (the
  `symbol-declaration` evidence range), so added / removed / changed symbols and added / removed
  imports are reported per file.
- A **rename is one change** (`changeType: 'renamed'` + `previousPath`), never a delete plus an
  add. Symbols are matched by type + name so a pure move reports no symbol changes; the node-id
  delta still records the move.
- A **deleted** file loses its fragment wholesale (`removedFilePaths`).
- Binary content, extensions outside `supportedExtensions`, and missing baseline content set
  `symbolLevel: false` with an `unverifiableReason` — the Review Engine's Unverifiable category
  (PRD §24), never a guess. Such files still contribute their file-level fact.
- Application order for a `GraphChangeSet`: drop facts for `invalidatedFilePaths`, drop
  `removedNodeIds`/`removedEdgeIds`, then apply `fragment`.

## Registration and discovery

- Built-in adapters are statically registered at composition time — no runtime plugin loading in
  V1 (no code execution from the analyzed repository, ever — PRD §35). The production roster lives
  in `packages/workspace-engine/src/indexing.ts`: `createAdapterRegistry([...])` for language
  adapters and `buildFrameworkAdapters(...)` for framework adapters. An adapter that is written but
  not listed there is invisible to the real pipeline, so **the fixture goldens in
  `packages/repository-intelligence/src/graph-goldens.test.ts` deliberately mirror that roster** —
  a golden run that does not exercise the shipped roster proves nothing about the shipped product.
- Import resolution is per-language too. `packages/repository-intelligence/src/assembly/`
  `module-resolvers.ts` dispatches on the extension of the file the import was written **in**:
  `.py` → `createPythonModuleResolver`, `.java` → `createJavaModuleResolver`, everything else
  (including `.astro`, whose frontmatter uses TypeScript import syntax) → `createTsModuleResolver`.
  Import syntax is a property of the importing language; resolving one language's specifiers with
  another's rules would either miss real edges or invent wrong ones. `.tf` has **no** entry by
  design: Terraform's only cross-file reference (`module { source = "./x" }`) names a _directory_,
  which a `ModuleResolver` cannot express, so the Terraform framework adapter resolves it instead.
- **Framework-adapter order is a contract, not an accident.** `enrichWithFrameworks` rebuilds the
  `CodeGraph` view before each adapter, so an adapter sees everything its predecessors added.
  `cross-stack` therefore runs last: the routes and topics it correlates are produced by the
  adapters above it. Language facts still win every id collision.
- Registration is data: `{ adapter, builtIn: true, version }`. Which adapters activate for a
  workspace is decided by `detectProject`/`detect` results merged with `.impactgraph/config.yml`
  (languages list, PRD §17) under the §Z5 precedence rules (human-confirmed config wins).
- Availability is validated during configuration validation (§Z13: "language-adapter
  availability", "framework-adapter availability") and reported in index status.

## The language-neutral graph contract (PRD §C14)

> "Language adapters are responsible only for producing repository facts. After graph
> construction, the Clarification Engine, Impact Engine, Review Engine, and Agent Integration
> Engine must be completely language independent."

Rules that make that hold:

- Adapters emit **only** node/edge types from the shared vocabulary (PRD §12.1–12.2:
  `IMPORTS`, `CALLS`, `PUBLISHES`, `SUBSCRIBES_TO`, `DEPLOYED_AS`, …) with evidence and
  deterministic IDs. No adapter-private node types reach the graph; if a language needs a new
  concept, that is a domain-model change (domain-provenance agent) first.
- Nothing downstream of graph assembly may branch on language ID for reasoning. Engines may
  _display_ language as metadata; they may never _interpret_ it.
- Adapters never assign provenance other than `static-analysis`, `configuration`, or
  `framework-convention` — never `llm-inferred` or `human-confirmed` (`provenance-model.md`).
- Cross-stack edges (Astro→FastAPI route calls, Terraform→Cloud Run, Spring→Pub/Sub — PRD §C13)
  emerge from assembly + framework enrichment matching neutral facts (URLs, topic names, resource
  identifiers), not from adapters knowing about each other. See "Cross-stack correspondence" below
  for the provenance rule they must obey.

## Parser strategy (ADR-0008 — Accepted)

- TypeScript/JavaScript: TypeScript compiler API (one shared adapter, PRD §30).
- Python, Java, HTML, JSON: tree-sitter grammars compiled to WASM (`web-tree-sitter@^0.25.10` +
  `tree-sitter-wasms@0.1.13`), loaded inside the indexing worker. The `json` grammar exists for
  Terraform's JSON syntax (`.tf.json`) and is used by no other adapter — see below.
- HCL/Terraform: the **`terraform` dialect** grammar from
  `@tree-sitter-grammars/tree-sitter-hcl@1.2.0`, loaded through the same foundation (ADR-0014).
  The package ships both `tree-sitter-hcl.wasm` and `tree-sitter-terraform.wasm`; the Terraform one
  is used deliberately, because it carries `resource`/`module`/`provider` semantics — the surface
  PRD §15.2 names. Grammars therefore span two npm packages, which is why `GrammarSource` maps a
  grammar **id** to a package specifier rather than assuming one bundle
  (`src/tree-sitter/grammars.ts`).
- Astro: **no grammar, and none needed** (ADR-0014). An `.astro` file is TypeScript frontmatter
  delimited by `---` followed by an HTML-like template, so the adapter splits the file and hands
  each half to a parser ADR-0008 already sanctions — the TS compiler API and the `html` grammar.
- Fallback adapter: filesystem/text-level evidence for everything else
  (`repository-analysis.md`).
- HTML focuses on relationships — templates, components, scripts, forms, routes, assets — not on
  treating HTML as an application architecture language (PRD §30).

### The tree-sitter loader (`src/tree-sitter/`)

`sharedTreeSitterParsers()` hands every built-in adapter one process-wide pool.

- **Lazy.** Importing the module compiles nothing. `Parser.init()` and each `Language.load()` run
  on the first `withSyntaxTree(...)` call. Adapters are constructed eagerly at composition time,
  so anything eager here would be spent out of the 500 ms activation budget (PRD §33).
- **Cached.** One `Parser` (with its `Language`) per grammar per process.
- **Scoped.** `withSyntaxTree(grammarId, content, visit)` deletes the tree after `visit` returns,
  so no caller can leak WASM memory. Extract plain data inside the visitor; syntax nodes never
  reach a `GraphFragment` (PRD §C14).
- **Never throws.** A missing grammar, an unreadable `.wasm`, or a parser failure comes back as a
  warning string the adapter records against the file (PRD §32, §34). `ERROR`/`MISSING` recovery
  nodes are tolerated and reported (capped at three per file), not treated as failure.
- **Grammar bytes are injectable.** `nodeGrammarSource` resolves `tree-sitter-wasms/out/*.wasm` by
  package specifier (not by a path relative to the source file), so it works from source, from a
  compiled `dist/`, and under pnpm's symlinks. A bundled host that cannot rely on `node_modules`
  being present passes its own `GrammarSource` to `createTreeSitterParsers` — see the packaging
  note in ADR-0008's consequences.
- **Runtime pin.** `web-tree-sitter` is pinned to `^0.25.10` because `tree-sitter-wasms@0.1.13`'s
  grammars use the legacy emscripten `dylink` section that `0.26.x` dropped. Do not bump it
  without re-running `src/tree-sitter/parsers.test.ts`, which loads every claimed grammar.

## Terraform (PRD §15.2, Story 16.1)

Split across two adapters, for a structural reason worth stating: `indexRepository` parses **one
file at a time** so every result is cacheable by content hash (PRD §32), while Terraform's identity
is per _directory_ — a directory IS a module, `var.region` is declared in `variables.tf` and used
in `main.tf`, and a `module` block names blocks in another directory entirely.

- **`packages/language-adapters/src/terraform`** — file-local facts only: one `infrastructure` node
  per addressable block, the `file → CONTAINS → block` edge, secret bindings, and warnings. Its
  cross-file references leave on the `CallFact` channel (`receiverName: 'terraform:reference'` /
  `'terraform:module-source'`), the same neutral bus the Astro adapter uses for template
  references.
- **`packages/framework-adapters/src/terraform`** — reads the assembled graph and turns those facts
  into `DEPENDS_ON` / `SUBSCRIBES_TO` / `CONTAINS` edges. It re-parses nothing.

Identity and naming:

- Node id is the Terraform address, scoped by directory: `terraform:google_pubsub_topic.deal_events`
  at the root, `terraform:modules/dead-letter/google_pubsub_topic.dead_letter` inside a module.
  Variables use the `var.` prefix references actually use, so resolution is a lookup, not a
  translation.
- Node **name** is the declared `name` literal when the configuration states one (`deals-api`,
  `deal-events` — what the resource is called in GCP), falling back to the address when it
  interpolates. That fallback is the signal to the cross-stack adapter that the name is unknown.
- Node **type** is read directly from the resource type string: `google_pubsub_topic` →
  `pubsub-topic`, `google_cloud_run_v2_job` → `cloud-run-job`, `*_iam_member|binding|policy` →
  `iam-role`, everything else → `terraform-resource`. `variable`, `output`, `provider` and `data`
  blocks are also `terraform-resource`: PRD §12.1 has nothing more specific, and stretching
  `environment-variable` or `gcp-project` to fit would claim something the configuration does not
  say. Adding §12 types is domain-provenance's call, not an adapter's.
- Provenance is `configuration`, not `static-analysis`: a `.tf` file describes infrastructure some
  other tool will apply, which is a different kind of knowledge from what parsed code does.

**Never evaluated (PRD §35).** No `terraform` CLI, no provider download, no expression evaluation.
An interpolated attribute (`"gcr.io/${var.project_id}/deals-api:latest"`) has no value the adapter
is allowed to know: it is reported as a warning naming the attribute and line, never stitched
together from its literal halves. References _inside_ an interpolation are still read — the value
is unknowable, but `${var.project_id}` demonstrably refers to `var.project_id`. Module sources are
resolved by path arithmetic that cannot climb above the repository root.

#### `count` and `for_each` — multiplicity without evaluation

`count = 3` genuinely creates three objects, and Terraform addresses them `<address>[0..2]`. Three
nodes is therefore the truthful model and one node would be a quiet lie, so a **literal** integer
count is expanded into that many nodes. Reading digits an author typed is parsing, not evaluation.

Everything else degrades to one node plus a warning, because the alternative is a guess:

| Declaration                    | Result                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| `count = 3`                    | three nodes, `…shard[0]`, `…shard[1]`, `…shard[2]`         |
| `count = 0`                    | **no node**, plus a warning — the block declares no object |
| `count = var.enabled ? 1 : 0`  | one node at the bare address, plus a warning               |
| `count = 99` (over the cap 10) | one node at the bare address, plus a warning naming 99     |
| `for_each = …`                 | one node at the bare address, plus a warning               |

The expansion cap exists so a literal `count = 500` cannot drown the 200-node default graph view
(PRD §33); the real number is in the warning, so nothing is lost that a reader cannot recover.

References to an expanded set resolve to **every** instance: `google_pubsub_topic.shard[*].name`
names the set, and the framework adapter links the referring block to each indexed instance. Which
instance a `[count.index]` subscript selects is not resolvable without evaluation, so a subscripted
reference also fans out — it points at the set it demonstrably names, never at a guessed index.

#### Data sources, `.tfvars`, and `.tf.json`

- **`data.<type>.<name>` references resolve.** A `data` block IS declared in the configuration and
  IS indexed as a node, so a resource reading one gets a real `DEPENDS_ON` edge. (`local`, `each`,
  `count`, `self`, `path` and `terraform` remain skipped: they are language built-ins that name
  nothing this repository declares.)
- **`.tfvars` files produce `CONFIGURES` edges.** `project_id = "impact-graph"` configures the
  `variable "project_id"` block **in the same directory** — the only binding the repository states
  rather than implies, since `-var-file=…` can point anywhere from a command line the adapter never
  sees. The assigned **value is never read**: a `.tfvars` entry is frequently a secret, and nothing
  downstream needs it to know which variable is configured. An assignment naming no declared
  variable is a warning (it is a real configuration defect), never an invented node.
- **`.tf.json` and `.tfvars.json` are claimed** (epic-16). Terraform's JSON syntax is the same
  language written differently, and HashiCorp specifies the mapping exactly: a top-level key is a
  block type, the objects nested under it supply that block type's labels, and the innermost object
  is the block body. `terraform-json.ts` performs that mapping and produces the SAME
  `TerraformDocument` the HCL reader produces, so `emitTerraformFile`, addresses, node types,
  `count` expansion, secret bindings and the framework adapter's `CONFIGURES`/`DEPLOYED_AS` edges
  all work unchanged. The `terraform-gcp` fixture contains a JSON module beside the HCL ones and
  their secret bindings land on the same `terraform:secret:db-password` node.
  - **Positions.** The earlier decline was right about `JSON.parse` — it reports no line or column,
    and evidence that cannot point at a line is a materially worse fact than none. The answer was
    not a new dependency: `tree-sitter-wasms` already ships a prebuilt `tree-sitter-json.wasm`, so
    the document goes through the same loader as Python, Java and HTML and ADR-0008 stands
    unamended. `json-document.ts` turns that CST into positioned values.
  - **Reference columns.** A JSON expression lives inside a string (`"${google_pubsub_topic.x.name}"`),
    so `terraform-interpolations.ts` lexes the interpolation body for dotted chains and hands the
    segments to the same `addressFromSegments` the HCL path uses — one rule, two syntaxes. The
    range recorded is the column of the address itself, anchored on the CST's `string_content`
    node. A literal carrying escape sequences widens to the whole literal, because the decoded
    value is shorter than its source and offsets stop mapping; that is a wider real range, never a
    fabricated one.
  - **Error recovery is refused, not read through.** In JSON the nesting IS the block structure, so
    a missing brace does not corrupt one block — it silently re-parents every block after it. A
    document tree-sitter recovered from is therefore indexed at file level with a warning naming
    the line, which is stricter than the HCL path on purpose.

## Cross-stack correspondence (PRD §C13, Story 16.6)

`packages/framework-adapters/src/cross-stack/` is the only component allowed to relate facts that
came from different stacks. It correlates; it never parses. Three rules make its output auditable:

1. **Provenance is `framework-convention`, never `static-analysis`.** Nothing in an Astro template
   says which handler serves `/api/deals`, and nothing in a `.tf` file names the package it
   deploys. That a shared URL path means a shared endpoint, and that a Cloud Run service is named
   after the app it runs, are _conventions of the platform_ — which is exactly the deterministic
   category `framework-convention` exists for. Labelling these `static-analysis` would claim they
   were read out of the source, and is a boundary violation.
2. **Correspondence must be exact.** Normalization is limited to dropping a query string, a
   fragment and a trailing slash. No case folding, no prefix matching, no similarity scoring, no
   unification of `/deals/1` with `/deals/{id}`. `/api/deal` does not match `/api/deals`. A missed
   edge is cheaper than a fabricated one, and the negative cases are pinned by tests.
3. **Evidence comes from both sides.** Every cross-stack edge cites the template attribute (or the
   Terraform declaration) _and_ the declaration of the thing it corresponds to, so a reviewer can
   open both files and check the claim rather than trusting it.

A correspondence is only attempted where a value was literally declared. A Terraform resource whose
`name` interpolates has no name the adapter is allowed to know — the language adapter falls back to
the resource address and warns, and the cross-stack adapter skips it entirely.

URL references reach the adapter on one channel from three sources: template attributes
(`astro:template` and `html:template`, on `a.href`/`form.action`), TypeScript HTTP clients
(`http:client`), and Python app-bound HTTP clients (`http:client` again — the marker is shared so
the correlation cannot tell which language produced the fact). Every marker is a receiver name that
cannot be an identifier in any of those languages, so no call-convention adapter can match one by
accident, and all are held to the same exactness rules. When the fact carries an
`enclosingSymbolNodeId` the graph knows, the edge starts there rather than at the file; an id the
graph does not know is discarded rather than turned into a dangling edge.

**Page navigation** (`page-links.ts`, epic-16). An `<a href>`/`<area href>` whose normalized path
equals a declared `page:` node's route becomes a `USES` edge with `framework-convention` provenance
and evidence from both sides. The earlier reasoning for leaving this out — "intra-app navigation,
not a call across a stack boundary" — measured stack boundaries, when what makes a relationship
architectural is whether the repository states it and whether changing one end affects the other; a
page link states both, and "what points at this page?" is a question impact analysis exists to
answer. `<form action>` is excluded (a form submits to a handler, which the `api-endpoint` matching
already covers) and a page never links to itself. **The edge type is a compromise worth naming:**
PRD §12.2 has no navigation edge, so `USES` is used — the same type the endpoint correlation
directly above emits for the same class of fact. A dedicated `NAVIGATES_TO` would be the honest
ideal and is a §12 addition, i.e. the domain-provenance agent's decision, not this adapter's.

All three application languages now produce Pub/Sub client facts, so a Java publisher correlates
with a Terraform topic through exactly the same path a TypeScript or Python one does — **no
cross-stack adapter change was needed for Java**, which is the design working rather than a lucky
break: the adapter matches on node type and declared name and has no way to learn which language
produced a node. The adapter still warns when Terraform declares Pub/Sub resources and nothing on
the code side does, and the warning names the client shapes that _are_ covered so "detected
nothing" cannot be misread as "not built".

**Cloud Run environment variables** (`cloud-run-env.ts`, epic-16) are the fourth correspondence,
and the only one that produces an integration node rather than only an edge — see "a name the
repository states NOWHERE" below for the four conditions it requires and everything it refuses. It
reuses `linkInfrastructure`'s declared-name correspondence to tie a service to its code rather than
inventing a second matching rule, and it emits the `DEPLOYED_AS` edge for a topic node it created
itself, since `infrastructure-links.ts` only correlates nodes the graph already had.

What is deliberately **not** correlated, and why (PRD §34 — partial support is reported, not
absorbed): Cloud Run container images are not mined for application names (almost always
interpolated, and reading an app name out of a registry path is guesswork). FastAPI → PostgreSQL
awaits database nodes. A URL reference that states no verb still matches every verb declared at
that path — `fetch(url)` and `axios(url)` without a literal `method`, and `<form action>` without a
`method`, all share that documented limitation, because applying HTML's GET default is the
correlating adapter inventing a fact the document did not state.

### HTTP-client URL facts

Which callee counts as an HTTP client is decided **from the file's imports**, never from a type
checker (`typescript/http-clients.ts`, `python/python-http-bindings.ts`). `import axios from
'axios'` states that the name `axios` is the axios module; that is a fact the file contains, and it
is the same evidence the Pub/Sub detectors and the Java adapter's `importedTypes` already use.

| Language   | Recorded                                                                                                                                                                                            | Not recorded, and why                                                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `fetch(url[, {method}])`; `axios.<verb>(url)`; an `axios.create()` instance's `<verb>(url)`; `axios(url[, {method}])`; `$fetch`/`ofetch` imported from `ofetch`; the CJS `require` spelling of each | a **wrapped client** (`apiClient.get(…)` over a local module) — the import proves where the name came from, not that the module behind it speaks HTTP; Nuxt's auto-imported global `$fetch`, which has no import to prove anything; `axios.request(config)`, whose URL is a property of an object literal |
| Python     | a **literal root-relative** path through a client this module handed an ASGI app: `TestClient(app)`, `httpx.AsyncClient(app=app)`, `httpx.AsyncClient(transport=ASGITransport(app=app))`            | anything through a client with a stated `base_url`, or `requests` — see below                                                                                                                                                                                                                             |

The Python asymmetry is deliberate and is the honest reading of the two languages. A root-relative
`fetch` URL in a browser bundle is **same-origin by definition**, so a matching route in this
repository is the route it hits. Python has no ambient origin: `client.get('/api/deals')` resolves
against a `base_url`, and a service's `base_url` normally names another service. Recording every
root-relative Python path would link `/api/deals` on some external origin to this repository's own
`/api/deals` whenever the two happen to share a path — a confident, plausible, wrong edge. When the
application object is handed to the client in the source, the origin is not merely unstated: it is
stated, and it is this repository. The `fastapi-app` fixture pins both directions — its
`tests/test_deals.py` produces a `USES` edge to `route:GET /deals`, and its `app/clients.py` calls
`registry.get("/deals")` through a `base_url`'d client against a path the app itself serves and
produces **nothing**, so widening the rule would show up in the golden as a wrong edge.

### Pub/Sub client detection (PRD §15.2, Story 16.3)

Detected by the **language** adapters, not by a framework adapter:
`typescript/parse-pubsub.ts` for `@google-cloud/pubsub`, `python/python-pubsub.ts` for
`google.cloud.pubsub_v1`, and `java/java-pubsub.ts` + `java/java-pubsub-channels.ts` for Spring
Cloud GCP and the native `com.google.cloud.pubsub.v1` client. The reason is the `CallFact` contract:
it carries module-level,
single-receiver calls, and Pub/Sub usage is chained member calls inside function bodies
(`pubsub.topic('x').publishMessage(…)`). Widening that channel would change what Express, the Astro
collection detector and every §Z8 rule sees, whereas deriving the facts inside the parse already
happening changes nothing for anyone else. Should the contract ever grow a chained-call shape, this
moves to `framework-adapters/src/pubsub/`.

All three emit the same neutral vocabulary — `topic:<name>` and `subscription:<name>` nodes in the
`integration` category, `PUBLISHES` and `SUBSCRIBES_TO` edges from the declaration containing the
call — so a TypeScript publisher, a Python consumer and a Java publisher of the same topic resolve
to **one** node, and the cross-stack adapter cannot tell which language produced it. The
`cross-stack` fixture pins exactly that: adding the Java publisher added Java edges and **no new
topic or subscription node**.

Provenance is `framework-convention` on every node and edge. The string literal is parsed, but "a
string handed to `.topic()` names a Pub/Sub topic" is knowledge about a library, not something the
source states. Evidence is the parsed call site.

All three are gated on an import of the real client library, so a local `./pubsub` helper exporting
a `PubSub` class never matches. **The TypeScript gate reads CommonJS as well as ESM** (epic-16,
`typescript/pubsub-bindings.ts`): `const { PubSub } = require('@google-cloud/pubsub')` binds exactly
what `import { PubSub }` binds, `const { PubSub: Client } = require(…)` binds the local name, and
`const pubsub = require(…)` / `import * as pubsub` bind a **namespace** — answering
`new pubsub.PubSub()`, not `new pubsub()`, because `require(m)` evaluates to the module's exports
object rather than to a callable. A `require` at any depth counts; a computed specifier states no
module and binds nothing. Only the binding step differs between the two module systems — the
detector below it is shared and untouched.

Java checks the gate **per type name**: `PubSubTemplate` counts only
when this file imported it from `com.google.cloud.spring.pubsub.*`,
`org.springframework.cloud.gcp.pubsub.*`, `com.google.cloud.pubsub.v1.*` or `com.google.pubsub.v1.*`,
so a same-named class next door is inert.

Java shapes detected: `PubSubTemplate.publish/subscribe/pull*` through a receiver whose declared
type is one declaration away (the same bound `java-calls.ts` draws);
`new PubSubInboundChannelAdapter(template, "sub")` and `new PubSubMessageHandler(template, "topic")`;
and `Publisher.newBuilder(TopicName.of(p, t))` / `Subscriber.newBuilder(ProjectSubscriptionName.of(p, s), …)`,
including through a local variable or a FIELD bound to the `*Name.of(…)` call. **Field initialisers
are read** (`private final Publisher p = Publisher.newBuilder(…).build();`), and their facts hang
off the field's own symbol node — the declaration that contains the call. A template reached
through a **getter** resolves when, and only when, the getter body is `return this.<field>;` or
`return <field>;` in the same compilation unit; a computed return, a getter with parameters, an
interface method with no body, and a getter inherited from a superclass all resolve to nothing.
`Publisher.newBuilder("projects/p/topics/t")` — the **resource-path string form** — is parsed
against the published grammar `projects/<project>/(topics|subscriptions)/<name>`, and the LAST
segment becomes the name, so it lands on the same `topic:<name>` node as `TopicName.of(p, t)`, the
Terraform resource and every other detector. The project segment is dropped deliberately: no other
detector carries one, and a node id that sometimes has a project prefix would split the very node
this is meant to share. A string that does not match the grammar (a bare `"deal-events"`, an extra
segment, an unknown collection) resolves to nothing and warns.

TypeScript reads a topic name held in a **module constant** (`typescript/pubsub-constants.ts`):
`const TOPIC = 'deal-events'; pubsub.topic(TOPIC)` states the value on the line above the call, so
propagating it reports what the file says. Only single-assignment `const` bindings with a
string-literal (or hole-free template) initialiser qualify; a `let`, a reassigned name, a template
with a hole, a destructuring, an import, or a function parameter of the same name all resolve to
nothing.

Python reads a client or path held on **`self`** (`python/python-pubsub-attributes.ts`), whether
assigned in `__init__`, in another method (Python has no `private` and no declaration site), or as
a class-level attribute — plus the class-method factories
`PublisherClient.from_service_account_file/json/info(…)`.

**The ambiguity rule, per language.** Field/attribute handles always live in a map SEPARATE from
locals — a local `x` and a field `this.x`/`self.x` are different bindings and neither may shadow
the other. In TypeScript and Python that map is file-scoped while the bindings are class-scoped, so
when two classes in one file declare the same name with different handles the entry collapses to an
`AMBIGUOUS` sentinel and resolves to **nothing**; the adapter does not guess which class a `this.`
or `self.` reference meant. Java needs no sentinel because it states the boundary outright: the
declarations pass already walks one `class_body` at a time, so the scope is built per class and
handed only to that class's members — two classes can never share an entry to disagree about, and
each resolves its own fields correctly. Same rule, enforced by construction instead of by a
collapse.

`@ServiceActivator(inputChannel = "…")` gets its own file-level pass, because a channel is **not** a
subscription — it is a pipe anything may feed, so the annotation alone proves nothing about Pub/Sub.
The handler is linked only when one compilation unit states the whole chain: an inbound adapter
naming the subscription, a `setOutputChannel(…)` naming the channel (a `@Bean` method call, or a
parameter carrying an explicit `@Qualifier`), and the annotation consuming that channel. Spring's
by-parameter-name bean fallback is **not** used — it depends on the whole application context, and
guessing it would attach a handler to the wrong subscription. A channel that cannot be bound is a
warning naming the channel; the subscription node still exists, from the adapter construction, so
cross-stack correlation is unaffected.

**The refusal that remains, and it is permanent (PRD §35): a name the repository states NOWHERE.**
A function parameter (`publish(topicName, …)` where the caller decides), a runtime-computed string
(`f"deal-{env}"`, a template literal with a hole, a concatenation), a value read from a service at
startup. No file in the repository contains the value, so there is no name any adapter may know,
and none of them record anything. A node emitted for one would be an invented fact that then
correlates against a real Terraform resource and looks entirely convincing.

**Two shapes that used to sit in that list do NOT belong there, and are now resolved.** Both were
declined for the wrong reason: the value is not in the _calling file_, but it IS in the repository,
in a committed file that states it outright. The test has always been "does the repository state
the value?", never "does this file state it?" — and never "does it look like a topic?".

_`@Value("${deals.topic}")` → the module's Spring configuration._ The annotation states a KEY; the
value is in `src/main/resources/application.yml` of the same Maven/Gradle module. The Java adapter
records the identifier on the `pubsub:config-name` channel (never a topic name, never a node);
`spring-config` (a language adapter, because only a language adapter is handed file content) reads
the property source; and `framework-adapters/spring/spring-value-topics.ts` joins the two, because
joining two files is a framework adapter's job (PRD §31). Scope is per module — a second module's
configuration is a different application. `${key:default}` is honoured, since the default is stated
in the annotation itself. It resolves to **nothing**, with a warning, when: no configuration states
the key and there is no default; the configured value is itself a placeholder (nothing is expanded
twice, so a `${}` chain terminates immediately); two property sources of the module state the key
DIFFERENTLY (a profile override — which one runs is not stated, and this adapter does not choose;
agreement collapses to the one value and does resolve); the annotation argument is a composite
(`"topics-${env}"`); or the resolved value is not a bare resource name (whitespace, or a
`projects/p/topics/t` resource path). Evidence cites **both** sites, the annotation and the
configuration line — one site only in the default case, where one site is all there is.

_`process.env.TOPIC` / `os.environ["TOPIC"]` → the Terraform Cloud Run env binding._ The code
states an ENVIRONMENT VARIABLE NAME. That is a fact, and it is not a topic name. The TypeScript and
Python adapters record it on the `pubsub:env-name` channel; the Terraform adapter records
`env { name = "X" value = <resource reference> }` on `terraform:cloud-run-env`; and
`cross-stack/cloud-run-env.ts` joins them, because the join spans two stacks. Four conditions, all
required: the variable name is **literally equal** on both sides (no folding, no prefixes); the
Terraform `value` REFERENCES a `google_pubsub_topic`/`google_pubsub_subscription` whose own `name`
is a literal (a `value = "deal-events"` string is not a resource and binds nothing, however much it
looks like one); the Cloud Run service is tied to the code by the **existing** declared-name
correspondence in `infrastructure-links.ts`, reused rather than re-derived, and the reading file is
one that code node contains; and the two sides agree on kind. Anything else resolves to nothing.
Evidence cites both sides; provenance is `framework-convention`, because "Cloud Run env becomes
`process.env`" is a platform convention, not a parsed fact.

Both env readers stay narrow for the usual reason — two candidate values is not a value.
`process.env.X ?? 'fallback'` and `os.getenv("X", "default")` state two possibilities and are
refused; a destructured `const { X } = process.env` or an aliased `const env = process.env`
introduces a binding whose reads would have to be tracked, and is refused; type-level wrappers
(`process.env.X!`, `as string`, parentheses) erase at compile time and are unwrapped. Python's
reader is gated on a module-level `import os`, because `os` is a name a module must bind.

Relatedly, Python reads the topic name from the _second positional_ argument of
`topic_path(project, topic)` and Java from the second argument of `TopicName.of(project, topic)`,
never "the last string literal" — `topic_path("deals", os.environ["TOPIC"])` states a project and an
unknown topic, and publishing the project name as a topic would correlate against a real Terraform
resource and look convincing.

### Renamed imports (epic-16 line 140)

`ImportReference.importedNames` carries the **local** binding, because that is the name the rest of
the file uses and what every framework adapter matches against. A module's export table, though, is
keyed by the name it **exports**. For `import { DealRepository as Repo }` and
`from app.models import Deal as DealModel` those differ, and assembly used to look the local name up
in the target's exports, find nothing, and silently drop the `EXTENDS` / `CALLS` / `USES` edge.

`ImportReference.aliases` closes that: one `{ local, exported }` entry per **renamed** binding, and
nothing at all for the ordinary case. It is a list rather than a `Record` deliberately — every key
comes from untrusted repository text, and an object literal answers `constructor` from its prototype
(PRD §42.5). `assembly/assemble.ts` translates local → exported before consulting the export table,
on both the direct-import path and each re-export hop (`export { inner as outer } from './m'`).

Emitted by the TypeScript adapter (named import and named re-export specifiers) and the Python
adapter (`import_from_statement` only). Two non-cases, both deliberate: a **default** import
(`import Foo from './m'`) is not an alias of `default`, because the export table records default
exports under their declared name and rewriting would break resolution that works today; and
`import os.path as osp` renames a **module**, not a symbol, so there is no exported name to record.
Java has no import renaming and never populates the field.

Because this fix makes previously-lost edges resolve, it is pinned two ways: unit cases in
`repository-intelligence/src/assembly/import-aliases.test.ts`, and fixture coverage where an
existing plain import was **converted** to a renamed one (`ts-basic/src/api/deals.ts`,
`fastapi-app/app/routers/deals.py`) so the graph golden must stay byte-identical — renaming a
binding is not allowed to change the graph. It also retired the FastAPI `include_router` workaround,
which fell back to the import specifier and took the first router declared in that module regardless
of which name was imported.

## Custom detection rules (PRD §Z8)

Users/agents extend detection for proprietary stacks (internal Pub/Sub wrappers, custom
decorators, company DB abstractions) via declarative rules in `.impactgraph/` validated against
`contracts/config`:

- **Versioned** — rules carry a schema version like every contract (`data-contracts.md`).
- **Validated** — schema + semantic validation (§Z13: unsupported syntax, excessively broad match
  patterns rejected) before a rule ever runs.
- **Explainable** — every fact a rule produces cites the rule ID in its evidence, so
  `impactgraph.explain_node` can say "produced by custom rule `internal-pubsub-consumer`".
- **Testable** — rules can be run against fixture repositories; the proposal template requires a
  fixture demonstrating each rule.
- **Removable** — deleting a rule removes its facts on the next index; nothing else refers to
  rule output by side effect.
- **Distinguished from built-ins** — rule-produced facts are flagged `custom` in the graph, index
  status, and evidence panel; they never masquerade as built-in adapter output.
- Rules are _declarative matchers_ (imports, decorators, path patterns → produced node/edge), not
  code. No user-supplied code execution.

## Fixture and golden-test obligations

Every adapter (and every custom-rule feature) ships with (PRD §42.2–42.3; main skill §6):

- At least one fixture repository in `packages/test-kit/fixtures/<fixture-repo-name>` exercising
  its detections (roster includes `express-basic`, `nestjs-app`, `fastapi-service`, `java-app`,
  `astro-site`, `terraform-gcp`, `cross-stack`, `cloud-run-service`, `pubsub-pair`,
  `monorepo-multistack`, `migrations-workflow`). `cross-stack` is the §C12 polyglot slice — Astro
  templates, a FastAPI service, a NestJS consumer and Terraform in one repository — and exists so
  the §C13 correspondences are proven end to end rather than only in unit tests.
- Golden tests (vitest `analyzers` project, `pnpm test:analyzers`) pinning expected nodes/edges
  per fixture, expected impact results for sample specifications, and expected `GraphChangeSet`s
  for sample diffs. Golden files are updated deliberately with a reviewed diff — never
  regenerated blindly.
- Never use the ImpactGraph repository itself as the primary fixture.

### The shared adapter contract suite (PRD §42.1)

`@impactgraph/test-kit` exports `runLanguageAdapterContractChecks(adapter, options)` plus the
documented roster `LANGUAGE_ADAPTER_CONTRACT_CHECKS`. It asserts the §30 invariants every
language adapter must satisfy: an explainable `DetectionResult` for a matching fixture and a
non-throwing one for a non-matching fixture; only PRD §12.1/§12.2 vocabulary emitted; a
deterministic provenance + at least one resolvable evidence id + the context snapshot on every
fact; byte-identical output when the same files are indexed twice; hostile content (the
`malicious` fixture) producing facts or warnings but never aborting the run; and nothing beyond
file-level facts for extensions outside `supportedExtensions`.

The Python, Java, Astro and Terraform adapters all pass the suite with an **empty skip list**,
where the TS and Prisma adapters skip `unparseable-content-is-recorded-as-a-warning` because their
parsers have no input they fail on. For Python, Java and Terraform that is tree-sitter's error
recovery genuinely reporting broken content; for Astro the failing input is not a syntax error at
all but a malformed `---` split, which the adapter refuses to guess past and reports instead.

It ships as **pure assertion functions, not a `describe`/`it` block**, for two reasons: test-kit
declares no test-framework dependency, and it is a dev dependency _of_ the adapter packages, so
importing `@impactgraph/language-adapters` back would create a package cycle. Adapter shapes are
mirrored structurally in `adapter-contract-types.ts`. Each adapter's own test file
(`packages/language-adapters/src/adapter-contract.test.ts`) iterates the roster and asserts every
check reported zero failures; checks that legitimately do not apply come back as `skipped` with a
reason, and the test pins the expected skip list so a skip is never silent.

### The Python adapter and FastAPI enrichment (Story 16.2)

- `createPythonAdapter()` claims `.py` only, and refuses to parse anything else even when handed
  it directly — guessing at non-Python content with a Python grammar would manufacture facts.
- It emits: `file`/`test` nodes, module-level `function` and `class` nodes, `method` nodes inside
  classes, a `symbol` node per public module-level binding, `CONTAINS` edges, `ImportReference`s
  (with the **local** binding in `importedNames`, matching the TS adapter's convention for
  aliased imports, plus an `aliases` entry per renamed binding — see "Renamed imports" below),
  `extends` symbol references for plain base classes, `calls` symbol references
  for bare `foo()`/`Foo()` calls, and `CallFact`s for receiver-qualified `a.b(...)` calls —
  including calls inside function bodies, which carry `enclosingSymbolNodeId`. Visibility follows
  Python's only convention: a leading underscore is private.
- `createPythonModuleResolver(filePaths, sourceRoots)` resolves absolute, package (`__init__.py`),
  source-root and relative (`.`, `..`) specifiers against the scanned file set. Anything outside
  that set (standard library, site-packages) resolves to `undefined`. Because resolution can only
  ever return a member of the scanned set, no amount of `..` can name a path outside the
  repository.
- `createFastApiAdapter()` derives, from those facts alone: `FastAPI()` apps (`application`) and
  `APIRouter()` routers (`module`); `include_router` mounting as `CONTAINS`, with URL prefixes
  composed through nesting; `@app.get`/`@router.post` decorators as `api-endpoint` nodes with
  `EXPOSES` edges from both the holder and the handler symbol; Pydantic models as `data`/`schema`
  nodes; and `background_tasks.add_task(...)` as `job` nodes with `TRIGGERS` edges. Everything
  carries `framework-convention` provenance — there is no FastAPI-specific node type.
- Two degradations are deliberately loud rather than silent: an `include_router` whose argument
  cannot be resolved produces a warning and leaves that router's routes unprefixed, and a
  `CodeGraph` assembled without `symbolReferences` produces a warning saying Pydantic models were
  not enriched.
- Both adapters are registered in the production roster, so the `fastapi-app` fixture is pinned by
  a full-pipeline golden (`packages/test-kit/goldens/fastapi-app.graph.txt`). The temporary
  `fixture-assembly.ts` stand-in and its `.adapters` golden were deleted when that landed.

### The Java adapter and Spring enrichment (Story 16.5)

- `createJavaAdapter()` claims `.java` only and refuses anything else, like Python.
- It emits: `class` nodes (for classes, enums and records — §12.1 has no enum type and inventing
  one is not an adapter's call), `interface` nodes, `method` nodes for methods and constructors,
  a `symbol` node per field, `CONTAINS` edges, `ImportReference`s, `extends`/`implements` symbol
  references, `injects` references for constructor parameter types, `calls` references for bare
  invocations, `CallFact`s for `receiver.method(...)`, and a `java:field-type` `CallFact` per field
  recording what that field is declared as.
- **Receiver-qualified calls are bound as far as parsing honestly allows.** `dealService.findAll()`
  names no type, but Java states the receiver's type one declaration away — as a field, a parameter
  or a local. The adapter builds that scope per method (class fields, overlaid with the method's
  own parameters and locals) and emits a `calls` reference to the **type**, which assembly resolves
  into a `CALLS` edge from the calling method to the declaring class. It stops there: picking
  `DealService.findAll` out of the overload set needs a type checker, so the method-level target is
  not claimed, and the `CallFact` still carries the method name for anyone who needs it. A receiver
  whose type the file never states — a static call, a chained call, an undeclared name, a `var` —
  produces nothing. One reference per collaborator per body, not one per call site.
- **That scope is positional, not flattened** (epic-16, `java-types.ts`). Java's visibility rule is
  written down in JLS §6.3 and is entirely about source ranges: a local is visible from its
  declarator to the end of the block that immediately contains it, a parameter throughout its
  method, a field throughout its class. Each binding therefore carries a range, and a lookup is
  "which binding covering this offset was declared last" — no traversal state, no push/pop, and no
  dependence on the order the tree happens to be walked in. A local's scope end is read from its
  declaration's PARENT node, which is the rule itself rather than an approximation: the enclosing
  `block` for an ordinary statement, the `for_statement` for a loop's init clause, the
  `switch_block_statement_group` for a `case` arm.
  A flattened map got this wrong in one way, and it was not harmless: two locals of the same name
  in sibling blocks resolved last-wins, so a call in the FIRST block was attributed to the type
  declared in the SECOND — a wrong edge, not a missing one. `java-scoping.test.ts` pins the
  corrections per call site (that is where a wrong target is visible), and `DealService.describe`
  in the `java-spring` fixture pins it end to end. `var` is now also excluded from binding: it is
  Java's inference keyword, the grammar reports it in the `type` field like any other type
  identifier, and binding a name to a "type" called `var` states something the file does not say.
- **Implicit package visibility is modelled explicitly.** Java resolves an unqualified type against
  the file's own package with no import statement at all. The adapter therefore reports such a type
  reference as an import of `<own package>.<Type>`, evidenced by the reference site rather than by
  an import line that does not exist. Without this, every same-package dependency — the normal case
  in a Spring service — would be unresolvable.
- `createJavaModuleResolver(filePaths)` resolves `com.example.deals.DealService` by matching the
  path suffix `com/example/deals/DealService.java` against the scanned set, so it works for
  `src/main/java`, `src/test/java`, Gradle modules and flat layouts without a hardcoded source-root
  list. Two files matching the same suffix is an ambiguity it refuses to resolve rather than pick a
  winner.
- `createSpringAdapter()` derives: `@RestController`/`@Controller` → `controller` role nodes;
  `@Service`/`@Repository`/`@Component`/`@Configuration` → `service` role nodes;
  `@SpringBootApplication` → an `application` node; and `@GetMapping`/`@PostMapping`/… /
  `@RequestMapping` → `api-endpoint` nodes with `EXPOSES` edges from both the controller and the
  handler method, composing the class-level `@RequestMapping` prefix with each method-level path.
  Route node ids match the NestJS and FastAPI ids (`route:<VERB> <path>`) on purpose — a route is a
  route whatever framework declared it, which is what makes cross-stack matching possible (§C13).
- `@RequestMapping` without an explicit `method` element maps every verb in Spring, and is reported
  as `ANY <path>` rather than silently defaulting to `GET`.
- **Annotation names are not unique across ecosystems.** NestJS spells its controller decorator
  `@Controller` too, so the Spring adapter reads only decorator facts whose file is a `.java` file.
  Without that filter a NestJS repository sprouts Spring controller nodes — a wrong fact, not a
  harmless one. (Caught by the `nestjs-app` golden, which is exactly what goldens are for.)
- **Constructor injection produces no Spring-specific edge.** A constructor parameter type is a
  static dependency whatever framework wires it, so the Java adapter reports it as an `injects`
  reference and assembly turns it into a `USES` edge with `static-analysis` provenance — the same
  path the TypeScript adapter and NestJS take. Re-emitting it under a framework label would
  duplicate a true edge, not add information.
- **Field injection does, and only for annotated fields.** Nothing about `private DealService
dealService;` says the class collaborates with it rather than merely holding it, and emitting an
  edge for every field would bury real dependencies under every `String`, `Clock` and `Logger` in
  the repository. `@Autowired` (or `@Inject`, or `@Resource`) is what states the wiring, so the
  annotation is the trigger, the declared type comes from the Java adapter's `java:field-type`
  facts, and the `USES` edge carries `framework-convention` provenance with the annotation as its
  evidence. A class that has both an annotated field and a constructor parameter of the same type
  keeps the one edge assembly already produced rather than gaining a second under another id.
- **`@Scheduled` → a `job` node with a `TRIGGERS` edge to the annotated method.** The method is
  already a `method` node; the job is the separate thing Spring adds — a timer that invokes it —
  and keeping them distinct is what lets impact analysis name the job without claiming the schedule
  and the method are one entity. The schedule **expression** is not modelled: `cron = "0 0 * * * *"`
  has no place in §12.1, and `fixedDelayString = "${app.delay}"` is a property reference the adapter
  would have to resolve to read. It stays verbatim in the job's evidence.
- **`@Bean` factory methods → a `service` node contained by the factory method.** §12.1 has no
  "bean" type and a factory can return anything, so `service` is the closest honest reading of "an
  application-level collaborator the container owns". `@Bean("name")` names it; otherwise the method
  name does. The bean's declared **type** is the method's return type, which the Java adapter does
  not report and this adapter will not infer. A `@Bean` outside a stereotyped class is warned about
  and skipped — Spring would not wire it either.

### The Spring property-source adapter (`spring-config`, epic-16)

A language adapter with no parser: it reads `src/main/resources/application*.{yml,yaml,properties}`
and emits one `spring:config-property` fact per stated entry (flattened key, value, evidence at the
line). It exists because `@Value("${key}")` resolution needs the file's CONTENT, and only a
language adapter is handed content (PRD §31).

**It claims `.yml`, `.yaml` and `.properties` wholesale**, because the registry dispatches by
extension and cannot key on a filename. Anything it is handed that is not at a Spring resource path
gets exactly the file-level fact the fallback adapter would have produced — the same guard
`java-adapter.ts` applies to a non-Java file — so no graph output changes for a repository with no
Spring configuration. That warning is EXPECTED DEGRADATION and is filtered from warning summaries
alongside the fallback's (`NOT_SPRING_CONFIG_WARNING`, filtered in `workspace-engine/src/
indexing.ts`); reporting it would put one line per YAML file in front of the real warnings. A
future YAML-consuming adapter collides here loudly at registry construction, never quietly.

**No YAML library** (a dependency needs human approval), so the reader handles the nested
scalar-mapping subset Spring configuration actually uses and REFUSES everything else: sequences,
block scalars, flow collections, anchors/aliases/merges, tags, tabbed indentation, unterminated or
escaped quotes, `.properties` continuation lines and escaped keys/values. A refused line contributes
no entry, which means a placeholder resolves to nothing — the correct outcome, because a
half-decoded value that then names a topic is exactly the invented fact §35 forbids. Refusals are
counted and reported in one warning per file. Multi-document files are read in full, all documents,
so a profile override is visible to the resolver as a disagreement rather than silently picked.

**Credential-bearing keys are never recorded.** A key containing `password`, `secret`, `token`,
`credential`, `privatekey`, `apikey`, `accesskey`, `passphrase` or `authorization` (compared with
`-`/`_`/`.` removed) is dropped, and values are length-capped. This mirrors the Terraform adapter's
refusal to read `.tfvars` VALUES, with the difference that a topic name genuinely IS needed
downstream, so the rest of the file is read. Facts are cached in the local index, so this is a
privacy decision, not a parsing one.

### The Astro adapter (Story 16.4, ADR-0014)

- `createAstroAdapter()` claims `.astro`. It splits the file on its `---` fences and pads each half
  with the newlines that precede it, so both parsers report line and column numbers that point at
  the real position in the real file — evidence stays clickable with no offset arithmetic anywhere
  downstream.
- **Each fact records which half produced it**, in its evidence id: `astro-frontmatter:` for facts
  from the TypeScript compiler API, `astro-template:` for facts from the `html` grammar. The scope
  marker is carried by `ParseState.evidenceScope`, so a plain `.ts` file's evidence ids are
  unchanged.
- A frontmatter fence that opens and never closes is **malformed, not recoverable**: the rest of
  the file could be TypeScript or could be markup and there is no way to tell, so the file degrades
  to file-level facts plus a warning rather than a guess.
- The `html` grammar cannot represent Astro's JSX expressions (`{items.map(…)}`), so any template
  containing one parses with error recovery. That is expected, but it does mean references inside
  such an expression are not indexed — so the warning says that in those words instead of reporting
  a syntax error (PRD §34: partial support is reported, never hidden).
- An `.astro` file **is** a component, default-exported and named by its own file name. That single
  convention is emitted by the language adapter (as a `ui-component` node with
  `framework-convention` provenance) rather than by enrichment, because without it nothing
  downstream can bind `import Base from '../layouts/Base.astro'` to `<Base>` in a template.
- Template facts are relationship-focused per PRD §30: capitalized tags become `calls` symbol
  references (resolved against the frontmatter's imports, which is what produces the page → layout
  edge), and reference attributes travel on the `CallFact` channel with
  `receiverName: 'astro:template'`. Correlating `/api/deals` with a route is the framework
  adapter's job, not the parser's.
- **The Astro and HTML readers now share one table of what points where**
  (`html/reference-targets.ts`, epic-16). They had duplicate copies, the copies drifted, and the
  drift is what stopped a repository-local `<script src="../scripts/x.ts">` in an `.astro` file
  from ever becoming an `IMPORTS` edge — the HTML adapter turned local asset references into
  `ImportReference`s and the Astro reader did not. They are aligned: a **navigation** attribute
  (`a[href]`, `area[href]`, `form[action]`) is never a file and stays a `CallFact`; an **asset**
  attribute whose value is a repository-local relative path becomes an `ImportReference`. A
  root-relative value stays a `CallFact` in both — in Astro `/logo.svg` means `public/logo.svg`,
  and mapping a URL root to a directory on disk is a deployment convention neither reader can see.
  A specifier naming no scanned file resolves to nothing, so the failure mode of a bad path is a
  missing edge, never a wrong one. Astro also now walks the template in document order, as the HTML
  reader already did.
  `<script src>` is the unambiguous case (Astro bundles it and resolves it relative to the file);
  for the other asset attributes a plain relative URL is left to the browser, so the claim made is
  the narrower one the document states — "this file names that path" — and it only becomes an edge
  when a scanned file sits at it. Pinned by `astro-site`, whose page imports
  `src/scripts/deal-filter.ts` through a `<script src>` while a root-relative `<img>` and a CDN
  `<script>` produce no edge at all.
- `createAstroFrameworkAdapter()` derives file-based routing and content collections from the
  assembled graph: every `.astro` component under `src/pages` `EXPOSES` the `page` its path names
  (`src/pages/index.astro` → `/`); every HTTP-verb export under `src/pages/api` `EXPOSES` an
  `api-endpoint` (`src/pages/api/deals.ts` → `GET /api/deals`) — those files are plain TypeScript
  the TS adapter already indexed, so enrichment reads its output rather than re-parsing;
  `defineCollection` produces a `data`/`collection` node named by its binding, and
  `getCollection('x')` produces a `READS_FROM` edge from the reading component. A `getCollection`
  naming a collection no `defineCollection` declared is warned about, never invented — inventing it
  would manufacture the very fact the edge is supposed to prove.
- **`<form method>` is recorded** on the template fact's `keywordStringArguments`, uppercased
  because HTTP method tokens are case-insensitive (RFC 9110) while route nodes spell them uppercase.
  That normalization is not an interpretation. An **absent** `method` records nothing: HTML's
  default is GET, but applying a default is the correlating adapter's decision, and this channel
  records what the document says. Without the verb, an `action` match links every verb at that path.
- **`client:*` hydration directives are recorded and produce no edge**
  (`receiverName: 'astro:client-directive'`, `calleeName: 'client:load'`, the component in
  `stringArguments[0]`). A client directive says the component ships to the browser and runs there
  — a real architectural property that §12 has no node or edge type for. The relationship that IS
  expressible (this page renders that component) is already the component reference, so a second
  edge would restate it while saying nothing about hydration. Modelling client islands properly is a
  §12 addition, i.e. domain-provenance's decision.
- **Astro server actions (`astro:actions`) are NOT detected.** The canonical declaration is
  `export const server = { createDeal: defineAction({…}) }`, which puts the `defineAction` call in
  an object-literal property — a position the TypeScript adapter does not record on the `CallFact`
  channel, so the action names never reach the graph. Detecting only the non-canonical
  `export const createDeal = defineAction(…)` shape would emit nodes for something Astro does not
  wire. Closing this needs `parse-call-facts.ts` to record object-literal property initializers,
  which is a TypeScript-adapter change.

### The standalone HTML adapter (Story 16.4)

`createHtmlAdapter()` claims `.html`/`.htm` and reuses the `html` grammar the Astro adapter already
loads. It is the smallest adapter in the package, on purpose: PRD §30 says HTML is read for its
relationships to templates, components, scripts, forms, routes and assets and is **not** treated as
application architecture. So it declares no symbols, no components, no pages and no routes — which
URL a `.html` file is served at depends on a web server the adapter never sees, and deriving a
`page` node from a file path would be exactly the claim §30 rules out. The only node an HTML
document produces is its own file node.

It splits what it finds in two:

- **A reference to another file in this repository** — `<script src="./app.js">`,
  `<link href="./styles.css">`, `<img src="assets/logo.svg">` and the other asset attributes — is an
  `ImportReference`, which assembly resolves into an `IMPORTS` edge using the same resolver and the
  same scanned file roster as every other language. A browser resolves `src="app.js"` against the
  document, so a bare path is prefixed `./` to say so in the specifier grammar the resolvers share;
  nothing else is rewritten.
- **A reference to somewhere else** — `<a href>`, `<form action>`, and any value with a scheme, a
  protocol-relative prefix, a root-relative path or a fragment — is a fact on the `CallFact` channel
  with `receiverName: 'html:template'`, carrying `<form method>` exactly as the Astro reader does.
  Whether `/api/deals` is a route of _this_ system is a correlation, not something the document
  states. Navigation targets are never treated as files even when they look like one, so
  `<a href="./about.html">` is a fact and not an import.

Cross-stack URL correlation currently accepts `astro:template` and `http:client` only; adding
`html:template` to that set is a one-line change in `cross-stack/cross-stack-adapter.ts` and is
tracked in epic-16 Story 16.6.

### `analyzeDiff` goldens

`analyzeDiff` has its own goldens (`packages/language-adapters/src/diff/analyze-diff.test.ts`):
literal `GitDiff` fixtures in, expected `GraphChangeSet` out. They pin symbol added/removed/
changed detection, import deltas, node/edge removals, whole-fragment removal for deleted files,
rename-as-one-change, and the unverifiable cases (binary content, unsupported extension, missing
baseline content).

## Initial roster and delivery order (PRD §30–31, §44 Phase 8)

Language adapters: TypeScript/JavaScript (shared), Python, Java, Astro, HTML, Prisma, Terraform,
Spring configuration (`spring-config`), fallback. Framework adapters: NestJS, Express, FastAPI, Spring, Astro, GCP/Terraform, Cloud Run,
Pub/Sub. All interfaces exist from the beginning even where implementations lag (PRD §39).

**The §44 Phase 8 order was inverted by grammar availability, not by preference.** Terraform was
meant to go first and was blocked longest (ADR-0014 settled the HCL grammar), so delivery ran:
TS/JS + NestJS/Express (MVP §39) → Python + FastAPI → Java + Spring → Astro → Terraform →
standalone HTML.

## Evidence ids must distinguish the facts they carry

An evidence id is `ev:<kind>:<file>:<line>:<col>:<symbol>`. The **symbol is part of the identity**,
and leaving it out has bitten twice:

- Python's generic call pass and its Pub/Sub pass both cite the same `client.publish(...)`
  expression, for different symbols.
- Terraform `count` expansion declares `shard[0]` and `shard[1]` at one position.

In both cases two records landed under one id. Assembly deduplicates by id, so one fact silently
lost its evidence — or worse, kept a record describing the other symbol. `FragmentBuilder.addEvidence`
now collapses a byte-identical re-add (two detectors legitimately citing one thing) and, for a
CONFLICTING re-add, keeps both records and emits a warning naming the id: dropping one would lose
a real fact, and the warning tells the adapter's owner their id scheme is not distinguishing them.

## Graceful degradation matrix

Partial support is reported, never hidden (PRD §34, §43.4):

| Situation                                            | Behavior                                                            | User-visible signal                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| No adapter for a file type                           | Fallback adapter: file/dir nodes + text evidence                    | Index status: file counted "fallback-only"                |
| Adapter exists, single-file parse fails              | `ParseFailure` warning; file gets fallback treatment                | Parser warning with file + category                       |
| Adapter fails to initialize (e.g. WASM grammar load) | Adapter disabled for the run; its files go to fallback              | Prominent index-status error; analysis continues          |
| Framework detection inconclusive                     | No enrichment; generic facts remain                                 | Detection listed "not detected" with the evidence checked |
| Custom rule invalid                                  | Rule rejected at validation; last valid config keeps running (§Z13) | Config warning + audit entry                              |
| Language present but adapter not yet shipped         | Fallback + explicit "unsupported language" report                   | Index status names the language and the limitation        |

Impact and review results computed over degraded regions must reflect it — the "Unverifiable"
review category and reduced confidence exist precisely for this (`implementation-review.md`,
`provenance-model.md`).
