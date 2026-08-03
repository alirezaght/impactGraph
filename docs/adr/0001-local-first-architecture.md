# ADR-0001: Local-First Architecture

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

ImpactGraph is defined by the PRD as "a local-first VS Code extension that converts a proposed
software specification into an evidence-backed architectural impact model" (PRD §1). The privacy
model (PRD §9) requires that in `local-only` mode "no source code or repository metadata leaves the
machine", and even in the default `selected-snippets` mode only minimal, user-visible evidence may
be sent to a configured model. The storage architecture (PRD §28) places all generated state in
non-version-controlled local storage and explicitly defers any shared backend (PRD §28.3). Security
requirements (PRD §35) and the reliability rule that AI failure must degrade features rather than
break indexing (PRD §34) both presume a deterministic engine that runs entirely on the developer's
machine.

The decision to be made: where does analysis, storage, and AI orchestration run?

## Options Considered

### Option A — Fully local engine, optional outbound AI calls (chosen)

All indexing, graph construction, impact prediction, and review comparison run on the developer's
machine, inside the three apps (`apps/vscode-extension`, `apps/cli`, `apps/mcp-server`) over one
core. Network traffic exists only when the user configures an AI provider, and is governed by the
privacy modes of PRD §9.

- Pros: satisfies PRD §9 exactly; works offline; no server cost, uptime, auth, or tenancy work; the
  deterministic core (PRD §47.7) needs no provider at all; trivial adoption in security-sensitive
  organizations; repository content never becomes server-side liability.
- Cons: every user machine pays the full indexing cost (PRD §33: 5,000 files < 2 min); no team-shared
  graph or cross-developer cache in V1; heavy repositories are bounded by laptop resources; upgrade
  and migration logic ships to every install instead of one server.

### Option B — Hosted analysis backend

Repository is uploaded (or a daemon streams facts) to a service that builds and stores the graph.

- Pros: shared team graph and history for free; server-class hardware for indexing; centralized
  schema migrations; simpler thin clients.
- Cons: directly violates PRD §9.1 and §28.3; source code custody becomes our problem (SOC2,
  retention, tenancy); requires accounts and billing before the product has proven value; latency on
  every interaction; the PRD explicitly scopes a team backend out of the MVP.

### Option C — Hybrid: local engine plus mandatory sync service

Local analysis, but artifacts and index synchronize through a hosted store.

- Pros: keeps analysis local while enabling team features earlier.
- Cons: "mandatory sync" still transmits architecture metadata externally, which PRD §9.2 treats as
  sensitive; doubles the persistence surface (local + remote consistency); premature — PRD §28.3
  only asks that the storage abstraction _allow_ future synchronization, not implement it.

## Decision

Option A. ImpactGraph V1 is fully local. Deterministic analysis (Repository Intelligence Engine and
the deterministic parts of Impact & Review) must work with zero network access. Outbound traffic is
limited to explicitly configured AI providers under the four privacy modes (PRD §9), and
`external-agent` mode sends nothing at all. The persistence layer (`packages/persistence`) keeps a
storage abstraction clean enough that a future team backend (PRD §28.3) is an added adapter, not a
rewrite.

## Consequences

- Positive: privacy invariants are architectural, not policy; the product is testable end-to-end in
  CI with fixture repositories (PRD §42.2) and no service mocks; zero operational infrastructure to
  run; the MCP server can be trusted by external agents because it holds no remote state.
- Negative: no cross-team knowledge sharing beyond what is committed to `.impactgraph/` (PRD §28.1);
  performance work targets commodity laptops (PRD §33 budgets bind us); features that would be easy
  server-side (org-wide drift dashboards) are out of reach until ADR-0011 is revisited.

## Revisit Trigger

Concrete demand for team-shared analysis (multiple developers needing one live graph) that
committed `.impactgraph/` artifacts cannot satisfy — revisit together with ADR-0011.

## Links

- PRD §1, §9, §28, §33, §34, §35, §47.7
- Related: ADR-0006 (local persistence shape), ADR-0010 (provider abstraction), ADR-0011 (no hosted
  backend V1)
- docs/engineering/privacy-and-security.md, docs/engineering/architecture.md
