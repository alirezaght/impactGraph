---
name: language-adapter-development
description: Use when building or changing a language adapter (TypeScript/JavaScript, Python, Java, HTML/Astro, Terraform) or framework adapter (NestJS, Express, FastAPI, Astro, Terraform/GCP, Cloud Run, Pub/Sub) in packages/language-adapters or packages/framework-adapters — parsing, fact extraction, framework enrichment, the fallback adapter, or AI-generated custom detection rules.
---

# Language & Framework Adapter Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill covers `packages/language-adapters` and `packages/framework-adapters`, owned by the
single `language-adapter` agent (adapter discipline is shared; per-language knowledge lives here
and in adapter proposals). Start every new adapter with `/design-language-adapter` +
`.claude/templates/language-adapter-proposal.md`.

## Purpose

Adapters are the only components that understand syntax. They translate source files into facts
in the language-neutral Repository Knowledge Graph (PRD §C14) so that the Clarification, Impact &
Review, and Agent Integration engines stay completely language-independent. Multi-stack analysis
is a v1 requirement (PRD §C12): one repo containing Astro + FastAPI + Spring + Terraform is one
architectural system, not four language projects.

## When to use

- Implementing/extending an adapter behind the PRD §30/§31 interfaces.
- Adding framework enrichment (routes, DI, publishers/consumers, infra resources).
- The fallback adapter, or validation/execution of custom detection rules (PRD §Z8).
- Cross-stack relationship detection (PRD §C13: Astro → FastAPI, Terraform → Cloud Run,
  Spring → Pub/Sub consumer).

## When NOT to use

- Indexer orchestration, hashing, cancellation (→ `repository-analysis-development`).
- Changing the graph vocabulary itself (→ `domain-provenance-development` + human approval).
- Diff-to-graph comparison logic (→ `implementation-review-development`; adapters only provide
  `analyzeDiff` fragments).

## Required context

1. PRD §30, §31 (interfaces below), §15.2 (per-framework detection lists), §Z8 (custom detection
   rules), §C12–C14 (multi-stack, cross-stack, language-neutral graph), §12 (node/edge vocabulary).
2. ADR-0008 (parser strategy — status _Proposed_, revisit trigger: first Python adapter milestone)
   and `docs/engineering/language-adapters.md`.

## The contract (PRD §30/§31 — implement exactly)

```ts
interface LanguageAdapter {
  id: string;
  supportedExtensions: string[];
  detectProject(context: RepositoryContext): Promise<DetectionResult>;
  indexFiles(files: RepositoryFile[], context: IndexingContext): Promise<GraphFragment>;
  analyzeDiff(diff: GitDiff, context: AnalysisContext): Promise<GraphChangeSet>;
}

interface FrameworkAdapter {
  id: string;
  languageIds: string[];
  detect(graph: CodeGraph): Promise<FrameworkDetection>;
  enrich(graph: CodeGraph, context: FrameworkContext): Promise<GraphFragment>;
}
```

## Architectural rules

- **Facts only, language-neutral only.** Adapters emit PRD §12 node/edge types (`Controller`,
  `Route`, `Job`, `Topic`, `Subscription`, `Terraform resource`; `IMPORTS`, `CALLS`, `EXPOSES`,
  `PUBLISHES`, `SUBSCRIBES_TO`, `DEPLOYED_AS`, `CONFIGURES`, `MIGRATES`). A NestJS-specific node
  type or a `tree-sitter` AST leaking into `GraphFragment` is a boundary violation — framework
  identity is carried by `framework-convention` provenance and evidence, not by new types.
- Parsers per ADR-0008: TypeScript/JavaScript via the TS compiler API; Python, Java, HCL
  (Terraform), Astro, HTML via tree-sitter **WASM** (no native bindings). Deviating requires
  updating ADR-0008 first.
- The **fallback adapter** handles unsupported files with filesystem/text-level evidence (paths,
  names, references) so unknown stacks degrade gracefully instead of vanishing (PRD §34).
- Adapters depend on application ports + domain + contracts only; no SQLite, no `vscode`, no
  network, no AI. Anything an adapter cannot prove deterministically is not its job to guess.
