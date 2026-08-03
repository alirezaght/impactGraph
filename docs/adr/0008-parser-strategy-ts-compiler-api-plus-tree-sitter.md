# ADR-0008: Parser Strategy — TypeScript Compiler API plus tree-sitter

- **Status:** Accepted
- **Date:** 2026-07-31 (proposed) · 2026-08-02 (accepted at the Python adapter milestone)
- **Deciders:** Project maintainer, Claude Code setup

## Context

V1 must analyze multi-language repositories as one architectural system: TypeScript, JavaScript,
Python, Java, HTML, Astro, plus Terraform/HCL for infrastructure (PRD §6.1, §30, §C12). Language
adapters produce deterministic graph facts (`IMPORTS`, `CALLS`, `EXPOSES`, `DEPLOYED_AS`, …) behind
the `LanguageAdapter` port (PRD §30); everything downstream is language-neutral (§C14). Adapters
must never execute repository code (PRD §47.17) and must tolerate broken/partial files (PRD §34:
"allow analysis to continue with partial language support"). The question: one uniform parsing
technology, or the best tool per language?

## Options Considered

### Option A — TypeScript compiler API for TS/JS, tree-sitter (WASM) for the rest (proposed)

- Pros: for TS/JS — our richest and most common target — the compiler API gives **exact module
  resolution** (tsconfig paths, package exports, monorepo workspace links), real **symbol** binding
  (a `CALLS` edge to the right declaration, not a name match), and type-aware analysis where
  needed; tree-sitter gives the remaining languages a uniform, fast, **error-tolerant** concrete
  syntax tree with one adapter pattern; WASM grammars avoid native builds (consistent with ADR-0006
  and ADR-0007 reasoning); a filesystem/text-level fallback adapter still yields file nodes,
  directory containment, and config-reference evidence for anything else.
- Cons: two parsing technologies to learn, test, and keep under performance budgets; evidence
  quality is uneven across languages — TS/JS edges will be resolution-backed while Python/Java edges
  are syntax-backed heuristics, and confidence values (PRD §14) must honestly reflect that
  asymmetry; the TS compiler API is memory-hungry on large programs and needs careful program/host
  reuse to hit PRD §33 budgets.

### Option B — tree-sitter for everything, including TS/JS

- Pros: one uniform pipeline, one query language, one fixture format; extremely fast and
  error-tolerant; adding a language is mostly grammar + queries.
- Cons: **no module resolution and no symbol binding** — tree-sitter sees syntax only, so
  `import { DealService } from "@app/deals"` cannot be resolved to a file without reimplementing
  Node/TS resolution ourselves, and cross-file `CALLS`/`IMPLEMENTS` edges degrade to name-matching;
  for the product's flagship language that is a large, permanent accuracy sacrifice the impact
  engine would inherit (PRD §41.1 direct-impact recall target).

### Option C — Full compiler/toolchain per language (javac/JDT for Java, Jedi/Pyright for Python, …)

- Pros: maximal per-language accuracy, comparable to what the TS compiler API gives TS.
- Cons: each brings a runtime (JVM, Python interpreter) or a heavyweight server we must ship or
  discover on the user's machine — hostile to a zero-config local-first extension (ADR-0001, §Z);
  wildly different APIs multiply adapter cost; some routes skirt the "never execute repository
  code" rule (PRD §47.17) and each needs its own sandboxing story. Not a V1 posture.

## Decision (Accepted)

Option A: TypeScript compiler API inside the TS/JS adapter; tree-sitter WASM grammars behind the
same `LanguageAdapter` port for every other parsed language; the fallback adapter provides
filesystem/text-level evidence otherwise. Every edge records provenance `static-analysis` with a
confidence that reflects resolution-backed vs syntax-backed derivation (ADR-0002, PRD §14).

### What shipped at acceptance

- **Dependencies** (human-approved, in `packages/language-adapters`): `web-tree-sitter@^0.25.10`
  (runtime) and `tree-sitter-wasms@0.1.13` (dev — the prebuilt grammar bundle).
- **Compatibility constraint, discovered while building the loader:** the grammars in
  `tree-sitter-wasms@0.1.13` (the latest published version) are emscripten side modules carrying
  the **legacy `dylink` custom section**. `web-tree-sitter@0.26.x` removed support for it and
  fails with `need dylink section`; `0.25.10` is the newest runtime that reads both `dylink` and
  `dylink.0`. The runtime is therefore pinned to `^0.25.10` for as long as this grammar bundle is
  the source of grammars. See the open question below.
- **Grammars actually available and wired:** `python`, `java`, `html`
  (`TREE_SITTER_GRAMMARS` in `src/tree-sitter/grammars.ts`). `tree-sitter-wasms` also ships
  `typescript`/`javascript`, which we deliberately do not use — TS/JS goes through the compiler
  API, per this ADR.
