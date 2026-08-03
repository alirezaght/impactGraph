# ADR-0014: HCL (Terraform) and Astro Parsing Strategy

- **Status:** Accepted
- **Date:** 2026-08-02
- **Deciders:** Project maintainer, Claude Code

## Context

ADR-0008 fixed the parser strategy: TypeScript/JavaScript via the TS compiler API, and Python,
Java, **HCL (Terraform)**, **Astro**, and HTML via tree-sitter **WASM** — explicitly no native
bindings, for portability inside the VS Code extension host and a bundled CLI.

That decision assumed prebuilt WASM grammars would be obtainable for every listed language. On
2026-08-02 we installed `web-tree-sitter@0.26.11` plus the prebuilt grammar bundle
`tree-sitter-wasms@0.1.13` and enumerated what actually ships — 36 grammars including
`python`, `java`, `html`, `typescript`, `javascript`, `json`, `yaml`, `toml`:

> **Neither `hcl`/`terraform` nor `astro` is present.**

This is not a nuisance. PRD §15.2 names Terraform explicitly — modules, resources, Cloud Run
services and jobs, Pub/Sub topics and subscriptions, IAM and secret bindings — and PRD §C12–C13
make cross-stack edges (Astro → FastAPI, Terraform → Cloud Run, Spring → Pub/Sub) a v1
requirement. Terraform is load-bearing for the product's headline claim, not an optional stack.

Grammars exist upstream for both (`tree-sitter-hcl`, `tree-sitter-astro`), but as **source
grammars**, not published WASM artifacts. Compiling them requires the `tree-sitter` CLI plus
Emscripten or Docker at build time.

## Options Considered

### Option A — Add a build step that compiles the missing grammars to WASM

- Pros: keeps ADR-0008 literally intact; one uniform parsing mechanism for every non-TS language.
- Cons: introduces Emscripten/Docker into the build and CI, which every contributor and every CI
  lane must then have; the produced `.wasm` binaries are either committed (binary artifacts in
  git, reviewable by nobody) or rebuilt on every CI run (slow, and a supply-chain surface that a
  prebuilt npm package at least pins by version). A grammar compiler in the build chain is a
  large, permanent cost for two languages.

### Option B — Add another npm dependency that ships prebuilt HCL/Astro WASM

- **Verified 2026-08-02 while implementing the foundation:** `@tree-sitter-grammars/tree-sitter-hcl@1.2.0`
  **does** publish a prebuilt `.wasm`. No published Astro grammar with a prebuilt wasm was found.
- Pros: HCL keeps a real grammar — full HCL2 coverage including expressions, interpolation, and
  heredocs, none of which a hand-written scanner would ever track; the parse path stays identical
  to Python/Java/HTML, so one loader, one error-recovery story, one warning shape.
- Cons: one more supply-chain surface (a single-purpose grammar package, pinned by version); does
  nothing for Astro.
- **Note on the runtime pin:** the same investigation found that `tree-sitter-wasms@0.1.13` ships
  grammars with the legacy `dylink` section, which forced `web-tree-sitter` to be pinned to
  `^0.25.10`. Modern per-grammar packages (`tree-sitter-python@0.25`, `tree-sitter-java@0.23`,
  `tree-sitter-html@0.23`, and the HCL package above) ship `dylink.0` and would let us drop that
  pin. Migrating to per-grammar packages therefore solves HCL **and** the pin together.

### Option C — Terraform: a bounded, deterministic HCL block scanner in the adapter layer. Astro: compose the parsers we already have.

- **Terraform.** Terraform's surface that ImpactGraph actually needs is narrow and highly
  regular: top-level `resource "type" "name" { … }`, `module "name" { source = … }`,
  `variable`/`output`/`provider` blocks, and attribute assignments inside them. A bounded scanner
  that recognizes block headers, nesting depth, and `key = value` attributes covers §15.2 without
  interpreting expressions, functions, or interpolation — and anything it cannot parse becomes a
  recorded warning, exactly like a tree-sitter ERROR node. It never evaluates HCL, never runs
  `terraform`, and cannot be made to.
- **Astro.** An `.astro` file is TypeScript frontmatter delimited by `---`, followed by an
  HTML-like template. We already have both parsers: the TS compiler API (ADR-0008's choice for
  TS) for the frontmatter, and `tree-sitter-html` for the template. Astro needs **no new
  grammar** — it needs a splitter and two existing parsers.
- Pros: no new build tooling, no new dependency, no committed binaries; each piece uses a parser
  already sanctioned by ADR-0008; the HCL scanner's scope is small enough to be fully golden-
  tested against the `terraform-gcp` fixture.
- Cons: the HCL scanner is hand-written code we own and must maintain — it will not track HCL2
  language evolution the way a real grammar would, and complex expressions are deliberately out
  of scope (they become warnings, not facts). This is a genuine deviation from ADR-0008's "HCL
  via tree-sitter WASM" clause.

## Decision

**Split the two languages** — they turned out to be different problems, and the initial draft of
this ADR (which recommended a hand-written scanner for both) was written before the HCL grammar
package was confirmed to exist:

- **Terraform → Option B.** Add `@tree-sitter-grammars/tree-sitter-hcl`, a real grammar, loaded
  through the existing tree-sitter foundation. ADR-0008 stands unamended for HCL: it said "HCL
  via tree-sitter WASM", and that is exactly what this is. A hand-written scanner was the right
  answer only while no grammar was obtainable; writing one now would trade full HCL2 coverage for
  maintenance we own, to save a single pinned dependency. That is a bad trade for a stack PRD
  §15.2 names explicitly.