- Framework enrichment reads the already-built `CodeGraph` — it must not re-parse files that the
  language adapter indexed.

## Domain rules

- Every emitted node/edge carries deterministic provenance (`static-analysis` for parsed code,
  `configuration` for manifests/HCL, `framework-convention` for convention-derived facts),
  evidence IDs pointing at file + range, and the snapshot ID from the indexing context.
- Framework scope per PRD §15.2: NestJS modules/controllers/providers/guards/routes + DI edges;
  Express routers/middleware/handlers; FastAPI routers/endpoints/Pydantic models/background
  tasks; Astro pages/layouts/API routes/content collections; Terraform modules/resources/
  Cloud Run services & jobs/Pub/Sub topics & subscriptions/IAM/secret bindings.
- Custom detection rules (PRD §Z8) — e.g. an internal `@company/messaging` `@Subscribe` decorator
  producing a subscriber node — must be versioned, schema-validated, explainable, testable
  against fixtures, removable, and their output clearly distinguished from built-in adapters.
  Rule execution lives in the adapter layer; rule authoring belongs to the Agent Integration
  Engine.
- HTML focuses on relationships (templates, components, scripts, forms, routes, assets), not on
  treating HTML as an application architecture language (PRD §30).

## Security & privacy rules

- Never execute repository code to detect anything: no importing repo modules, no running build
  configs, no `terraform` CLI (PRD §35). Parse only.
- Repository content is untrusted (PRD §42.5): a malicious decorator name, comment, or HCL string
  must at worst produce a wrong fact, never code execution, path traversal, or a crash that kills
  the index run. Tree-sitter error recovery + per-file try/catch with recorded warnings.
- Adapters send nothing anywhere; evidence excerpts they record must respect redaction limits so
  later AI features cannot leak more than intended.

## Testing requirements

- Vitest `analyzers` project (`pnpm test:analyzers`). **Fixture-repo golden tests are mandatory**
  (PRD §42.2/§42.3): every adapter capability is proven by a fixture (TypeScript Express, NestJS,
  FastAPI, Java, Astro, Terraform GCP, Cloud Run, Pub/Sub publisher+consumer, monorepo, migration
  workflow) with pinned expected nodes/edges in `packages/test-kit`.
- `analyzeDiff` gets its own goldens: sample diffs → expected `GraphChangeSet`.
- Custom detection rules ship with fixture tests demonstrating match and non-match cases.
- Golden updates are reviewed diffs, never blind regeneration; a golden change without an adapter
  change is a red flag.

## Common failure modes

- Adapter writes framework types into the shared graph (a `NestJSModule` node type) instead of
  neutral types + `framework-convention` provenance.
- Facts emitted without evidence ranges, making the evidence panel and §14 confidence signals
  useless downstream.
- tree-sitter native bindings used for speed — breaks the WASM decision in ADR-0008 and
  portability.
- Enrichment re-parsing source files instead of reading the `CodeGraph`.
- Overbroad custom rule (matches every import) accepted because validation only checked syntax,
  not match breadth (PRD §Z13: excessively broad match patterns are invalid).
- Cross-stack edges guessed by name similarity and labeled `static-analysis` — name-heuristic
  links are at best inference material for the impact engine, not adapter facts.

## Checklist

- [ ] `language-adapter-proposal.md` completed; PRD §15.2/§30/§31 scope quoted, not paraphrased
- [ ] Emits only §12 vocabulary; provenance/evidence/snapshot on every fact
- [ ] Parser strategy matches ADR-0008 (or ADR updated first, human-approved)
- [ ] Fixture repo + goldens added/updated deliberately; malicious-content fixture covered
- [ ] Fallback behavior verified for files the adapter cannot parse
- [ ] `pnpm test:analyzers` and `pnpm quality:gates` green

## Definition of done

Main-skill definition of done, plus: goldens prove every claimed detection; the engines consume
the new facts with zero language-specific branching; and partial support (some files unparsed)
is visibly reported, not silently absorbed.