- **Loader shape:** initialization is lazy (first parse, never import time — adapters are
  constructed eagerly and activation has a 500 ms budget, PRD §33); one `Parser` + `Language` is
  cached per grammar per process; grammar bytes come from an injectable `GrammarSource` so a
  bundled host can supply its own; a missing grammar, an unreadable `.wasm`, or a parse failure
  becomes a recorded warning, never a throw; `ERROR`/`MISSING` recovery nodes are tolerated and
  reported (PRD §34).
- **Validated by:** the Python adapter (`packages/language-adapters/src/python`) and the FastAPI
  framework adapter, the shared §42.1 adapter contract suite (Python skips no check — it is the
  first adapter whose parser reports unparseable content rather than silently succeeding), a
  hostile-content suite (§42.5), and the committed `fastapi-app.adapters` graph golden (§42.3).

### Grammars that are NOT available — open question (deliberately not decided here)

`tree-sitter-wasms@0.1.13` contains **no HCL/Terraform grammar and no Astro grammar**. Story 16.1
(Terraform) and Story 16.4 (Astro) therefore cannot be built on the currently installed grammar
source. The options, none chosen here, all need human approval because they change dependencies:

1. **Add per-grammar packages.** Modern tree-sitter grammar packages publish their own `.wasm`
   (verified: `@tree-sitter-grammars/tree-sitter-hcl@1.2.0` ships one; so do
   `tree-sitter-python@0.25`, `tree-sitter-java@0.23`, `tree-sitter-html@0.23`). These are built
   with `dylink.0` and would additionally free the runtime pin, at the cost of one dependency per
   language and a migration of the three grammars above.
2. **Keep `tree-sitter-wasms` and vendor the missing grammars** as committed `.wasm` artifacts —
   avoids new dependencies but makes us the maintainers of a binary blob.
3. **Do not parse HCL/Astro as syntax at all**: handle Terraform with a text/structure-level
   reader and Astro by splitting frontmatter to the TS compiler API plus the HTML grammar.

No published tree-sitter **Astro** grammar with a prebuilt `.wasm` was found on npm at
acceptance time, so option 1 does not obviously cover Astro; option 3 may be the only route
there. This is recorded, not resolved.

**Still open, carried forward from the proposal:**

1. **Java accuracy needs.** Spring-heavy services (PRD §C12) rely on annotations, DI wiring, and
   classpath resolution that tree-sitter queries only approximate. Whether syntax-level facts plus
   the framework adapter (PRD §31) reach acceptable recall, or Java needs richer tooling, is
   unknown until measured against fixture repositories. The Python milestone is encouraging but
   Python has no classpath problem, so it does not settle this.

## Consequences

- Positive: best available accuracy where it matters most; uniform, safe, build-free story for the
  long tail; the port isolates any future substitution (per ADR-0004) to one adapter.
- Negative: two pipelines' worth of fixtures and golden tests (PRD §42.2–42.3); documented accuracy
  asymmetry across languages that UI and confidence values must not hide; WASM grammar versions
  become pinned dependencies we curate.
- Negative, learned at acceptance: the grammar bundle and the runtime are coupled through the
  emscripten side-module format, so `web-tree-sitter` cannot be upgraded independently while
  `tree-sitter-wasms@0.1.13` is the grammar source. Any runtime bump must re-run the loader suite
  (`packages/language-adapters/src/tree-sitter/parsers.test.ts`), which loads every claimed grammar.
- Packaging: the VS Code extension bundles its workers with esbuild, and esbuild does not copy
  `.wasm` files out of `node_modules`. `nodeGrammarSource` resolves the grammar by package
  specifier at runtime, which works from source and from a compiled `dist/` but assumes the
  package is present next to the running code. The extension must therefore either ship
  `node_modules/tree-sitter-wasms/out/*.wasm` (and `web-tree-sitter`'s own runtime `.wasm`) inside
  the `.vsix`, or inject a `GrammarSource` that reads bytes from an extension-relative path. That
  is a packaging task for the vscode-integration owner, not a change to this ADR.

## Revisit Trigger

The original trigger — **the first Python adapter milestone** — has fired, and this ADR was
accepted on its result: tree-sitter WASM parsed the FastAPI fixture into §12 vocabulary with
evidence ranges, tolerated hostile and broken input, and stayed off the activation path.

Two triggers remain:

1. **Story 16.1 (Terraform) or Story 16.4 (Astro) starting work** — one of the three grammar-source
   options above must be chosen and approved first; this ADR is amended with the choice.
2. **The first Java/Spring fixture measurement (Story 16.5)** — if syntax-level facts plus the
   Spring framework adapter miss the PRD §41.1 recall target, amend with richer Java tooling.

## Links

- PRD §6.1, §14, §30–31, §33, §34, §41, §42.2–42.3, §47.17, §C12–C14
- Related: ADR-0002 (provenance/confidence of parser output), ADR-0003 (why the TS compiler API is
  free for us), ADR-0004 (the port this lives behind), ADR-0006/0007 (no-native-builds lean)
- docs/engineering/language-adapters.md, docs/engineering/repository-analysis.md
