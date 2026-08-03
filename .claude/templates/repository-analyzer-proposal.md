# Repository Analyzer Proposal: <analyzer name>

_For a new deterministic discovery capability in packages/repository-intelligence (PRD §15, §32).
Reviewed by the repository-intelligence agent with the repository-analysis-development skill.
Analyzers produce facts only — provenance is never `llm-inferred` here._

- **PRD grounding:** §<n> (discovery), §12.<n> (node/edge types), epic backlog/epic-02-indexing.md
  or backlog/epic-03-framework-discovery.md
- **Author / date:** <name> / <YYYY-MM-DD>

## Deterministic facts discovered

_Exactly what this analyzer asserts about a repository. Every assertion must be reproducible from
repository content alone._

- <e.g. "package X declares dependency on Y (package.json)">
- <...>

## Evidence sources

| Fact  | Source                                                | Provenance value (PRD §12.3)                                            |
| ----- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| <...> | <file path pattern / AST node / git log / config key> | static-analysis \| configuration \| git-history \| framework-convention |

## Node and edge types produced (PRD §12.1–12.2)

- Nodes: <e.g. Package, File, Symbol, API endpoint, Migration>
- Edges: <e.g. CONTAINS, IMPORTS, CALLS, PUBLISHES, TESTS, DEPLOYED_AS>
- New node/edge types required: <none | list — requires domain-model-proposal.md + ADR>

## Incremental behavior and hashing (PRD §32)

- Trigger: <file save / hash change of which file set / config change>
- Invalidation unit: <file | package | graph fragment> — what is recomputed vs reused
- Hash inputs: <file content | content + relevant config | ...>
- Guarantee: a failed run never destroys the previous valid index (PRD §34)

## Cancellation

- Token checked: <at which loop boundaries> — response within ~500 ms (our budget)
- Partial progress persisted safely: <how / not applicable because <...>>

## Failure and degradation mode (PRD §34)

- Parser/read failure on a file: <record parser warning, skip file, continue — never abort the run>
- Unsupported content: <reported as unsupported, not silently ignored>
- Oversized files / symlinks / path traversal (PRD §42.5): <behavior>

## Fixture repository needed (packages/test-kit)

- Fixture: <existing fixture <name> | new fixture: minimal repo containing <...>>
- Never the ImpactGraph repo itself (main skill §6)
- Malformed-repo variant for degradation tests: <describe>

## Golden-test expectations (PRD §42.3, vitest `analyzers` project)

- Golden file(s): <path under test-kit> pinning: node count, edge list, evidence per fact
- Update policy: goldens change only deliberately, with diff explained in the PR

## Performance impact on the 5k-file budget (PRD §33)

- Runs: <per file during indexing | once per run | on demand>
- Expected cost: <O(files) / O(edges) / ...>; measured with .claude/templates/performance-budget.md
  when the analyzer runs inside the initial-index path
- Runs in worker/child process (never the extension host): confirmed <yes>
