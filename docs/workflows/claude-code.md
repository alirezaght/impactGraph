# Workflow: ImpactGraph + Claude Code

End-to-end loop (PRD §10.4, §21.1, Epic H): specification → analysis → human approval → export →
implement with Claude Code → review. ImpactGraph analyzes and reviews; the agent implements.
ImpactGraph never implements the feature and never lets an agent bypass the approval gate.

## Privacy

The whole loop below is deterministic and offline — no AI provider is required (PRD §8). In
`external-agent` privacy mode (§9.4) ImpactGraph itself sends nothing anywhere: the exported
context is a local file/stdout document, and what the coding agent does with it is governed by
the agent's own configuration, not ImpactGraph's.

## Session

From the repository root:

```bash
# one-time setup
impactgraph init                 # scaffolds .impactgraph/ (config, architecture, aliases, rules)
impactgraph index                # deterministic knowledge graph, fully local

# 1. analyze the specification
impactgraph analyze feature.md --format json
#    → note the analysis id, e.g. analysis-spec-feature-v1-xxxx

# 2. inspect and approve (the mandatory human gate, §40.3)
impactgraph approve analysis-spec-feature-v1-xxxx

# 3. export the implementation context for the agent
impactgraph export --format markdown > implementation-context.md
```

Then hand the context to Claude Code:

```bash
claude "Implement the feature described in implementation-context.md.
Respect the architecture constraints and expected tests listed there.
Do not touch components outside the required/likely impact list without saying so."
```

The Markdown export contains the §38.1 sections the agent needs: required/likely/possible
impacts with file paths and confidence, expected tests/migrations/infrastructure changes,
architecture constraints from `.impactgraph/rules.yml`, open warnings, and the exact repository
snapshot the plan was approved against. `--format json` produces the same content as the
schema-stable §22 document (`schemas/export/implementation-context.v1.schema.json`).

## Review the implementation

After the agent has made its changes:

```bash
impactgraph review working-tree --format markdown   # or: review commit
echo $?    # 0 = no discrepancies · 3 = discrepancies found (human judgment, §43.6)
```

The review compares the actual diff against the approved analysis: matched, missing, unexpected,
divergent, unverifiable findings; per-requirement coverage estimates; §27 rule violations. A
discrepancy is never automatically a defect — decide, then either fix, re-run, or record the
deviation.

In CI, exit code 3 (`reviewDiscrepancies`) is distinct from errors (§20), so a pipeline can
choose to warn, block, or route to a human.

## Iterating

- Spec changed? `impactgraph analyze feature.md` creates a new specification version and a new
  analysis — approve again; the old analysis stays immutable.
- Cache deleted? `impactgraph index` rebuilds it; approvals and specs live in
  `.impactgraph/artifacts/` and survive (ADR-0006).
