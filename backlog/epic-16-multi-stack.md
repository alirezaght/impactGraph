# Epic 16 — Multi-Stack Adapters & Cross-Stack Graph

**Goal:** Analyze polyglot repositories (TS/JS, Python, Java, HTML, Astro, Terraform) as one architectural system with cross-language relationships, on the shared language-neutral graph.
**Spec:** §6.1–6.2, §15.2, §30–31, §44 Phase 8, §C12–§C14, §C16
**Phase:** 8 (recommended order below) · **Depends on:** Epics 02, 03

Recommended delivery order (§44): Terraform → Python/FastAPI → GCP/Cloud Run → Pub/Sub → Astro/HTML → Java/Spring.

> **Status note 2026-08-02.** Delivery order was inverted out of necessity: Python/FastAPI (16.2)
> shipped first because Terraform (16.1) had no available HCL grammar, then Java/Spring (16.5) and
> Astro (16.4). ADR-0014 resolved the grammar question for both (Astro needs none; Terraform uses
> `@tree-sitter-grammars/tree-sitter-hcl`), and 16.1 then shipped together with the cross-stack
> correlation it unblocks.
> **All seven stories delivered as of 2026-08-02.** The last engineering gaps — Java/Spring Pub/Sub
> client detection (16.3), aliased cross-file imports (16.2) and the cross-stack impact + review
> E2E (16.6/§C16) — closed in the final pass. What remains under this epic is a short list of
> documented declines and two follow-ups owned by other contexts (`EXPOSES` traversal for
> impact-modeling; the review-golden name collision for the golden serializers), each written up
> where it belongs below.
>
> **Depth pass, 2026-08-02.** A second pass closed the deferred detail inside the delivered
> stories: Terraform `count`/`for_each` multiplicity, `data.*` references and `.tfvars` →
> `CONFIGURES` (16.1); Spring `@Scheduled`/`@Bean`/field `@Autowired` and bounded Java
> receiver-type resolution (16.5); a standalone `.html` adapter, `client:*` directives and
> `<form method>` (16.4/16.6). Three things were **declined with reasons rather than deferred
> silently** — `.tf.json` (no source positions from `JSON.parse`), Astro server actions (the
> declaration shape is invisible to the TypeScript adapter's call-fact channel), and modelling
> client-side hydration as an edge (§12 has no concept for it). Each is written up where it belongs
> below.
>
> **Reconsidered-declines pass, 2026-08-02.** Seven previously declined items were re-examined on
> the instruction to implement each honestly or explain concretely why not. **Six shipped**:
> `.tf.json`/`.tfvars.json` (16.1), CommonJS Pub/Sub binding (16.3), Astro asset `ImportReference`s
> (16.4), Java block scoping (16.5), import-bound `axios`/`$fetch` clients (16.6), and `<a href>` →
> page navigation (16.6). **One shipped narrower than asked and the narrowing is the point**:
> Python HTTP-client URLs are recorded only for a client this repository's own ASGI app was handed
> — a root-relative path in Python resolves against a `base_url`, so the general shape would
> manufacture wrong edges (16.6). Two defects were found and fixed on the way: prototype-named
> Terraform labels resolved through object-literal lookup tables (§42.5), and Python f-strings had
> their literal PREFIX read as a complete value. Details on each line below.

---

## Story 16.1 — Terraform adapter

> **DELIVERED 2026-08-02.** Unblocked by `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` (ADR-0014);
> the `tree-sitter-terraform.wasm` dialect artifact is used rather than the generic HCL one. The
> adapter is split in two, which was **not** the original plan and is the main design note of this
> story: `indexRepository` parses one file at a time so results stay cacheable by content hash
> (§32), but Terraform identity is per _directory_. So `packages/language-adapters/src/terraform`
> emits file-local facts and puts cross-file references on the `CallFact` channel, and
> `packages/framework-adapters/src/terraform` resolves them against the assembled graph. Both are
> registered in the production roster.
>
> Also in this pass: the `GrammarSource` abstraction now maps a grammar id to a package specifier,
> since grammars span two npm packages. The `web-tree-sitter@^0.25.10` pin that ADR-0014 flagged as
> droppable is **untouched** — migrating Python/Java/HTML to per-grammar packages is still open, and
> was out of scope here.

**Acceptance criteria**

- [x] Detects modules, resources, data sources, variables, outputs, provider usage, resource
      references (§15.2) — passing `runLanguageAdapterContractChecks` with an **empty skip list**,
      plus a hostile-content suite (§42.5). `terraform`/`locals`/`moved` blocks are deliberately not
      nodes (settings, not components).
- [x] Cloud Run services/jobs, Pub/Sub resources, IAM, secrets and env bindings become typed
      infrastructure nodes (§12.1) — typed directly from the resource type string. **Caveat:**
      `variable`/`output`/`provider`/`data` blocks are typed `terraform-resource` because §12.1 has
      nothing more specific; the block kind lives in the node id and name. A §12 vocabulary
      addition (a `terraform-variable`/`terraform-output` type) is a domain-provenance decision and
      was not taken unilaterally.
- [x] Terraform is parsed, never executed (§35) — no CLI, no provider download, no expression
      evaluation. An interpolated attribute is a warning naming attribute and line, never a value
      stitched from its literal halves; references _inside_ interpolations are still read.

**Tasks**

- [x] Decide the HCL grammar source and get the dependency approved (ADR-0008 open question) —
      resolved by ADR-0014; the dependency was already installed and verified.
- [x] HCL parser integration; map resources → nodes, references → edges.
- [x] Extract Cloud Run / Pub/Sub / IAM / Secret resources specifically.
- [x] Golden tests on Terraform GCP fixture (§42.2) — `packages/test-kit/goldens/terraform-gcp.graph.txt`,
      through the real pipeline.
- [x] **`count`/`for_each` modelled (2026-08-02).** A **literal** `count = 3` expands into three
      nodes at Terraform's own addresses (`…shard[0..2]`) — reading typed digits is parsing, not
      evaluation. Everything else is one node plus a warning: `count = 0` emits **no** node (the
      block declares no object), an expression count, a `for_each`, and a count above the
      10-instance expansion cap each say so explicitly. References to an expanded set fan out to
      every instance, including subscripted ones (`shard[count.index]` names the set; which member
      is unresolvable, so no member is guessed). `each.key`/`count.index` references remain skipped
      as language built-ins. Pinned by the `terraform-gcp` fixture's new `expansion.tf` and by
      `framework-adapters/src/terraform/terraform-adapter.test.ts`.
- [x] **`data.<type>.<name>` references resolve (2026-08-02).** `data` left the skip list: a `data`
      block IS declared in the configuration and IS a node, so a resource reading one now gets a
      `DEPENDS_ON` edge. `local`/`each`/`count`/`self`/`path`/`terraform` remain skipped — those
      genuinely name nothing this repository declares.
- [x] **`.tfvars` bind to their variables (2026-08-02).** A top-level assignment becomes a
      `CONFIGURES` edge from the values file to the `variable` block **in the same directory** — the
      first `CONFIGURES` edge in the product, and the only binding the repository states rather than
      implies (`-var-file=…` can point anywhere from a command line §35 forbids us to see). The
      assigned **value is never read**: `.tfvars` entries are frequently secrets and nothing needs
      the value to know which variable is configured. An assignment naming no declared variable is
      warned about.
- [x] **`.tf.json` and `.tfvars.json` are claimed (2026-08-02).** The blocker was real and is now
      fixed: `JSON.parse` reports no source positions, so the document is read through the
      **`tree-sitter-json` grammar that `tree-sitter-wasms` already ships** — no new package, no
      ADR-0008 amendment (non-TS languages via tree-sitter WASM is exactly what this is), and the
      same loader, error handling and warning shape as Python/Java/HTML. A hand-written tokenizer
      was considered and rejected on ADR-0014's own reasoning (a real grammar over a scanner we
      would own); the CST is also strictly more accurate here, because `string_content` gives a
      Terraform reference inside `"${…}"` an exact column that offset arithmetic over a decoded
      string loses as soon as an escape appears. `terraform-json.ts` maps HashiCorp's documented
      JSON structure onto the SAME `TerraformDocument` the HCL reader produces, so addresses, node
      types, `count` expansion, secret bindings and the framework adapter's edges all work
      unchanged; `terraform-interpolations.ts` shares one `addressFromSegments` rule with the HCL
      path rather than growing a second copy. Pinned by a JSON module inside `terraform-gcp` whose
      secret binding lands on the same `terraform:secret:db-password` node the HCL files use, plus a
      root `dev.auto.tfvars.json` producing `CONFIGURES` edges. Error recovery is **refused** rather
      than read through, unlike HCL: in JSON the nesting IS the block structure, so a missing brace
      re-parents every block after it and reporting relabelled resources would be worse than
      reporting none. Tests: `terraform/terraform-json.test.ts` (12, over half of them position
      assertions and §42.5 cases).
      **Found and fixed while doing this**: `LABEL_COUNT`, `RESOURCE_NODE_TYPES` and the reference
      `KINDS` table were object literals keyed by untrusted block/type names, so
      `resource "__proto__" "x"` resolved to `Object.prototype` instead of missing (§42.5). All
      three are `Map`s now — a latent defect on the HCL path too, not only the new one.

