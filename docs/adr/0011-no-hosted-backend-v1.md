# ADR-0011: No Hosted Backend in V1

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

ADR-0001 establishes local-first as the architecture. This ADR records the sharper scope decision:
V1 ships **no hosted backend, no remote database, no Docker/Kubernetes deployment, and no custom
language server**. PRD §28.3 places a "hosted or self-hosted shared backend" outside the MVP while
requiring that "the storage abstraction must allow future synchronization". PRD §7 (non-goals) and
§47.13–14 (avoid microservices, avoid Neo4j) point the same direction. The temptation this ADR
exists to resist is real: team-shared graphs, org-wide drift dashboards, and centralized provider
proxies are all plausible features that a backend would enable — each one a reason someone will
propose building it early.

## Options Considered

### Option A — No backend of any kind in V1 (chosen)

Team sharing happens only through version control: `.impactgraph/` config, confirmed mappings, and
optional approved analysis summaries are committed (PRD §28.1) and travel with the repository.

- Pros: zero operational surface — nothing to deploy, monitor, patch, or breach; the privacy story
  (PRD §9, §35) stays maximally simple ("nothing leaves your machine unless you configure an AI
  provider"); all engineering effort lands on the four engines, which is where product success is
  defined (PRD §48); adoption requires no procurement, account, or security review.
- Cons: no live team-shared graph; every developer indexes locally (duplicate compute); cross-repo
  and org-level views are impossible; "approved model" distribution is limited to what fits
  reasonably in git.

### Option B — Optional self-hosted sync service

- Pros: team features without us running infrastructure; appeals to privacy-conscious orgs.
- Cons: we still design, build, secure, and support a server product — versioned sync protocol,
  auth, conflict resolution for append-only artifact stores (ADR-0002 supersession across
  machines is genuinely hard); "optional" doubles every persistence test matrix; PRD §28.3 asks
  only for abstraction headroom, not the service.

### Option C — Hosted SaaS backend from the start

- Pros: strongest long-term product position (team knowledge, history, dashboards); telemetry for
  quality metrics (PRD §41) would be easier to gather.
- Cons: contradicts PRD §28.3 and the local-first identity (ADR-0001); source-derived architecture
  metadata is sensitive — custody, tenancy, and compliance work would dominate the roadmap before
  the core product is proven; forces accounts/billing onto a tool whose wedge is "install and
  analyze locally in minutes" (§Z zero-configuration posture).

## Decision

Option A, with the boundary stated precisely:

- No hosted backend, no remote database, no Docker/K8s artifacts in this repository, and no custom
  language server (parsing strategy is in-process per ADR-0008) in V1.
- The persistence ports (ADR-0004, ADR-0006) remain the designated future seam: a team backend, if
  it ever comes, arrives as an additional artifact-store adapter plus a sync protocol — engines and
  apps unchanged.
- Team distribution in V1 is git: `.impactgraph/` committed knowledge (PRD §28.1) and exported
  reports (PRD §38).
- The MCP server (`apps/mcp-server`) is a **local process** speaking to local state — it is not a
  network service and must not grow remote-access features under this ADR.

## Consequences

- Positive: V1 scope is defendable against infrastructure creep — proposals for servers get
  answered by this ADR, not re-argued; security review surface stays "a VS Code extension and two
  local binaries"; CI needs no deployment lanes.
- Negative: team-oriented buyers see a gap; duplicate indexing cost per developer is accepted
  (bounded by PRD §33 budgets); some quality metrics (PRD §41) must be collected from opt-in local
  export rather than centrally.

## Revisit Trigger

Same as ADR-0001, made concrete: sustained user demand for live team-shared analysis that committed
`.impactgraph/` artifacts and exported reports demonstrably cannot satisfy, **and** the four engines
meeting their V1 acceptance criteria (PRD §40, §C16) — never before both.

## Links

- PRD §7, §9, §28.1, §28.3, §33, §35, §38, §40–41, §47.13–14, §48
- Related: ADR-0001 (the architecture this scopes), ADR-0004/0006 (the seam kept open), ADR-0010
  (provider calls are the only sanctioned network egress)
- docs/engineering/architecture.md, docs/engineering/privacy-and-security.md
