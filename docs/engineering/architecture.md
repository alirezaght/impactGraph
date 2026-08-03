# Source Architecture

This is the proposed source architecture for ImpactGraph. No product source exists yet — this
document guides implementation and is enforced from day one by the ESLint boundaries config
(see `dependency-rules.md`) and the quality gates (`pnpm quality:gates`). Decisions here are
recorded in ADR-0004 (ports and adapters), ADR-0006 (hybrid persistence), and ADR-0013
(pnpm monorepo). Product basis: PRD §29 (core technical architecture), §C15 (four engines).

## Monorepo layout

pnpm workspace, Node 22, TypeScript strict. Apps are thin composition roots; packages carry all
behavior.

```
impactgraph/
├── apps/
│   ├── vscode-extension/
│   │   ├── src/                    # Extension shell: activation, command registration,
│   │   │   ├── activation/         #   activation events, composition root (wires ports→adapters)
│   │   │   ├── commands/           #   maps VS Code commands (PRD §19) to application use cases
│   │   │   ├── views/              #   tree data providers (impact tree, architecture, review)
│   │   │   ├── webview-host/       #   webview panel lifecycle, message pump, CSP
│   │   │   ├── workers/            #   spawns/monitors the indexing child process (PRD §32, §33)
│   │   │   └── test/               #   @vscode/test-electron integration tests
│   │   └── webview/                # React + Cytoscape UI (graph view PRD §18.4, evidence panel §18.5)
│   │       ├── src/components/     #   graph canvas, impact tree, evidence panel, filters
│   │       ├── src/messaging/      #   typed postMessage client — imports packages/contracts ONLY
│   │       └── src/state/          #   view state; renders and requests, never decides
│   ├── cli/
│   │   └── src/                    # impactgraph init|index|status|architecture|analyze|approve|
│   │       ├── commands/           #   export|review|config (PRD §20); JSON + Markdown output
│   │       └── exit-codes.ts       #   distinct exit codes per PRD §20
│   └── mcp-server/
│       └── src/
│           ├── tools/              # impactgraph.submit_specification, .review_implementation,
│           │                       #   .analyze_impact, config tools (PRD §21, §Z7)
│           └── server.ts           # tool registration; schemas come from packages/contracts/tools
├── packages/
│   ├── domain/                     # Pure, dependency-free (no I/O, no Date.now, no framework types)
│   │   └── src/
│   │       ├── specification/      # Specification, Requirement, OpenQuestion, versions (PRD §11)
│   │       ├── repository/         # knowledge-graph node/edge types (PRD §12.1–12.2), snapshots (§23.1)
│   │       ├── architecture/       # contexts, components, roles, architecture rules (PRD §27)
│   │       ├── provenance/         # Provenance enum (§12.3), evidence, confidence, supersession
│   │       ├── impact/             # ImpactAnalysis, RequirementImpact, likelihood (PRD §13)
│   │       ├── review/             # review result categories (§24.1), coverage, drift, deviations
│   │       └── errors/             # typed domain errors (no string throws)
│   ├── application/                # Use cases + ports; depends on domain only
│   │   └── src/
│   │       ├── analyze-specification/     # requirement extraction, clarification, readiness (§C2, §C10)
│   │       ├── index-repository/          # orchestrates scan→parse→assemble→bind (see repository-analysis.md)
│   │       ├── build-impact-model/        # concept matching, traversal, confidence, evidence validation (§13–14)
│   │       ├── approve-impact-model/      # approval, immutability, supersession (§40.3)
│   │       ├── review-implementation/     # diff→graph comparison, coverage, drift (see implementation-review.md)
│   │       ├── export-implementation-context/  # ImplementationContext assembly (PRD §22)
│   │       ├── manage-configuration/      # generate/validate/apply/rollback config, audit (§Z2, §Z7, §Z12–Z14)
│   │       └── ports/              # FileSystemPort, GitPort, IndexStorePort, ArtifactStorePort,
│   │                               #   ModelProvider (PRD §8), ClockPort, IdentifierPort, LoggerPort,
│   │                               #   CancellationToken, ProgressPort
│   ├── contracts/                  # Zod schemas + generated JSON Schema; standalone DTOs (no domain import)
│   │   ├── src/
│   │   │   ├── webview/            # versioned extension↔webview messages (ADR-0009)
│   │   │   ├── tools/              # MCP tool request/response schemas (PRD §21)
│   │   │   ├── cli/                # machine-readable CLI output schemas (PRD §20)
│   │   │   ├── artifacts/         # persisted artifact schemas (see artifact-versioning.md)
│   │   │   ├── config/             # .impactgraph/*.yml schema (PRD §17), custom detection rules (§Z8)
│   │   │   └── ai/                 # AI response DTO schemas validated on receipt
│   │   └── schemas/                # generated JSON Schema files — COMMITTED, diffed in schema-compat CI job
│   ├── repository-intelligence/    # Repository Intelligence Engine: scanner, hasher, graph assembly,
│   │   └── src/                    #   incremental indexer, framework-detection orchestration (§15, §32)
│   ├── language-adapters/          # LanguageAdapter implementations (PRD §30, ADR-0008)
│   │   └── src/                    #   typescript/, python/, java/, html-astro/, terraform/, fallback/
│   ├── framework-adapters/         # FrameworkAdapter implementations (PRD §31)
│   │   └── src/                    #   nestjs/, express/, fastapi/, astro/, terraform-gcp/, cloud-run/, pubsub/
│   ├── git/                        # Git CLI adapter (ADR-0007): snapshots (§23.1), diff parsing (§24)
│   ├── persistence/                # SQLite index store + JSON artifact store + YAML config store (ADR-0006)
│   │   └── src/                    #   index/, artifacts/, config/, migrations/
│   ├── ai-inference/               # ModelProvider implementations, prompt assembly, redaction,
│   │   └── src/                    #   output validation, privacy-mode enforcement (PRD §8–9, ADR-0010)
│   │       └── providers/          #   the ONLY place provider SDKs may be imported
│   └── test-kit/                   # dev-dependency only: never imported by shipped code
│       ├── fakes/                  # in-memory port implementations (clock, git, stores, provider)
│       ├── builders/               # test-only builders for domain objects and DTOs
│       └── fixtures/               # fixture repositories (PRD §42.2), one dir per fixture-repo name
├── scripts/quality/                # effective-loc checker, secret scan (see quality-gates.md)
└── docs/                           # engineering docs, ADRs
```