## Story 16.2 — Python language adapter + FastAPI

> **DELIVERED 2026-08-02**, including engine registration. Python and FastAPI are in the production
> roster (`packages/workspace-engine/src/indexing.ts`), `.py` imports resolve through
> `createPythonModuleResolver`, `symbolReferences` now reach the `CodeGraph`, and `fastapi-app` is
> pinned by a **full-pipeline** golden. Remaining gaps are narrower than before and listed below:
> `Depends()` injection, middleware detection, and service-module classification.

**Acceptance criteria**

- [x] Python adapter indexes symbols, imports, calls per the `LanguageAdapter` contract (§30) —
      `packages/language-adapters/src/python`, passing `runLanguageAdapterContractChecks` with an
      empty skip list.
- [~] FastAPI adapter detects routers, endpoints, dependencies, Pydantic models, background tasks,
  middleware, service modules (§15.2) — routers, endpoints (with `include_router` prefix
  composition), Pydantic models and background tasks are done. **`Depends()` injection,
  `@app.middleware`/`add_middleware`, and service-module classification are NOT implemented.**
- [x] `analyzeDiff` supported for review parity — via the shared `analyzeDiffWithIndexer`, covered
      by a symbol-level test.

**Tasks**

- [x] Implement Python parsing (tree-sitter) → graph facts.
- [x] Implement the tree-sitter WASM loader (lazy init, per-process grammar cache, injectable
      grammar source, warnings-not-throws) — ADR-0008 accepted on this milestone.
- [~] Implement FastAPI enrichment — decorator routes, Pydantic models as data nodes, background
  tasks done; **`Depends()` not started.**
- [x] Golden tests on FastAPI fixture — `packages/test-kit/goldens/fastapi-app.adapters.graph.txt`,
      plus a hostile-content suite (§42.5).
- [x] **Register the Python adapter in the engine** — `createPythonAdapter()` and
      `createFastApiAdapter()` are in the rosters in `packages/workspace-engine/src/indexing.ts`;
      `packages/repository-intelligence/src/assembly/module-resolvers.ts` dispatches `.py` imports
      to `createPythonModuleResolver`; `assembleGraph` carries `symbolReferences` through to the
      `CodeGraph`, so the FastAPI adapter's "class-base facts were not supplied" warning no longer
      fires in the real pipeline and Pydantic models are detected.
- [x] `fastapi-app` added to the pipeline goldens in
      `repository-intelligence/src/graph-goldens.test.ts`
      (`packages/test-kit/goldens/fastapi-app.graph.txt`); the temporary
      `framework-adapters/src/fastapi/fixture-assembly.ts` stand-in, its `fastapi-golden.test.ts`
      and its `.adapters` golden are deleted. The adapter's degradation unit tests now build a
      single-file `CodeGraph` inline instead, which is what they were always really testing.
- [x] **Aliased cross-file imports resolve (2026-08-02).** `ImportReference` grew an optional
      `aliases: { local, exported }[]`, populated only for genuinely RENAMED bindings by the
      TypeScript adapter (named imports and named re-export specifiers) and the Python adapter
      (`import_from_statement`); Java has no import renaming and never populates it. A list, not a
      `Record`: the keys come from untrusted text and an object literal answers `constructor` from
      its prototype (§42.5). `assembly/assemble.ts` translates local → exported before consulting
      the target's export table, on the direct-import path AND on each re-export hop, so
      `export { inner as outer } from './m'` chains resolve too.
      Two non-cases, deliberate: a **default** import is not an alias of `default` (the export table
      records default exports under their declared name, so rewriting would break what works), and
      `import os.path as osp` renames a module, not a symbol.
      Pinned by `repository-intelligence/src/assembly/import-aliases.test.ts` (5 cases, including a
      renamed import of a name the target does NOT export, which must still resolve to nothing) and
      by fixture coverage: `ts-basic/src/api/deals.ts` and `fastapi-app/app/routers/deals.py` had
      existing plain imports **converted** to renamed ones, so both graph goldens must stay
      byte-identical — renaming a binding may not change the graph. Reverting the fix deletes lines
      from both. `cross-stack` additionally gains a genuinely NEW edge
      (`DealEventsService.onDealEvent → publishDealCreated`).
      The FastAPI `include_router` workaround is **deleted**: it fell back to the import specifier
      and took the first router declared in that module regardless of which name was imported, so
      with two routers in one module it bound the wrong one. Precise resolution or nothing.

## Story 16.3 — GCP / Cloud Run / Pub/Sub enrichment

