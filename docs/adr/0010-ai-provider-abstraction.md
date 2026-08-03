# ADR-0010: AI Provider Abstraction

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

PRD §8 is explicit: "ImpactGraph must not depend on one AI provider" and must define an internal
provider interface — the PRD sketches `ModelProvider.generateStructuredOutput<T>(request, schema)`.
Supported strategies include user-configured API providers, local model endpoints, **and no
provider at all**: in `external-agent` mode (PRD §9.4) an agent like Claude Code invokes ImpactGraph
tools and ImpactGraph itself sends nothing externally. The deterministic core must remain useful
without any model (PRD §8, §47.7), AI failure must degrade features rather than break indexing or
review (PRD §34), and provider inconsistency is a named product risk (PRD §43.5). Privacy modes
(PRD §9) govern what may ever reach a provider.

## Options Considered

### Option A — Direct SDK usage where needed

Call the Anthropic/OpenAI/local SDK from whichever engine needs inference.

- Pros: fastest to write; full access to provider-specific capabilities (caching, tool use,
  streaming) without lowest-common-denominator loss.
- Cons: violates PRD §8 and §47.6 directly; privacy enforcement (redaction, snippet minimization,
  prompt preview) would be reimplemented per call site — exactly where it must never be
  inconsistent; `external-agent` mode has no clean representation; testing engines requires
  provider mocks everywhere.

### Option B — Adopt a heavyweight abstraction framework (LangChain-style)

- Pros: many providers prewired; retry/streaming plumbing included.
- Cons: huge dependency surface inside a privacy-critical boundary — auditing what such a framework
  sends, logs, or caches is harder than writing our narrow port; our interface is one method with
  schema-validated output, which frameworks wrap in abstractions we do not need; framework churn
  becomes our churn.

### Option C — Own narrow `ModelProvider` port, provider SDKs confined to adapters (chosen)

The port lives in `packages/application`; implementations live only in
`packages/ai-inference/providers/*` (enforced by lint — `.claude/CLAUDE.md` rule 3). One method
shape, per PRD §8: `generateStructuredOutput<T>(request: ModelRequest, schema: JsonSchema)`.

- Pros: PRD §8 satisfied literally; the privacy pipeline (mode check → evidence selection →
  redaction → prompt preview) lives once, in `packages/ai-inference`, in front of every provider;
  `external-agent` mode is simply the absence of a provider — engines expose their needs as data
  and the MCP layer serves them (PRD §21); engines are tested with a deterministic fake provider
  from `packages/test-kit`; structured-output-only keeps responses validatable (ADR-0009) and
  reference-checkable (ADR-0002).
- Cons: lowest-common-denominator interface — provider-specific strengths (prompt caching, native
  tool use, streaming partial output) are unavailable to engines unless the port grows deliberately;
  structured-output quality varies by provider and the port cannot hide that (PRD §43.5 — mitigated
  by schema validation and downgrade, not solved); each new provider is an adapter we write and
  contract-test ourselves.

## Decision

Option C. Binding rules:

1. Provider SDKs import only inside `packages/ai-inference/providers/*`; engines and apps see the
   port.
2. Every response is Zod-validated against the request schema (ADR-0009), then reference-checked
   against the deterministic graph (ADR-0002); failures downgrade features, never crash analysis
   (PRD §34).
3. The privacy pipeline executes before any provider call in every mode; `local-only` and
   `external-agent` configurations make outbound calls unrepresentable, not merely skipped.
4. API keys live in VS Code SecretStorage (CLI: environment/OS keychain) — never in artifacts,
   config files, or logs (PRD §35).
5. Provider adapters carry contract tests with recorded/fake transports; no live-API tests in CI.

## Consequences

- Positive: Claude Code, Cursor, OpenAI-compatible agents, local models, and no-model operation all
  work against one seam (PRD §8's list); privacy review has a single choke point
  (`/review-privacy`); engines never know which provider ran — or whether one ran at all.
- Negative: we forgo provider-native optimizations until the port grows a capability-negotiation
  mechanism; a new capability (e.g. streaming clarification questions) forces a port design
  discussion instead of a quick SDK call — that friction is the point, but it is friction.

## Revisit Trigger

A feature that demonstrably needs a capability the port cannot express (streaming, provider-side
tool use) — extend the port deliberately; never bypass it. Persistent cross-provider
structured-output failures (PRD §43.5) trigger a port-level mitigation review instead.

## Links

- PRD §8, §9, §21, §34, §35, §43.5, §47.6–8
- Related: ADR-0001 (nothing leaves the machine by default), ADR-0002 (downgrade rule), ADR-0004
  (port placement), ADR-0009 (schema validation), ADR-0011
- docs/engineering/ai-provider-boundary.md, docs/engineering/privacy-and-security.md
