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
impactgraph graph                # optional: see the architecture — writes impactgraph-graph.html

# 1. analyze the specification
impactgraph analyze feature.md --format json
#    → note the analysis id, e.g. analysis-spec-feature-v1-xxxx

# 2. inspect and approve (the mandatory human gate, §40.3)
impactgraph graph --analysis analysis-spec-feature-v1-xxxx   # optional: SEE the blast radius first
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

## Look at the architecture without VS Code

```bash
impactgraph graph                          # → ./impactgraph-graph.html
impactgraph graph --group package          # or context (default) / application
impactgraph graph --format json            # the same view as contract-validated data
```

One self-contained local HTML file: inline SVG, **no JavaScript and no network requests at all**,
so it opens on an air-gapped machine and stays readable forever. It shows the architecture level a
human can read — contexts or packages with aggregated `IMPORTS ×12`-style arrows between them, not
every symbol — capped at the same 200-node budget the extension's graph uses (§33), with the
truncation stated on the page. Deterministic facts, AI-inferred interpretations and human-confirmed
knowledge stay distinguishable by **shape, border stroke, arrowhead and text badge**, never by
colour (§3/§37), and everything in the diagram is repeated in HTML tables so the picture is never
the only access path.

It carries names, types, repository-relative paths, provenance and counts — **no source code, no
evidence text, no absolute paths** — so it is safe to attach to a ticket. Agents can produce the
same file over MCP with `export_graph_html`, which returns the path and the real counts.

## See a specification's blast radius without VS Code

```bash
impactgraph graph --analysis <analysisId>   # → ./impactgraph-impact.html
impactgraph graph --analysis <id> --group package --out reports/impact.html
impactgraph graph --analysis <id> --format json   # the same view as contract-validated data
```

The same command, the same renderer, a second **view source**: instead of the current architecture
it draws a stored analysis — which components a specification is predicted to touch, grouped the way
the architecture view groups, so you can see _which parts of the system_ a spec reaches. An unknown
id fails with a configuration error that names the ids that would have worked.

What it puts in front of a reader, in this order of prominence:

- **Likelihood** (`required` / `likely` / `possible` / `unlikely`) — the thing you act on. Encoded
  three times over and never by colour: a four-segment meter whose _filled count_ is the reading,
  the spelled-out word, and the fraction (`REQUIRED 4/4`). **Confidence** is printed as a number to
  two decimals beside it, with its §14 contributing signals listed in the Impacts table — a score
  without its signals is not an explanation.
- **Provenance**, still a completely separate reading (§3): the box's border shape, dash pattern and
  `FACT`/`INFERRED`/`CONFIRMED` badge. Likelihood and provenance never share a channel, so a
  `REQUIRED` AI-inferred impact looks nothing like a `REQUIRED` deterministic one.
- **Requirement attribution** — every requirement in the specification gets a row, _including the
  ones that produced no impacts_. Ten requirements and sixty impacts are unreadable without it, and
  a requirement the analysis said nothing about is the most important row on the page.
- **Hop counts and dependency paths** — an impact reached at two hops is a weaker claim than a direct
  match, so each row states its reach and spells the path out hop by hop, with each hop resolved back
  to the real graph edge (`IMPORTS ×12`) rather than an unfalsifiable "depends on".
- **Current vs proposed** (§18.4) — if the analysis carries proposed structure, it is drawn with a
  long dash, a source-end marker no current relationship draws, and `[PROPOSED]` in the label, and
  aggregated separately so it can never merge with a current relationship.
- **What the analysis could not do** — warnings, the coverage gap, a snapshot or specification that
  has moved on. Absent data reads as absent (`no context assigned`, `NOT IN SNAPSHOT`), never blank.

Same guarantees as the architecture export: zero JavaScript, zero network, no source code, no
evidence text, deterministic re-export. Agents get it from the same MCP tool by passing
`analysisId`; the tool also returns the coverage numbers, so an agent cannot report a blast radius
while staying quiet about the requirements it did not cover.

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
