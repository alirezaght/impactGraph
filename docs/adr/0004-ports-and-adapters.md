# ADR-0004: Ports and Adapters (Hexagonal) Architecture

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

The PRD demands one core engine consumed by three thin apps (VS Code extension, CLI, MCP server —
PRD §29), a core kept "independent from VS Code" (PRD §47.5), model-provider logic "behind an
interface" (PRD §47.6, §8), language and framework support as swappable adapters over one shared
knowledge graph (PRD §30–31, §C14), and a storage abstraction that permits a future backend
(PRD §28.3). Four engines (§C15) must all reason over the same graph while remaining language- and
provider-independent. We need a structure that makes these independence requirements checkable
rather than aspirational.

## Options Considered

### Option A — Ports and adapters with enforced dependency direction (chosen)

`packages/domain` (pure model, depends on nothing) ← `packages/application` (use cases + **ports**)
← adapters (`git`, `persistence`, `ai-inference`, `language-adapters`, `framework-adapters`,
infrastructure parts of `repository-intelligence`) ← apps as composition roots.
`packages/contracts` holds standalone Zod DTO schemas (ADR-0009); the webview imports contracts
only. Direction enforced by `eslint-plugin-boundaries`.

- Pros: PRD's interface requirements (§8, §30, §31) map one-to-one onto ports; every adapter is
  replaceable in tests via `packages/test-kit` fakes without touching engines; "no `vscode` outside
  the extension shell / no provider SDKs outside `packages/ai-inference/providers`" becomes a lint
  rule, not a review comment; the future team backend (§28.3) is a new persistence adapter.
- Cons: more packages and more indirection than the problem needs on day one; port design done badly
  produces leaky pass-through interfaces; mapping between domain types and contract DTOs is real
  ongoing work; contributors must learn the dependency rules before their first PR.

### Option B — Layered monolith (single package, folder conventions)

- Pros: fastest start; no cross-package plumbing; refactors are cheap while everything is one unit.
- Cons: nothing stops `import * as vscode` from reaching engine code except review attention — with
  three apps sharing the core, the first accidental coupling breaks the CLI and MCP server; PRD
  §47.5–6 independence cannot be machine-enforced; extracting packages later, after coupling exists,
  costs more than starting separated.

### Option C — Microservices / separate processes per engine

- Pros: hard isolation; per-engine scaling.
- Cons: explicitly rejected by PRD §47.13 ("avoid microservices"); absurd operational weight for a
  local-first tool (ADR-0001); IPC serialization of a large graph would dominate the performance
  budget (PRD §33). Note: running the _indexer_ in a worker process is a deployment detail inside an
  adapter, not a service boundary.

## Decision

Option A, with the dependency direction locked as follows and enforced by ESLint boundaries:
domain → nothing; application → domain; contracts → zod only; adapters → application ports + domain

- contracts; apps → application + adapters; webview → contracts only. Ports live in
  `packages/application`. Apps are composition roots and contain no business logic.

## Consequences

- Positive: the four engines (§C15) stay language-neutral because language adapters can only feed
  facts through the `LanguageAdapter` port (PRD §30); AI, git, and persistence are swappable and
  fake-able; architecture violations fail `pnpm lint` in CI rather than surfacing in review; the
  webview cannot grow a dependency on domain internals.
- Negative: sustained mapping overhead between domain types and contract DTOs; occasional
  over-abstraction pressure ("port for everything") that reviewers must push back on; new
  contributors pay a learning cost documented in docs/engineering/dependency-rules.md.

## Revisit Trigger

If port/adapter indirection demonstrably slows delivery without catching violations (e.g. ports
with exactly one adapter forever and no test fakes in use), collapse specific ports — case by case,
never the dependency direction itself.

## Links

- PRD §8, §28.3, §29, §30, §31, §33, §47.5–6, §47.13, §C14–C15
- Related: ADR-0007, ADR-0008, ADR-0009, ADR-0010 (each names a concrete port/adapter), ADR-0013
  (package layout that hosts this structure)
- docs/engineering/architecture.md, docs/engineering/dependency-rules.md,
  docs/engineering/bounded-contexts.md
