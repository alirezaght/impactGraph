# ADR-0009: Versioned, Validated Boundary Contracts

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

ImpactGraph has five kinds of typed boundaries: webview messages (extension host ↔ React UI), MCP
tool payloads (PRD §21, §29.4: "stable command contracts"), CLI JSON output consumed by CI and
agents (PRD §20, §29.3), persisted artifacts that must remain readable across versions (ADR-0006,
PRD §47.16: "use versioned configuration formats"), and AI structured output, which PRD §47.8 and
§34 require validating against schemas with references to nonexistent nodes rejected. Each boundary
crosses a trust or lifetime gap: a webview is a separate untrusted context, an MCP client is an
external agent, an artifact written today is read by next year's code, and an LLM response is
untrusted by definition (ADR-0002, ADR-0010).

## Options Considered

### Option A — Shared TypeScript types only (compile-time trust)

- Pros: zero runtime cost; no schema duplication; refactors propagate by the compiler.
- Cons: types erase at runtime — an MCP client, a stale artifact, or an LLM can send anything and
  the type system will not notice; no versioning story at all; PRD §34/§47.8 validation requirements
  simply unmet.

### Option B — Interface-description languages (JSON Schema hand-written, OpenAPI, or protobuf)

- Pros: language-neutral artifacts; protobuf gives real schema-evolution tooling; OpenAPI suits
  HTTP APIs.
- Cons: none of our boundaries is an HTTP API and only MCP is cross-language (and MCP itself speaks
  JSON Schema, which we can emit); hand-written JSON Schema drifts from the TS types that use it;
  protobuf adds codegen and binary formats that contradict human-inspectable JSON artifacts
  (ADR-0006); heavier than the problem.

### Option C — Zod schemas as source of truth, versioned, validated at both ends (chosen)

`packages/contracts` holds standalone DTO schemas per boundary — `contracts/webview`,
`contracts/tools` (MCP), `contracts/cli`, `contracts/artifacts`, `contracts/config` — each carrying
an explicit schema version. TS types derive via `z.infer`; JSON Schema is generated from Zod where
an external representation is needed (MCP tool schemas, AI structured-output requests per the
`ModelProvider` port's `JsonSchema` parameter, PRD §8).

- Pros: one definition yields runtime validation + static types + JSON Schema; validation is
  symmetric (sender validates before emit, receiver validates on receipt — catching our own bugs,
  not just foreign input); explicit versions make artifact migration and MCP compatibility
  checkable (`schema-compat` CI job); contracts depend on zod only, so the webview can import them
  without touching domain (ADR-0004).
- Cons: runtime validation cost on hot paths (graph payloads to the webview must be budgeted, PRD
  §33); DTO ↔ domain mapping is deliberate ongoing work in application/adapters; version discipline
  (when to bump, how long to read old versions) requires process, not just tooling; Zod-to-JSON-
  Schema generation has edge cases that constrain which Zod features we may use.

## Decision

Option C. Rules with teeth:

1. Every persisted artifact, webview message, MCP payload, CLI JSON output, and AI response is
   schema-versioned and Zod-validated at the boundary — no `as` casts across a boundary.
2. `packages/contracts` depends on zod only. Mapping to/from domain types lives in application and
   adapters, never in contracts.
3. AI structured output passes schema validation _and then_ the deterministic-graph reference check
   (ADR-0002): valid shape with unknown node IDs is downgraded, not accepted.
4. Contract version bumps require human approval and a `schema-compat` check demonstrating old
   artifacts still load (see `.claude/CLAUDE.md`, "When human approval is mandatory").

## Consequences

- Positive: boundary bugs surface as validation errors with paths, not as corrupted state; PRD
  §29.4 contract stability becomes testable (`test:contract` project); artifacts written by V1 stay
  readable because versions are explicit; MCP tool schemas are generated, never hand-maintained.
- Negative: a permanent mapping layer and validation tax; contributors must resist importing domain
  types into contracts even when shapes coincide; schema-version bookkeeping is real overhead on
  every boundary change.

## Revisit Trigger

If validation cost measurably breaks PRD §33 interaction budgets on large graph payloads, introduce
sampled/trusted-path validation for the webview boundary only — the external boundaries (MCP, CLI,
artifacts, AI) are never exempt.

## Links

- PRD §8, §20, §21, §29.3–29.4, §33, §34, §47.8, §47.16
- Related: ADR-0002 (the reference-check gate), ADR-0004 (contracts' place in the dependency
  graph), ADR-0006 (artifact versioning), ADR-0010 (AI output validation)
- docs/engineering/data-contracts.md, docs/engineering/artifact-versioning.md
