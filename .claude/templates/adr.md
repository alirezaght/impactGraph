# ADR-<NNNN>: <Title — imperative, decision-shaped, e.g. "Use Cytoscape.js for the graph view">

- **Status:** Proposed | Accepted | Superseded by ADR-<NNNN>
- **Date:** <YYYY-MM-DD>
- **Deciders:** <human owner(s)>, <consulted agents, e.g. product-architecture, domain-provenance>

## Context

_What forces this decision now? Cite PRD sections (§n / §Zn / §Cn), the epic (backlog/epic-NN-\*.md),
and any constraint from docs/engineering/architecture.md or an earlier ADR. State what breaks or
stalls if no decision is made._

_TBD_

## Options considered

_At least two real options. "Do nothing" counts when honest. No strawmen._

### Option 1: <name>

- Pros: <...>
- Cons: <...>
- Effect on knowledge-category separation / provenance (PRD §3, §12.3): <none | describe>
- Effect on privacy posture (PRD §9, §35): <none | describe>
- Effect on performance budgets (PRD §33): <none | describe>

### Option 2: <name>

- Pros: <...>
- Cons: <...>
- Effect on knowledge-category separation / provenance: <...>
- Effect on privacy posture: <...>
- Effect on performance budgets: <...>

### Option 3 (optional): <name>

- Pros / Cons: <...>

## Decision

_One paragraph: which option and the deciding argument. If tradeoffs remain unresolved, keep
Status = Proposed — never fake resolution (see docs/engineering/adr-process.md)._

We choose **<option>** because <deciding argument>.

## Consequences

- Positive: <...>
- Negative / accepted costs: <...>
- Packages and boundaries affected: <packages/..., apps/...>
- Backward compatibility: <artifacts, contracts, or config affected; migration needed? link
  .claude/templates/persistence-schema-change.md if yes>
- New human-approval obligations created: <none | describe (see CLAUDE.md mandatory-approval list)>

## Revisit trigger

_A concrete, observable event — not a date alone. E.g. "first Python adapter milestone" (ADR-0008)
or "per-workspace artifact store exceeds ~25 MB" (ADR-0006)._

_TBD_

## Links

- PRD: §<n>, §<Zn>, §<Cn>
- Epic / stories: backlog/epic-<NN>-<name>.md
- Related ADRs: ADR-<NNNN> <relationship: builds on / supersedes / constrained by>
- Docs to update on acceptance: docs/engineering/<page>.md
