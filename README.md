# ImpactGraph

Answers two questions about a change, with evidence:

- **Before:** "I'm about to build this — what will it actually touch?"
- **After:** "did I build what I said I would?"

It indexes your repository into a knowledge graph (files, symbols, imports, calls, routes, data
models, migrations, Pub/Sub topics, Terraform resources) across **TypeScript/JavaScript, Python,
Java, Astro, HTML, Prisma and Terraform**. Give it a specification in prose; it reports which
components will likely change, why, and with what confidence — every claim traceable to a real
file range. Approve that as a plan, implement, then let it compare the plan against your actual
git diff.

It analyses and reviews. It never implements your feature, never modifies the analysed
repository, and never executes repository code — configuration and Terraform are parsed, not run.

## Status

Pre-release, and honest about it. The deterministic engine, the CLI, and the MCP server work and
are exercised by ~1,150 tests. **The packaged VS Code/Cursor extension does not install yet** and
there is no published binary. See [What doesn't work yet](#what-doesnt-work-yet).

## Requirements

- **Node ≥ 22** (`.nvmrc` pins 22), **pnpm 10.15**
- **git** — the target repository must be a git repository. Every analysis is bound to a commit
  snapshot, and review compares against a real baseline; without git, indexing fails immediately.
- No network and no API key are needed for the deterministic engine.

```bash
pnpm install
```

## Quick start

There is no `impactgraph` binary yet, so run the CLI from this repo and point `--root` at the
repository you want to analyse.

```bash
# from the ImpactGraph checkout
pnpm exec tsx apps/cli/src/main.ts --root /path/to/your/repo init
pnpm exec tsx apps/cli/src/main.ts --root /path/to/your/repo index
pnpm exec tsx apps/cli/src/main.ts --root /path/to/your/repo status
```

Then the loop:

```bash
… analyze path/to/spec.md          # predicted impacts, open questions, readiness
… approve <analysisId>             # freeze it as the review baseline
… export                           # implementation context for a coding agent
… review working-tree              # plan vs. what you actually changed
```

Every command takes `--format json` for machine-readable output.

> **Do not use `pnpm --filter @impactgraph/cli start`.** pnpm forwards its own `--` into `argv`
> and the CLI rejects it as an unknown argument. The same banner on stdout corrupts the MCP
> stdio protocol. Always invoke `tsx` directly.

### See the graph

Both commands write a **self-contained** HTML file: no JavaScript, no remote assets, no source
code. Open it in any browser; it is safe to attach to a ticket.

```bash
… graph                                  # architecture: groups and their dependencies
… graph --analysis <analysisId>           # one specification's blast radius
… graph --group context|application|package
```

## Commands

| Command                                            | Purpose                                              |
| -------------------------------------------------- | ---------------------------------------------------- |
| `init`                                             | create `.impactgraph/` (config + cache `.gitignore`) |
| `index`                                            | index the repository into the local knowledge graph  |
| `status`                                           | current index generation and snapshot                |
| `architecture`                                     | node/edge counts, workspaces, packages               |
| `graph`                                            | render the architecture or an analysis as HTML       |
| `analyze <spec>`                                   | analyse a specification against the indexed graph    |
| `approve <id>`                                     | freeze an analysis as the review baseline            |
| `select-option <analysisId> <optionId>`            | record an architectural-option decision              |
| `export [id]`                                      | export the implementation context for a coding agent |
| `review [working-tree\|commit]`                    | compare the approved analysis against reality        |
| `review accept <nodeId> "<reason>"`                | accept a discrepancy as a deviation                  |
| `config [history\|diff\|rollback\|restore\|drift]` | configuration audit trail and recovery               |

### Exit codes

Designed so CI can tell a _finding_ from a _failure_:

| Code | Meaning                        |
| ---- | ------------------------------ |
| 0    | success                        |
| 2    | warnings found                 |
| 3    | **review discrepancies found** |
| 4    | configuration error            |
| 5    | indexing failure               |
| 6    | provider failure               |
| 7    | unsupported project            |

`3` is deliberately distinct from `4–7`. A discrepancy is an input to human judgement, not a
defect — do not fail a build on it, or people will learn to ignore it.

## Use it from an agent (MCP)

The MCP server exposes 42 tools over stdio. An agent can submit a specification, receive a
**bounded** impact model it cannot hallucinate past, implement, and then be reviewed against the
approved plan.

The server states the expected workflow in its `initialize` instructions: **(1)** validate
workspace coverage (`get_workspace_status` reports every registered repository's index state and
any discovered-but-unregistered candidates), **(2)** index relevant repositories
(`index_workspace` indexes the workspace root plus every registered repository from
`repositories:` in `.impactgraph/config.yml` into one graph), **(3)** verify the specification's
central concepts resolve (`find_components`), **(4)** run `analyze_impact` — it auto-indexes
registered repositories missing from the current index, and when coverage is fundamentally
insufficient it reports `workspaceCoverage.status: "insufficient-coverage"`, **withholds the
readiness score**, and returns machine-readable `requiredActions` — **(5)** present limitations
when complete coverage is impossible. Candidate repositories are never indexed without user
confirmation.

**Claude Code:**

```bash
claude mcp add impactgraph --scope local -- \
  /abs/path/to/impactGraph/node_modules/.bin/tsx \
  /abs/path/to/impactGraph/apps/mcp-server/src/main.ts \
  --root /abs/path/to/your/repo
```

**Cursor** — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "impactgraph": {
      "command": "/abs/path/to/impactGraph/node_modules/.bin/tsx",
      "args": [
        "/abs/path/to/impactGraph/apps/mcp-server/src/main.ts",
        "--root",
        "/abs/path/to/your/repo"
      ]
    }
  }
}
```

Use the **absolute** `tsx` path: an MCP client spawns the server with an arbitrary working
directory, so anything relative breaks unpredictably. `--root` is pinned for the same reason —
the server would otherwise default to `process.cwd()`.

## The AI half (optional)

Everything above is deterministic and offline. Requirement extraction, clarification questions
and impact re-ranking improve with a model:

```yaml
# .impactgraph/config.yml
provider:
  strategy: anthropic # | openai-compatible | local | external-agent | none
  modelId: claude-sonnet-4-5