## Why this shape — challenges to the early flat draft

**Why a monorepo, not a single `src/`.** PRD §29 mandates three delivery surfaces — the VS Code
extension, `apps/cli`, and `apps/mcp-server` — over one shared core, and §20 requires the CLI to
"use the same core engine". A flat single-`src/` extension repo forces either copy-paste of the
engine into the CLI/MCP server or a tangle of conditional `vscode` imports. Separate packages with
enforced boundaries are the only structure where "no `vscode` outside the extension shell" is
checkable by `pnpm lint` rather than by review vigilance. (ADR-0013.)

**Why no generic `shared/` package.** PRD §29's sketch includes `packages/shared`; we deliberately
reject it. A `shared/` package is a dumping ground with no owner, no dependency direction, and no
answer to "where does this belong?" — everything eventually depends on it and it depends on
everything. Its legitimate contents already have homes: typed errors and common value types live in
`packages/domain`; cross-boundary DTOs live in `packages/contracts`; test helpers, fakes, and
builders live in `packages/test-kit` (dev-only, so helper code can never leak into shipped
bundles). If a candidate for "shared" fits none of those, that is a design smell to resolve, not a
package to create.

**Why use-case-first, not technical-type-first, in `packages/application`.** A `services/` +
`models/` + `utils/` layout scatters one feature across parallel trees, defeats the 300-effective-LOC
policy (files grow because "the service" is the only home), and gives the 13 owning agents
(`bounded-contexts.md`) no clean ownership lines. One directory per use case
(`analyze-specification/`, `review-implementation/`, …) mirrors the PRD's own workflow (§10), keeps
each change local, and makes the vitest `application` project map one-to-one onto behavior.

## Public entry points

- Every package exports only via its root `index.ts`. Deep imports
  (`@impactgraph/domain/src/impact/...`) are forbidden and lint-blocked (`dependency-rules.md`).
- The webview has exactly one dependency on workspace packages: `packages/contracts`.
- `packages/contracts/schemas/` holds the generated JSON Schemas — committed, regenerated by build,
  and diffed by the `schema-compat` CI job so contract drift is visible in review (PRD §17 requires
  a documented JSON Schema for configuration).
- Test fixtures: `packages/test-kit/fixtures/<fixture-repo-name>` (e.g.
  `fixtures/express-basic`, `fixtures/nestjs-app`, `fixtures/fastapi-service`,
  `fixtures/terraform-gcp`, `fixtures/monorepo-multistack` — roster per PRD §42.2).
  Test-only builders: `packages/test-kit/builders/`. Never use the ImpactGraph repo itself as the
  primary analyzer fixture (main skill §6).

## Mapping the four PRD engines (§C15) onto packages

| Engine (PRD §C15)              | Primary packages                                                                                   | Use-case directories                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Repository Intelligence Engine | `repository-intelligence`, `language-adapters`, `framework-adapters`, `git`, `persistence` (index) | `application/index-repository`                                                    |
| Clarification Engine           | `domain/specification`, `ai-inference`                                                             | `application/analyze-specification`                                               |
| Impact & Review Engine         | `domain/impact`, `domain/review`, `git` (diff)                                                     | `application/build-impact-model`, `approve-impact-model`, `review-implementation` |
| Agent Integration Engine       | `ai-inference`, `contracts/tools`, `apps/mcp-server`                                               | `application/export-implementation-context`, `manage-configuration`               |

All four engines read and write the same language-neutral Repository Knowledge Graph
(`domain/repository`, PRD §C14) — adapters emit facts into it; engines never see language
specifics. Details: `repository-analysis.md`, `language-adapters.md`, `implementation-review.md`,
`provenance-model.md`.