- **Astro → Option C.** No grammar exists to buy, and none is needed: an `.astro` file is
  TypeScript frontmatter delimited by `---` followed by an HTML-like template, and both parsers
  are already sanctioned by ADR-0008. Astro needs a splitter, not a dependency.

## Consequences

- **Installed and verified 2026-08-02**: `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` is a
  dependency of `packages/language-adapters`. Two artifacts ship in it —
  `tree-sitter-hcl.wasm` (generic HCL) and **`tree-sitter-terraform.wasm`** (the Terraform
  dialect, which is what §15.2 actually needs: `resource`/`module`/`provider` semantics rather
  than bare HCL blocks). Both were byte-checked and carry the modern **`dylink.0`** section, so
  they load under the pinned `web-tree-sitter@^0.25.10` and would also load under 0.26 — this
  grammar does not re-create the compatibility problem that forced the pin. Epic 16.1 is
  unblocked; prefer the `terraform` artifact over the generic `hcl` one.
- Worth doing in the same pass: migrating Python/Java/HTML to modern per-grammar packages would
  drop the `web-tree-sitter@^0.25.10` pin forced by `tree-sitter-wasms`'s legacy `dylink`
  sections. Not required for correctness today — recorded so the pin is a known, dated
  constraint rather than folklore.
- The Astro adapter must record which half produced each fact (frontmatter vs template) so
  evidence stays traceable, and must degrade to a warning when the `---` split is malformed
  rather than guessing at file structure.
- Revisit trigger: if the HCL grammar package proves unmaintained or its wasm stops loading,
  fall back to Option A (compile grammars in-build) rather than to a hand-written scanner — by
  then goldens will exist and a scanner would have to reproduce them exactly.

### Outcome (Story 16.1, 2026-08-02)

The decision held as written. The `terraform` artifact loads under the pinned
`web-tree-sitter@^0.25.10` and covers the §15.2 surface without a line of hand-written HCL
scanning. Two consequences are worth recording because they were not anticipated above:

- **`GrammarSource` now maps a grammar id to a package specifier**, not to a filename inside one
  bundle. That was implicit in "add another npm dependency"; it became explicit the moment two
  grammar packages coexisted (`src/tree-sitter/grammars.ts`). `parsers.test.ts` loads every id in
  the roster, so a specifier that stops resolving fails the analyzers suite rather than a user's
  index run.
- **The pin is still in place.** Migrating Python/Java/HTML to modern per-grammar packages — the
  "worth doing in the same pass" note above — was **not** done: it touches three working adapters
  and their goldens for no correctness gain today. It remains open, and the pin remains a dated,
  documented constraint rather than folklore.

### Addendum: Terraform's JSON syntax (`.tf.json`, epic-16, 2026-08-02)

`.tf.json` was previously unclaimed, with the recorded reason that reading it needs source
positions, `JSON.parse` has none, and a position-preserving reader would mean "a new parser
dependency and an ADR-0008 amendment".

**Neither turned out to be true, and this addendum records why no amendment is being made.**
`tree-sitter-wasms@0.1.13` — already a dependency, already loaded for Python, Java and HTML — ships
a prebuilt `tree-sitter-json.wasm`. Adding `json` to the grammar roster in
`src/tree-sitter/grammars.ts` is therefore not a new package, not a new parsing technology, and not
a deviation: ADR-0008 says non-TypeScript languages are parsed with tree-sitter WASM, and this is
exactly that. The document goes through the same loader, gets the same error-recovery handling, and
produces the same warning shape as every other grammar.

A hand-written JSON tokenizer was considered and rejected on this ADR's own reasoning. The decision
above chose a real grammar over a scanner for HCL because "writing one now would trade full …
coverage for maintenance we own, to save a single pinned dependency", and the revisit trigger says
explicitly to fall back to compiling grammars **rather than to a hand-written scanner**. A JSON
tokenizer would have been ~250 lines of parser we own — string escapes, number grammar, depth
limits, position tracking — to avoid adding one line to a roster. It would also have been _less_
accurate for the case that motivated the work: the CST exposes the `string_content` node, so a
Terraform reference written inside an interpolation (`"${google_pubsub_topic.x.name}"`) gets an
exact column, which offset arithmetic over a decoded string cannot give once escapes are present.

Consequences worth recording:

- The `json` grammar id is used by the Terraform adapter alone. `package.json` and `tsconfig.json`
  are **not** routed to it — the adapter registry matches the longest extension suffix, so
  `.tf.json`/`.tfvars.json` reach Terraform and a plain `.json` still reaches nobody.
- **Error recovery is refused rather than read through**, unlike the HCL path. In JSON the nesting
  IS the block structure: a missing brace does not corrupt one block, it silently re-parents every
  block after it, and reporting relabelled resources would be worse than reporting none. A
  recovered document is indexed at file level with a warning naming the line (PRD §34).
- Terraform's JSON syntax has no expression grammar — an expression is HCL inside a `${…}` string —
  so `terraform-interpolations.ts` lexes the interpolation body for dotted chains and hands the
  segments to the same `addressFromSegments` the HCL reader uses. One address rule, two syntaxes;
  a second copy of that rule is the thing most likely to drift, so there is not one.