```

```bash
export IMPACTGRAPH_API_KEY=sk-ant-…
```

The key lives **only** in the environment or VS Code SecretStorage — the config schema has no
field for it, so it cannot be committed by accident. Default privacy mode is
`selected-snippets`; nothing leaves the machine until a provider is configured. AI failure
degrades features, never the deterministic engine.

## What it stores

```
.impactgraph/
  config.yml  architecture.yml  aliases.yml  rules.yml   ← COMMIT these: project knowledge
  artifacts/    specifications, analyses, reviews         ← local, append-only records
  cache/index.sqlite                                     ← local, disposable; rebuild any time
```

The four YAML files are human decisions about your codebase and belong in review. `artifacts/`
and `cache/` are gitignored by `init`.

## Why not just ask an LLM

- **Candidates come from graph traversal, not from a model.** The model may only classify
  components that provably exist and are provably connected; it cannot invent a file.
- **Confidence is computed from weighted signals** (exact match, direct import, data access,
  event relationship, historical co-change, graph distance, ambiguity …) and the contributing
  signals are stored, so `0.65` is explainable. It is never a number a model asserted.
- **Facts, inferences and human decisions never mix.** Every record carries provenance
  (`static-analysis` / `llm-inferred` / `human-confirmed`), evidence IDs, and a snapshot ID.
  Human corrections supersede; they never overwrite history, and reindexing cannot lose them.
- **Review closes the loop.** Predicting impact is the easy half; being held to the prediction
  afterwards is what makes it accountable.

## What doesn't work yet

- **The packaged `.vsix` does not install.** `better-sqlite3` is external to the bundle and lives
  in `node_modules`, which packaging excludes, so an installed extension cannot open its index.
  The extension does run in an Extension Development Host (open `apps/vscode-extension` in VS
  Code and press <kbd>F5</kbd>). The HTML graph export exists partly to work around this.
- **No `impactgraph` binary.** The CLI has no build output and runs through `tsx`; a real
  executable needs a bundle step. Commands in `docs/workflows/*.md` assume a binary on `$PATH`
  and will not run as written.
- **No browser-assisted key entry.** `ImpactGraph: Configure Model Provider` prompts for a pasted
  key. There is deliberately **no "log in with Anthropic"**: no public OAuth flow mints API keys
  for third-party apps, and an affordance that cannot work is worse than a paste box.
- **The layered dependency-flow graph view** promised by ADR-0005 needs `cytoscape-dagre`, which
  is not installed. The force-directed view exists.
- **Usefulness is unvalidated.** ~1,150 tests prove the tool does what we intended; none prove
  what we intended is worth having. `docs/design/developer-walkthrough-protocol.md` is the
  instrument for finding out and has not been run.

## Development

```bash
pnpm quality:gates            # format, lint, LOC, typecheck, all fast suites
pnpm test:analyzers           # adapter + fixture goldens
pnpm test:integration:vscode  # @vscode/test-electron lanes (slow)
```

Golden files regenerate **scoped**: `UPDATE_GOLDENS=<fixture> pnpm test:analyzers`. Never
`UPDATE_GOLDENS=1` — it rewrites every golden and silently adopts unrelated in-flight work.

After `pnpm --filter @impactgraph/contracts generate:schemas`, always run
`pnpm exec prettier --write "packages/contracts/schemas/**/*.json"`; the generator emits
unformatted JSON and `format:check` fails otherwise.

- Architecture, boundaries, provenance model: [`docs/engineering/`](docs/engineering/)
- Decisions: [`docs/adr/`](docs/adr/)
- Product source of truth: `Requirement.md` · work breakdown: [`backlog/`](backlog/)
