# Command Contract: <command name>

_For any CLI command, VS Code command, or MCP tool (PRD §19–21). Lives conceptually in
packages/contracts (contracts/cli or contracts/tools); this document is the review artifact.
Reviewed via `/review-contracts`. Contract changes require human approval (CLAUDE.md)._

- **Name:** <e.g. `impactgraph analyze` | `impactgraph.analyzeSpecification` | `impactgraph.submit_specification`>
- **Surface:** CLI | VS Code command | MCP tool
- **PRD grounding:** §<19|20|21>.<n>; epic backlog/epic-<NN>-<name>.md
- **Version:** <schemaVersion, e.g. 1> (bump rules: docs/engineering/data-contracts.md)
- **State-modifying:** yes/no — if yes and surface = MCP: confirmation behavior per PRD §35

## Input schema (Zod sketch)

```ts
const <Name>Input = z.object({
  schemaVersion: z.literal(<n>),
  // <fields — IDs stable, no domain types, DTOs only>
});
```

## Output schema (Zod sketch)

```ts
const <Name>Output = z.object({
  schemaVersion: z.literal(<n>),
  // <fields — include provenance/evidence/confidence on any knowledge-bearing payload>
});
```

## Exit codes / error taxonomy

_CLI: exit codes. VS Code/MCP: typed error results. Every failure is explicit and typed._

| Code / error kind | Meaning                                                             | Recoverable by caller? |
| ----------------- | ------------------------------------------------------------------- | ---------------------- |
| 0 / ok            | <...>                                                               | —                      |
| <n> / <ErrorKind> | <e.g. workspace-not-initialized, index-stale, provider-unavailable> | <...>                  |

## Cancellation behavior

- Cancellable: yes/no. If yes: <token source (CLI SIGINT / VS Code CancellationToken / MCP
  cancellation)>, responds within ~500 ms, partial progress <persisted / discarded>
- If no: justify (must complete in <<budget>)

## Privacy-mode behavior differences (PRD §9)

| Mode                        | Behavior                                                                   |
| --------------------------- | -------------------------------------------------------------------------- |
| local-only                  | <e.g. deterministic result only / AI-dependent parts return `unavailable`> |
| selected-snippets (default) | <...>                                                                      |
| full-context                | <...>                                                                      |
| external-agent              | <e.g. returns data for the agent; no provider call made by us>             |

## Compatibility notes

- Backward compatibility: <additive — old callers unaffected | breaking — version bump <old>→<new>,
  old version <still served until <when> | rejected with typed error>>
- Affected consumers: <webview / docs / MCP clients / CI scripts>

## Contract tests (vitest `contract` project)

- [ ] Valid input parses; representative invalid inputs rejected with precise messages
- [ ] Output of the use case validates against the output schema (round-trip)
- [ ] Version mismatch handling covered
- [ ] Privacy-mode matrix above asserted (at least local-only vs default)
- [ ] MCP only: malicious/oversized input rejected safely (PRD §42.5)