> **DELIVERED 2026-08-02.** Terraform (16.1), the correlation machinery (16.6), and Pub/Sub client
> detection in **TypeScript, Python and — as of this pass — Java/Spring**. All three languages emit
> the same node ids with the same provenance, and the `cross-stack` fixture proves it the only way
> that counts: adding the Java publisher added Java edges and **no new topic or subscription node**.
> `infrastructure-links.ts` needed no change for Java, which is the design working rather than luck
> — it matches on node type and declared name and cannot learn which language produced a node.
>
> **Where the client detection lives, and why.** In the LANGUAGE adapters
> (`language-adapters/src/typescript/parse-pubsub.ts`, `src/python/python-pubsub.ts`,
> `src/java/java-pubsub.ts` + `src/java/java-pubsub-channels.ts`), not in a
> framework adapter. The facts a Pub/Sub client produces are chained member calls inside function
> bodies (`pubsub.topic('x').publishMessage(…)`), and the `CallFact` channel deliberately carries
> only module-level, single-receiver calls. Widening that channel would change what Express, the
> Astro collection detector and every §Z8 rule sees; deriving the facts inside the parse that is
> already happening changes nothing for anyone else — verified by disabling both hooks and
> confirming all eight other goldens stay byte-identical. If the `CallFact` contract ever grows a
> chained-call shape, this belongs in a `framework-adapters/src/pubsub/` adapter instead.
>
> **Provenance: `framework-convention` on every node and edge**, never `static-analysis`. The
> string literal is genuinely parsed, but "a string handed to `.topic()` names a Pub/Sub topic and
> `.publishMessage()` on it is a publication" is knowledge about a library, not something the
> source states — §12.3's deterministic category for exactly that. Evidence is the parsed call
> site, from both sides once cross-stack correlates it.
>
> Node ids are shared across languages on purpose (`topic:<name>`, `subscription:<name>`), which is
> what makes a TypeScript publisher and a Python consumer of the same topic ONE node (§C13). The
> cross-stack adapter cannot tell which language produced a topic node, and must not be able to.

**Acceptance criteria**

- [~] Cloud Run services/jobs, Pub/Sub topics/subscriptions, service accounts, IAM bindings, Secret
  Manager refs, Artifact Registry images, scheduled triggers detected from code + Terraform
  (§15.2) — all of these are detected from Terraform; **Pub/Sub topics and subscriptions are now
  also detected from code** (TS `@google-cloud/pubsub`, Python `google.cloud.pubsub_v1`). Cloud Run
  services/jobs, service accounts and IAM are still Terraform-only, which is correct: code does not
  declare them. **Artifact Registry images and scheduled triggers
  (`google_cloud_scheduler_job`) are not specially typed** — they fall to `terraform-resource`; an
  image is usually an interpolated string, which §35 forbids resolving.
- [~] Application code linked to infrastructure: DEPLOYED_AS, PUBLISHES, SUBSCRIBES_TO, CONFIGURES
  edges across the stack (§12.2) — `DEPLOYED_AS` is delivered (package/application → Cloud Run
  service/job, code-side topic/subscription → Terraform topic/subscription). `PUBLISHES` and
  `SUBSCRIBES_TO` now exist **in code**, from the publishing/consuming symbol to the code-side
  topic/subscription node, which reaches infrastructure in two hops. **No `CONFIGURES` edge is
  produced anywhere**, and no `PUBLISHES` edge crosses the stack boundary directly — see 16.6 for
  why that is a deliberate modelling choice rather than an omission.

**Tasks**

- [x] **Implement Pub/Sub client-usage detection in TS and Python code.**
      `language-adapters/src/typescript/parse-pubsub.ts` (`new PubSub()`, `.topic('x')`,
      `.subscription('y')`, `publish`/`publishMessage`/`publishJSON`, `subscription.on('message')`,
      following handles through variables and chains) and `src/python/python-pubsub.ts`
      (`PublisherClient()`/`SubscriberClient()`, `topic_path`/`subscription_path`, `publish`,
      `subscribe`). Both gated on an import of the real client library, so a local `./pubsub`
      helper exporting a `PubSub` class never matches. Unit suites
      (`typescript/pubsub-detection.test.ts`, `python/python-pubsub.test.ts`) are written as
      negative space: a wrong topic name is the failure mode that matters, because it would
      correlate against a real Terraform resource and look convincing. §42.5 hostile-content cases
      included; the lookup tables are `Map`s so a method named `constructor` misses.
- [x] **Java/Spring Pub/Sub client detection (2026-08-02).**
      `language-adapters/src/java/java-pubsub.ts` (per-method-body pass) and
      `java-pubsub-channels.ts` (file-level pass). Shapes: `PubSubTemplate.publish` /
      `subscribe` / `subscribeAndConvert` / `pull` / `pullNext` / `pullAndAck` / `pullAndConvert`
      through a receiver whose declared type Story 16.5's `JavaTypeScope` already knows;
      `new PubSubInboundChannelAdapter(t, "sub")` and `new PubSubMessageHandler(t, "topic")`;
      `Publisher.newBuilder(TopicName.of(p, t))` and
      `Subscriber.newBuilder(ProjectSubscriptionName.of(p, s), …)`, including through a local
      bound to the `*Name.of(…)` call. Same node ids (`topic:<name>`, `subscription:<name>`,
      `integration` category) and same `framework-convention` provenance as TS and Python.
      The gate is checked **per type name** against the fully-qualified import, so `PubSubTemplate`
      counts only when it came from `com.google.cloud.spring.pubsub.*`,
      `org.springframework.cloud.gcp.pubsub.*`, `com.google.cloud.pubsub.v1.*` or
      `com.google.pubsub.v1.*` — a same-named class next door is inert (pinned as a test).
      `@ServiceActivator(inputChannel = "…")` is linked only when ONE compilation unit states the
      whole chain (adapter names the subscription → `setOutputChannel` names the channel via a
      `@Bean` call or an explicit `@Qualifier` → the annotation consumes that channel). A channel is
      not a subscription, so the annotation alone proves nothing; Spring's by-parameter-name bean
      fallback is deliberately NOT used, because it depends on the whole application context.
      An unbindable channel is a warning naming the channel, and the subscription node still exists
      from the adapter construction, so cross-stack correlation is unaffected.
      Tests: `java/java-pubsub.test.ts` (11, split into detections and refusals) plus two §42.5
      cases in `java-malicious.test.ts` — prototype-named methods/fields must MISS the lookup
      tables, and a path-traversal topic name stays an inert node name.
- [x] **`require('@google-cloud/pubsub')` binds (2026-08-02).** The binding step moved to
      `typescript/pubsub-bindings.ts` and now reads CommonJS as well as ESM; the detector below it
      is untouched, which is why nothing else moved. `const { PubSub } = require(m)` binds what
      `import { PubSub }` binds, `const { PubSub: Client } = require(m)` binds the local name, and
      `const pubsub = require(m)` binds a **namespace** answering `new pubsub.PubSub()` — not
      `new pubsub()` — because `require(m)` evaluates to the exports object rather than to a
      callable. `import * as pubsub` gained the same namespace binding for free. A `require` at any
      depth counts (a lazily-required client is ordinary CommonJS); a computed specifier states no
      module and binds nothing. Tests: 7 added to `typescript/pubsub-detection.test.ts`, including
      a §42.5 case proving a destructured `constructor`/`__proto__` and `new ns.toString()` resolve
      to nothing. No golden moved.
- [x] **`this.pubsub.topic(…)` instance-field binding — CLOSED.** A Pub/Sub client is normally held on `this`, not in a module-level const, so this was the common shape. Field handles are collected from property initialisers AND constructor assignments (`this.pubsub = new PubSub()`), and a field may hold a client OR an already-derived topic/subscription. Fields are kept in a map SEPARATE from locals — a local `pubsub` and a field `this.pubsub` are different bindings and neither may shadow the other. Because the map is file-scoped while fields are class-scoped, two classes declaring the same field name with different handles collapse to AMBIGUOUS and resolve to nothing: the adapter does not guess which class a `this.` reference meant. Five tests pin the positive shapes and both negative ones.
- [x] **Client-binding shapes across all three languages — CLOSED (2026-08-02).** Python reads `self.publisher.publish(…)` (assigned in `__init__`, in any other method, or as a class-level attribute) and the `PublisherClient.from_service_account_file/json/info(…)` factory chains off the client class. Java reads field initialisers (`private final Publisher p = Publisher.newBuilder(TopicName.of(…)).build();`, attributed to the field's own symbol node, resolving resource-name FIELDS as well as locals), a `PubSubTemplate` reached through a getter whose body is exactly `return this.<field>;` / `return <field>;` in the same compilation unit, and `Publisher.newBuilder("projects/p/topics/t")` — parsed against the published `projects/<p>/(topics|subscriptions)/<name>` grammar, last segment as the name, so a Java publisher and a Terraform resource land on ONE node id. TypeScript propagates a stated module constant (`const TOPIC = 'deal-events'; pubsub.topic(TOPIC)`). Ambiguity discipline per language: TS and Python keep field/attribute handles in a map separate from locals and collapse a name two classes disagree about to AMBIGUOUS (resolves to nothing); Java scopes the map per `class_body` and so cannot produce the collision at all. 32 tests added — 12 in `typescript/pubsub-constants.test.ts`, 13 in `java/java-pubsub-binding.test.ts`, 7 in `python/python-pubsub.test.ts`, each positive shape matched by its refusal, plus §42.5 hostile-input cases on the new parse paths. No golden moved.
- [x] **A name the repository states NOWHERE stays undetected — this is a §35 LIMIT, not a task.**
      A **function parameter** (`publish(topicName, …)`, where the caller decides) and a
      **runtime-computed string** (`f"deal-{env}"`, a template literal with a hole, a
      concatenation, a value fetched at startup). No committed file contains the value, so there is
      no name any adapter may know, and none of them record anything — not a node, not a fact. A
      node emitted for one would be an invented fact that then correlates against a real Terraform
      resource and looks entirely convincing. Nothing further to build here.
      **The test is "does the REPOSITORY state the value?"** — never "does this file state it?",
      and never "does it look like a topic?". Two shapes that used to be on this list failed the
      wrong test and are now resolved (below); each one's other half is a committed file that
      states the value outright.
- [x] **`@Value("${deals.topic}")` resolves against the module's Spring configuration
      (2026-08-02).** The annotation states a KEY; `src/main/resources/application.yml` of the same
      Maven/Gradle module states the VALUE. Three components, split the way PRD §30/§31 requires:
      the Java adapter records the identifier on `pubsub:config-name` (never a topic name, never a
      node); a new `spring-config` LANGUAGE adapter reads `application*.{yml,yaml,properties}`
      (only a language adapter is handed file content) and emits one `spring:config-property` fact
      per entry; `framework-adapters/spring/spring-value-topics.ts` joins them, because joining two
      files is a framework adapter's job. Scope is per module — another module's configuration is
      another application. `${key:default}` is honoured; the default is stated in the annotation.
      **Resolves to nothing, with a warning:** an unstated key with no default; a value that is
      itself a placeholder (nothing expands twice, so a `${}` chain terminates); two property
      sources of the module disagreeing (a profile override — agreement collapses and DOES resolve,
      disagreement does not, because which profile runs is not stated); a composite argument
      (`"topics-${env}"`); a resolved value that is not a bare resource name (whitespace, or a
      `projects/p/topics/t` path). Evidence cites BOTH sites (annotation + config line); one site
      only in the default case, where one site is all there is. Provenance `framework-convention`.
      `spring-config` claims `.yml`/`.yaml`/`.properties` wholesale — the registry dispatches by
      extension and cannot key on a filename — and gives every non-Spring file exactly the
      fallback's file-level fact plus a warning that is filtered as expected degradation. It ships
      no YAML dependency: a hand-written reader covers the nested-scalar subset and REFUSES
      sequences, block scalars, flow collections, anchors, tags, tabs and escapes, and never
      records a credential-bearing key. Fixture: `java-spring` gained a `@Value`-configured
      publisher plus its `application.yml` entry (+6 golden lines). Tests: 12 adapter + 12 resolver + 3 Java fact, including hostile YAML (`constructor`/`__proto__` keys, a `${}` bomb).
- [x] **`process.env.TOPIC` / `os.environ["TOPIC"]` resolve against the Terraform Cloud Run env
      binding (2026-08-02).** The code states an ENVIRONMENT VARIABLE NAME — a fact, and not a topic
      name. TypeScript and Python record it on `pubsub:env-name`; Terraform records
      `env { name = "X" value = <resource reference> }` on `terraform:cloud-run-env` (HCL and
      `.tf.json` alike); `cross-stack/cloud-run-env.ts` joins them, because it spans two stacks.
      **Four conditions, all required:** the variable name is literally equal on both sides (no
      case folding, no prefixes); the Terraform `value` REFERENCES a `google_pubsub_topic`/
      `google_pubsub_subscription` whose own `name` is a literal; the Cloud Run service is tied to
      the code by the EXISTING declared-name correspondence in `infrastructure-links.ts` (reused,
      not re-derived) and the reading file is one that code node contains; and the two sides agree
      on kind. Anything else — a literal `value = "deal-events"` that merely spells a real topic, an
      interpolated value, an unmatched service, a one-character difference — resolves to nothing.
      Evidence from both sides, provenance `framework-convention` ("Cloud Run env becomes
      `process.env`" is a platform convention, not a parsed fact). The env readers stay narrow:
      `process.env.X ?? 'fallback'` and `os.getenv("X", "default")` state two candidate values and
      are refused; a destructured or aliased `process.env` is refused; type-level wrappers (`!`,
      `as`, parentheses) are unwrapped; Python is gated on a module-level `import os`. Fixture:
      `cross-stack` gained an env-bound Cloud Run job and two `process.env` publishers, one that
      resolves and one whose Terraform value is a literal and must not (+11 graph golden lines,
      +3 impact golden lines). Tests: 13 correlation + 11 language-adapter fact.
- [~] Correlate Terraform resources with app components — topic names and Cloud Run service/job
  names are correlated on exact declared-name equality, and **env bindings now correlate too**
  (`cross-stack/cloud-run-env.ts`, above): an `env` whose value REFERENCES a literally-named
  Pub/Sub resource joins to code reading that exact variable name, on a service already tied to
  that code. **Image names are still not**: an image is interpolated in practice, and deriving an
  app name from a registry path is guesswork about a value we do not control (documented in
  `docs/engineering/language-adapters.md`).
- [x] Golden tests: publisher/consumer fixture (§42.2) — `packages/test-kit/fixtures/cross-stack`
      now carries a real pair on top of the NestJS consumer: `worker/src/deal-publisher.ts`
      (`@google-cloud/pubsub`, publishing to `deal-events`) and `api/app/events.py`
      (`google.cloud.pubsub_v1`, publishing to `deal-events` and consuming
      `deal-events-worker`), pinned by `packages/test-kit/goldens/cross-stack.graph.txt`. Two
      deliberate non-matches are baked in: `topic:deal-event` (one character off the Terraform
      topic — a node exists because the code really publishes to it, but no `DEPLOYED_AS` edge),
      and the pre-existing `no-such-package` Cloud Run service.

## Story 16.4 — Astro & HTML adapter

> **ASTRO AND STANDALONE HTML DELIVERED 2026-08-02.** ADR-0014 settled the approach: no
> Astro grammar exists and none is needed — the adapter splits the `---` fences and uses the TS
> compiler API for the frontmatter and the `html` grammar for the template, both already sanctioned
> by ADR-0008. `astro-site` is pinned by a full-pipeline golden.

**Acceptance criteria**

- [~] Astro: pages, layouts, components, API routes, content collections, server actions, imported
  client components (§15.2) — pages, layouts, components, API routes, content collections and
  `client:*` directives are done (the directives as recorded facts; §12 has no hydration concept,
  so no edge is claimed). **Server actions (`astro:actions`) are NOT detected, and the reason is
  concrete rather than pending**: the canonical `export const server = { x: defineAction({…}) }`
  puts the call in an object-literal property, which the TypeScript adapter does not record — see
  the task list.
- [x] HTML focuses on relationships to templates, components, scripts, forms, routes, assets — not
      treated as full app architecture (§30). A standalone `.html`/`.htm` adapter now exists
      (`packages/language-adapters/src/html/`) alongside the `.astro` template half, with the
      `html-site` fixture and a full-pipeline golden. It holds the §30 line strictly: no symbols, no
      components, no pages, no routes — the only node an HTML document produces is its own file
      node, because which URL it is served at depends on a web server the adapter never sees.

**Tasks**

- [x] Implement `.astro` parsing (frontmatter imports + template component usage) —
      `packages/language-adapters/src/astro/`, passing `runLanguageAdapterContractChecks` with an
      empty skip list, plus a hostile-content suite (§42.5).
- [x] Implement Astro framework enrichment — `packages/framework-adapters/src/astro/`: file-based
      pages, `src/pages/api` routes, `defineCollection`/`getCollection` content collections.
- [x] Golden tests on Astro fixture — `packages/test-kit/goldens/astro-site.graph.txt`, through the
      real pipeline.
- [x] **Standalone HTML relationship extraction shipped (2026-08-02)** —
      `packages/language-adapters/src/html/`, in the production roster, with the `html-site` fixture
      (§42.2) and a full-pipeline golden. Passes `runLanguageAdapterContractChecks` with an **empty
      skip list** plus a hostile-content suite (§42.5). It is deliberately the smallest adapter in
      the package: §30 says HTML is read for relationships and NOT treated as application
      architecture, so it declares no symbols, components, pages or routes — the only node an
      `.html` file produces is its own file node. Repository-local `script[src]`/`link[href]`/asset
      references become `ImportReference`s (→ real `IMPORTS` edges through the shared resolver);
      `a[href]`, `form[action]` and anything with a scheme or root-relative path become facts on the
      `CallFact` channel under `receiverName: 'html:template'`, with `<form method>` recorded.
      **Follow-up for the cross-stack owner:** `URL_RECEIVERS` in
      `cross-stack/cross-stack-adapter.ts` accepts `astro:template` and `http:client` only, so HTML
      forms and links do not yet correlate with routes. Adding `'html:template'` is a one-line
      change; it was not made here because `cross-stack/**` is another agent's territory this pass.
- [~] **`client:*` hydration directives recorded (2026-08-02); server actions NOT detected.**
  A `client:*` directive on a component tag becomes a fact
  (`receiverName: 'astro:client-directive'`, `calleeName: 'client:load'`, component in
  `stringArguments[0]`) and **no edge**: it says the component ships to and runs in the browser,
  which §12 has no node or edge type for, and the "page renders component" relationship is already
  the component reference. Modelling client islands properly is a §12 addition (domain-provenance).
  **Server actions are declined for a concrete reason**: the canonical
  `export const server = { createDeal: defineAction({…}) }` puts the call in an object-literal
  property, which `typescript/parse-call-facts.ts` does not record, so no action name reaches the
  graph. Detecting only the non-canonical `export const x = defineAction(…)` shape would emit nodes
  for something Astro does not wire. Closing it means widening the TypeScript adapter's call-fact
  extraction to object-literal initializers — a TS-adapter change, out of this pass's territory.
- [x] **The two template readers are aligned (2026-08-02).** What points where now lives once, in
      `html/reference-targets.ts`, shared by the `.html` adapter and the `.astro` template reader —
      the duplicate copies were the cause of the divergence, so removing the duplication is the fix
      rather than a tidy-up. A **navigation** attribute (`a[href]`, `area[href]`, `form[action]`) is
      never a file and stays a `CallFact`; an **asset** attribute whose value is a repository-local
      relative path becomes an `ImportReference`, exactly as the HTML adapter always did. A
      root-relative value stays a `CallFact` in both readers: in Astro `/logo.svg` means
      `public/logo.svg`, and mapping a URL root to a directory on disk is a deployment convention
      neither reader can see. A specifier naming no scanned file resolves to nothing, so a wrong
      resolution base costs a MISSING edge, never a wrong one. Astro also now walks the template in
      document order, matching the HTML reader.
      Golden: `astro-site` regenerated scoped. The `IMPORTS` edge from the item below is one of six
      changed lines; the fixture gained `src/scripts/deal-filter.ts` (file node, its exported
      symbol, two `CONTAINS`) referenced by `<script src="../scripts/deal-filter.ts">`, while a
      root-relative `<img src="/hero.svg">` and a CDN `<script src>` in the same file produce no
      edge at all. `cross-stack` is byte-unchanged — its only asset reference is root-relative.
      Tests: 2 added to `astro/astro-template.test.ts`.

## Story 16.5 — Java language adapter + Spring

> **DELIVERED 2026-08-02.** Java and Spring are in the production roster and `java-spring` is
> pinned by a full-pipeline golden. ADR-0008's open question — whether syntax-level Java facts
> reach the §41.1 recall target for Spring DI — is **answered for constructor injection**: the
> fixture's full DI chain (`DealController → DealService → DealRepository`) resolves to `USES`
> edges without a type checker, because Java's implicit same-package visibility is modelled
> explicitly by the adapter. **Field `@Autowired` injection was closed on 2026-08-02** and needed
> no more than syntax after all: the Java adapter records each field's declared type as a neutral
> `java:field-type` fact and the Spring adapter resolves annotated ones. Setter injection
> (`@Autowired public void setX(X x)`) is still NOT covered.

**Acceptance criteria**

- [x] Java adapter indexes classes, interfaces, methods, imports, calls (§30) —
      `packages/language-adapters/src/java`, passing `runLanguageAdapterContractChecks` with an
      empty skip list, plus a hostile-content suite (§42.5). Enums and records are reported as
      `class` (§12.1 has no enum type); fields become `symbol` nodes.
- [~] Spring enrichment: components, controllers, routes, beans/DI, scheduled tasks, Pub/Sub
  consumers (§C12) — stereotypes (`@RestController`/`@Controller`/`@Service`/`@Repository`/
  `@Component`/`@Configuration`/`@SpringBootApplication`), request mappings with class+method path
  composition, constructor-injection DI, `@Scheduled` jobs, `@Bean` factory methods and field
  `@Autowired`/`@Inject`/`@Resource` injection are done. **Setter injection and Pub/Sub consumers
  are NOT implemented** — the latter still waits on Story 16.3's code-side Pub/Sub vocabulary.

**Tasks**

- [x] Implement Java parsing (tree-sitter WASM per ADR-0008).
- [x] Implement Spring annotation enrichment — `packages/framework-adapters/src/spring/`.
- [x] Golden tests on Java/Spring fixture — `packages/test-kit/goldens/java-spring.graph.txt`.
- [~] **`@Scheduled`, `@Bean` and field `@Autowired` shipped (2026-08-02); Pub/Sub consumer
  annotations still open.** `@Scheduled` → a `job` node with a `TRIGGERS` edge to the annotated
  method (the schedule **expression** is not modelled — §12.1 has no place for a cron string, and
  `fixedDelayString = "${app.delay}"` is a property reference we would have to resolve; it stays in
  the job's evidence). `@Bean` → a `service` node contained by its factory method, named by
  `@Bean("x")` or the method name; §12.1 has no "bean" type and the bean's declared type is the
  method's return type, which the Java adapter does not report and this adapter will not infer; a
  `@Bean` outside a stereotyped class is warned about and skipped. Field `@Autowired`/`@Inject`/
  `@Resource` → a `USES` edge to the field's declared type, resolved from the Java adapter's new
  `java:field-type` facts, with `framework-convention` provenance and the annotation as evidence;
  it is gated on the annotation on purpose, because emitting an edge for every field would bury
  real dependencies under every `String`, `Clock` and `Logger`, and it skips the edge when
  constructor injection already produced one. **Pub/Sub consumer annotations still need Story
  16.3's code-side vocabulary.** All three pinned by `java-spring` fixture additions
  (`DealsConfiguration.java`, `DealExpiryJob.java`) and `spring/spring-adapter.test.ts`.
- [x] **Receiver-qualified calls bound, boundedly (2026-08-02).** The "field type → class node"
      pass now exists and covers fields, method/constructor parameters, and explicitly typed
      locals: `packages/language-adapters/src/java/java-types.ts` builds a per-method scope
      (class fields overlaid with the method's own bindings) and `java-calls.ts` emits a `calls`
      reference to the **type**, which assembly resolves into a `CALLS` edge from the calling method
      to the declaring class. Scope stops exactly there — picking `DealService.findAll` out of the
      overload set needs a type checker, so the method-level target is not claimed and the
      `CallFact` still carries the method name. A receiver the file never declares (static call,
      chained call, `var`, undeclared name) produces nothing. One reference per collaborator per
      body, not per call site. Adds six `CALLS` edges to the `java-spring` golden — the full
      controller → service → repository call chain that was previously invisible.
- [x] **Block scoping is real (2026-08-02).** `JavaTypeScope` is no longer a flat map; each binding
      carries the source range over which Java says it is visible and a lookup asks "which binding
      covering this offset was declared last". That IS Java's rule (JLS §6.3) rather than a model of
      it, so there is no traversal state and no dependence on walk order. A local's scope end is
      read from its declaration's PARENT node — the enclosing `block`, or the `for_statement` for a
      loop init clause, or the `switch_block_statement_group` for a `case` arm — which is again the
      rule itself. Both consumers (`java-calls.ts`, `java-pubsub.ts`) now resolve at the call site's
      offset.
      **Honest note on the golden**: this changed **zero existing lines** in `java-spring`. The old
      claim that it "changes receiver resolution for every existing `CALLS` edge" was wrong — the
      fixture had no shadowing to get wrong. So the capability is proven properly instead of
      asserted: `java-scoping.test.ts` (7 cases) pins the corrections per call site, which is where
      a wrong target is visible at all, including the case a flattened map got actively wrong (a
      later sibling block capturing an earlier block's call). The fixture gained `DealAuditLog` and
      `DealService.describe`, whose two same-named locals in sibling blocks produce two `CALLS`
      edges to two different collaborators; under the flattened map both calls resolved to the
      second declaration. Golden: `java-spring` regenerated scoped, 20 added lines, 0 changed, all
      traceable to the new class and the new method.
      Also fixed: `var` was being bound as though it were a type name, so `var x = f(); x.g()`
      emitted a `calls` reference to a "type" called `var`. It is Java's inference keyword and the
      grammar reports it in the `type` field; resolving what it stands for needs a type checker
      (§35), so it now binds nothing — which is what this file's own comment already claimed.

## Story 16.6 — Cross-stack relationship detection

> **DELIVERED 2026-08-02** (graph correlation; the §C16 impact + review E2E closed in the final
> pass, see the task list) — `packages/framework-adapters/src/cross-stack/`, registered
> **last** in the production roster because it correlates nodes the other framework adapters
> produce. That required one change in repository-intelligence: `enrichWithFrameworks` now rebuilds
> the `CodeGraph` view before each adapter instead of capturing it once, so an adapter sees its
> predecessors' output. Language facts still win every id collision, and all seven pre-existing
> goldens were verified byte-unchanged under both the old and new rosters.
>
> **The provenance decision, stated plainly:** cross-stack edges carry `framework-convention`,
> never `static-analysis`. They are _not_ parsed facts — nothing in an Astro template says which
> handler serves `/api/deals`, and nothing in a `.tf` file names the package it deploys. They are
> exact correspondences of an identifier both sides literally declare, which makes them platform
> conventions, and `framework-convention` is §12.3's deterministic category for exactly that.
> Three constraints keep them reviewable rather than merely plausible: correspondence must be
> **exact** (normalization is limited to query string, fragment and trailing slash — `/api/deal`
> does not match `/api/deals`, and there is no similarity scoring anywhere); a value must have been
> **literally declared** (a Terraform `name` that interpolates is skipped entirely, not guessed);
> and evidence is attached from **both sides** so a reviewer can open both files. The negative
> cases are pinned by `cross-stack-adapter.test.ts`.

**Acceptance criteria**

- [~] Cross-language edges detected per §C13 — **Astro → FastAPI** and now **TypeScript
  `fetch('<literal>')` → FastAPI** (`USES` → `api-endpoint`), **Terraform → Cloud Run / Pub/Sub**
  (`DEPLOYED_AS`), and **code ↔ Pub/Sub topics and subscriptions across TypeScript, Python and
  NestJS** are delivered. **Spring ↔ Pub/Sub is NOT** — Story 16.3 covers TS and Python only, so a
  Spring publisher still has nothing to correlate. **FastAPI → PostgreSQL is NOT**: no adapter
  produces database nodes.
- [~] A polyglot fixture analyzes as one system (§C12/§C16) — `packages/test-kit/fixtures/cross-stack`
  (Astro + a plain TS API client + FastAPI + a Python Pub/Sub publisher/consumer + a TS Pub/Sub
  publisher + NestJS consumer + Terraform) is pinned by a full-pipeline golden showing every
  correspondence kind, including a TypeScript publisher and a Python consumer resolving to the
  SAME `topic:deal-events` node. **Spring and a shared TS package are not in it**, and there is
  **no cross-stack impact or review golden** — only the graph.
- [x] All reasoning engines remain language-independent — the cross-stack adapter emits only §12
      vocabulary and reads only the assembled graph; no engine branches on language.

**Tasks**

- [x] Implement HTTP-call ↔ route matching across adapters (URL correlation with evidence) —
      `cross-stack/template-calls.ts` + `route-index.ts`.
- [x] Implement topic-name correlation between publishers, consumers and Terraform resources —
      delivered as `DEPLOYED_AS` from the code-side `topic`/`subscription` node to the Terraform
      resource, **not** as a direct `PUBLISHES`/`SUBSCRIBES_TO` from the publisher symbol to the
      Terraform resource. Reason: the code-side node already carries the publisher's
      `PUBLISHES`/`SUBSCRIBES_TO` edge, so a second one would double-count the same relationship,
      and `handler → SUBSCRIBES_TO → topic:x → DEPLOYED_AS → terraform:…` traverses in two hops. If
      the impact engine turns out to need the one-hop edge, revisit here — it is a modelling
      choice, not a limitation. `infrastructure-links.ts` needed **no change** for Story 16.3: it
      already mapped `pubsub-topic → topic` and `pubsub-subscription → subscription`, so the new
      code-side nodes correlated the moment they existed. The subscription half is now exercised
      for the first time, and `cross-stack-adapter.test.ts` pins its near-miss and wrong-kind
      refusals alongside the topic ones.
- [x] **Build the polyglot monorepo fixture (§42.2) with golden graph, impact and review results
      (2026-08-02).** Fixture, graph golden, two impact goldens and one review golden. The fixture
      is now genuinely four-stack: Astro + TypeScript + Python/FastAPI + Java/Spring + Terraform.
- [x] **E2E test: cross-stack impact prediction + cross-stack review (§C16) (2026-08-02).**
      `workspace-engine/src/cross-stack-goldens.test.ts` runs the REAL pipeline
      (`initializeWorkspace` → `performIndexRun` → `submitSpecification` →
      `buildAnalysisForSpecification` → `approveAnalysis` → `runReviewPipeline`) on the
      `cross-stack` fixture, mirroring `analysis-goldens.test.ts`. Two specifications live in
      `test-kit/src/evaluation.ts` as `CROSS_STACK_EVALUATIONS`, kept SEPARATE from
      `SAMPLE_EVALUATIONS` so the §41 accuracy metrics against ts-basic keep measuring what they
      measured. Each carries `crossStackNames` grouped by stack, so a failure says which boundary
      was not crossed, and every claim is asserted against ground truth as well as pinned. - `deal events topic` — the strong case. One `deal-events` concept surfaces the Python
      publisher (`publish_deal`), the TypeScript publisher (`publishDealCreated`), the Java
      publisher (`DealEventBridge.republishDeal`), the NestJS consumer, the subscription and the
      Terraform resource (`deal_events`). Four stacks from one requirement. - `deals api surface` — reaches the Terraform Cloud Run service from application code via the
      16.6 name correspondence (`deals-web` is both an npm package and a declared service name). - Review over a four-stack working-tree diff: `matched` in Python, `missing` on the Cloud Run
      service, `unexpected` in Java, TypeScript and Terraform. The test asserts findings span
      ≥ 3 stacks (derived from `finding.filePaths`, not from names).
- [x] **Follow-up for impact-modeling, found by the E2E:** `EXPOSES` is not in `IMPACT_EDGE_TYPES` _(**CLOSED 2026-08-02**: `EXPOSES` added to `IMPACT_EDGE_TYPES`. A spec naming only the Python `list_deals` now reaches `route:GET /api/deals` and, one hop further via `USES`, the TypeScript `loadDeals` caller — two languages joined through a route neither file names in the other's terms. The asserted `unreachedNames` gap was converted into asserted REACHED names; cross-stack impact golden regenerated scoped.)_
      (`application/src/build-impact-model/candidate-traversal.ts`), so a specification naming
      `list_deals` never reaches `route:GET /api/deals` — and therefore never reaches the front-end
      caller that reaches the same route by `USES`. One un-walked edge stands between the Python
      endpoint and its Astro/TypeScript consumer. Adding it is an impact-engine decision with its
      own analysis-golden churn, not an adapter one. Asserted as a KNOWN GAP
      (`unreachedNames` in `CROSS_STACK_EVALUATIONS`) so it fails loudly if it silently changes.
- [x] **Golden serializer fidelity — CLOSED 2026-08-02.** `serializeReviewGolden` keyed findings by node NAME, so two distinct `deals-web` nodes (the npm package and the Terraform Cloud Run service) collapsed into identical lines and one was invisible. Findings are now keyed `category|name|nodeId|requirementId`; both review goldens regenerated scoped and the two `deals-web` findings are now distinguishable. The scoped-regeneration helper was also unified into test-kit (`shouldUpdateGolden`) so all three golden suites honour `UPDATE_GOLDENS=<fixture>` identically.
- [x] **`<form method>` is recorded (2026-08-02)** by both the Astro reader and the new HTML
      adapter, on the existing `keywordStringArguments` payload (`{ method: 'POST' }`) — no widening
      of `CallFact` was needed. Uppercased because HTTP method tokens are case-insensitive
      (RFC 9110) while route nodes spell them uppercase; that is normalization, not interpretation.
      An **absent** `method` records nothing: HTML's default is GET, but applying a default is the
      correlating adapter's call, and this channel records what the document says.
      **Follow-up for the cross-stack owner:** the correlation does not read the field yet, so an
      `action` match still links every verb at the path. The fact it needs is now there.
- [x] **`<a href>` → `page:` navigation links are emitted (2026-08-02, `page-links.ts`).** The old
      reasoning measured the wrong thing: whether a relationship crosses a stack boundary is not
      what makes it architecture. A link from one page to another is a dependency the repository
      STATES, it breaks when the target page's route changes, and "what points at this page?" is
      exactly a question impact analysis exists to answer. Matched under the endpoint rules
      unchanged — `a[href]`/`area[href]` only, exact normalized path equality against a declared
      `page:` node, `framework-convention` provenance, evidence from both sides, and no self-links.
      `<form action>` is excluded: a form submits to a handler, which the `api-endpoint` matching
      already covers.
      **Edge type is a compromise and is flagged as one.** §12.2 has no navigation edge, so this
      emits `USES` — the same type the endpoint correlation directly above already emits for the
      same class of fact, rather than inventing a stronger claim (`DEPENDS_ON`) or a false one
      (`CALLS`, which a hyperlink is not). **The type I would want is `NAVIGATES_TO`**; adding it is
      a §12 roster change and therefore domain-provenance's decision, not this adapter's. Raised
      here rather than taken.
      Golden: one line in `astro-site` — `USES|symbol:src/layouts/Base.astro#Base->page:/`, from the
      `<a href="/">` in the shared layout. No other fixture declares both a page node and a link to
      it, so nothing else moved.
      Also folded in (one line, same file, no golden change): `template-calls.ts` matched
      `astro:template` and `http:client` but not `html:template`, so a `.html` form never
      correlated with a route. Left over from when `cross-stack/**` was another agent's territory;
      it is this agent's now, and leaving the endpoint side inconsistent while making the page side
      consistent would have been worse than fixing both.
- [x] `fetch('<literal>')` in TypeScript now feeds HTTP correlation.
      `language-adapters/src/typescript/parse-http-calls.ts` records it as a `CallFact` under the
      `http:client` receiver marker — the same trick `astro:template` and `terraform:reference`
      use, a receiver name that cannot be a JavaScript identifier, so no call-convention adapter
      can match it by accident. `template-calls.ts` consumes it under the identical exactness rules
      and now prefers the call's `enclosingSymbolNodeId` as the edge source, so the edge starts at
      the function that made the call rather than at the file. An enclosing id the graph does not
      know is discarded, never turned into a dangling edge. Proven end-to-end by
      `cross-stack/web/src/lib/api.ts` in the golden, with an interpolated URL and an absolute URL
      as baked-in non-matches.
- [x] `fetch` records its VERB when stated literally (`fetch(url, { method: 'POST' })`) on the same `keywordStringArguments` channel `<form method>` uses — no `CallFact` widening was needed after all — and the cross-stack adapter matches that verb exactly. With no stated method the reference names a path, not a verb, so it still links every verb there (guessing HTML's GET default is not the language adapter's call). Proven in the cross-stack golden: `createDeal` → POST only; `loadDeals` → GET and POST.
      documented limitation `<form action>` has. Fixing both together means widening the `CallFact`
      contract (`keywordStringArguments` is reserved for languages with keyword arguments), which
      is a `packages/language-adapters/src/types.ts` change and therefore a contract decision.
- [~] **Python HTTP-client URLs: shipped for the shape that can correlate, refused for the shape
  that cannot (2026-08-02, `python/python-http.ts`).** The root-relative shape IS real in Python
  — but only ever relative to something. `client.get('/api/deals')` resolves against the
  client's `base_url`, and a service's `base_url` normally names ANOTHER service, so recording
  every root-relative path would link `/api/deals` on some external origin to this repository's
  own `/api/deals` whenever the two share a path. That is a confident, plausible, wrong edge,
  and it is a different situation from `fetch('/api/deals')` in a browser bundle, which is
  same-origin **by definition**. Python has no ambient origin, so "root-relative" alone is not
  the correlatable property the decline note and the re-request both assumed.
  What IS provable is a client this module handed the application object to: `TestClient(app)`,
  `httpx.AsyncClient(app=app)`, `httpx.AsyncClient(transport=ASGITransport(app=app))`. There the
  origin is not unstated — it is stated, and it is this repository. So those record, gated on an
  import of a real client module (`python-http-bindings.ts`, the same import-proves-identity
  discipline the Pub/Sub detectors use, so a local `SomeWrapper(app=app)` binds nothing).
  **No fixture had to be invented**: `fastapi-app/tests/test_deals.py` already contained
  `client = TestClient(app)` + `client.get("/deals/")`, which now produces
  `USES|symbol:tests/test_deals.py#test_list_deals->route:GET /deals`. A negative fixture was
  added — `app/clients.py` calls `registry.get("/deals")` through a `base_url`'d httpx client
  against a path the app itself serves — so a future widening of the rule shows up in the golden
  as a wrong edge instead of hiding. Golden: `fastapi-app`, 8 added lines, 0 changed. Tests:
  `python/python-http.test.ts` (8, six of them refusals).
  **Still open, and this is the honest boundary**: a service-to-service client with a stated
  `base_url` is not correlated even when the target service lives in this repository, because
  nothing in the source says `http://deals-api` is the FastAPI app in `api/`. Closing that needs
  deployment knowledge (Terraform service names, compose files), not more parsing.
  Found and fixed on the way: `stringLiteralText` returned an f-string's literal PREFIX as if it
  were a complete value, so `f"/deals/{id}"` read as `/deals/` and `f"deal-{env}"` would have
  read as `deal-` for a Pub/Sub topic name. Interpolated strings now state no value (§35).
- [x] **`axios` and `$fetch` are detected; wrapped clients are still not, and that distinction is
      the point (2026-08-02, `typescript/http-clients.ts`).** The old reason — "proving a callee IS
      an HTTP client needs type resolution" — was wrong for the common case: **the import proves the
      identity**. `import axios from 'axios'` states that the name is the axios module; no type
      checker is consulted, and it is the same evidence `pubsub-bindings.ts` and the Java adapter's
      `importedTypes` already rely on. Recorded: `axios.<verb>(url)`, an `axios.create()` instance's
      `<verb>(url)` (provably still axios), `axios(url[, {method}])`, `$fetch`/`ofetch` imported
      from `ofetch`, and the CommonJS `require` spelling of each — verb from the method name where
      there is one, else from a literal `method` in the options object, else nothing.
      **Deliberately still undetected**: a genuinely wrapped client (`apiClient.get(…)` over
      `./lib/api-client.js`) — the import proves where the name came from, not that the module
      behind it speaks HTTP, and following it needs cross-file type resolution (§35); Nuxt's
      auto-imported global `$fetch`, which has no import to prove anything; and
      `axios.request(config)`, whose URL is a property of an object literal. Tests: 7 added to
      `typescript/http-calls.test.ts`, including a look-alike local module, an unbound
      axios-shaped object, and a §42.5 prototype-method case. No golden moved — no fixture uses
      axios.
