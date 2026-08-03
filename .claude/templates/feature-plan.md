# Feature Plan: <feature name>

_Produced by `/impact-plan`; input to `/develop-feature`. Keep it honest — every "none" must be
verified, not assumed._

- **PRD grounding:** §<n>, §<Zn>, §<Cn>
- **Epic / stories:** backlog/epic-<NN>-<name>.md → <story bullets>
- **Owning agent(s):** <e.g. impact-modeling, local-persistence>
- **Specialist skill(s):** <e.g. impact-model-development>
- **Author / date:** <name> / <YYYY-MM-DD>

## Goal

_One or two sentences: observable behavior after this change. No implementation detail here._

_TBD_

## Affected packages and layers

| Package / app  | Layer                                                                 | Nature of change                  |
| -------------- | --------------------------------------------------------------------- | --------------------------------- |
| packages/<...> | domain \| application \| contracts \| adapter \| app shell \| webview | <new module / modified / deleted> |

Dependency-direction check (docs/engineering/dependency-rules.md): <no new edges | new edge
<from>→<to>, allowed because <...>>

## Contract impact

_Which of the five contract areas in packages/contracts change? (ADR-0009)_

- [ ] contracts/webview — <none | version <old>→<new>, template: webview-message-contract.md>
- [ ] contracts/tools (MCP) — <none | ...; template: command-contract.md>
- [ ] contracts/cli — <none | ...; template: command-contract.md>
- [ ] contracts/artifacts — <none | ...; template: persistence-schema-change.md>
- [ ] contracts/config — <none | ...>

## Provenance / knowledge-category implications (PRD §3, §12.3)

- New or changed records carrying provenance: <none | list types>
- Categories touched: <deterministic | llm-inferred | human-confirmed>
- Supersession / contradiction / staleness behavior affected: <no | describe → run `/review-provenance`>
- Any risk of category mixing: <none | describe mitigation>

## Privacy impact (PRD §9, §35)

- Data flow changes: <none — fully local | describe what could leave the machine>
- Privacy-mode behavior differences (local-only / selected-snippets / full-context /
  external-agent): <identical | describe → complete .claude/templates/privacy-review.md>

## Performance-budget impact (PRD §33)

- Budgets touched: <none | activation / incremental update / initial index / impact-tree / graph nodes / cancellation>
- Measurement plan: <not needed | .claude/templates/performance-budget.md with fixture <name>>

## Domain changes

_New/changed domain concepts. Non-trivial concepts need .claude/templates/domain-model-proposal.md._

_TBD_

## Adapter changes

_Which ports gain implementations or change shape; which adapters (git, persistence, ai-inference,
repository-intelligence, language-adapters, framework-adapters) are touched._

_TBD_

## Test plan (per vitest project — details in .claude/templates/test-plan.md if non-trivial)

| Project               | What is covered                      | New fixtures / golden files |
| --------------------- | ------------------------------------ | --------------------------- |
| unit                  | <...>                                | <...>                       |
| application           | <...>                                | <...>                       |
| contract              | <...>                                | <...>                       |
| analyzers             | <...>                                | <...>                       |
| webview               | <...>                                | <...>                       |
| quality               | <n/a unless quality tooling changes> | <...>                       |
| @vscode/test-electron | <...>                                | <...>                       |

## Rollout and docs

- docs/engineering pages to update: <...>
- ADR needed: <no | yes → .claude/templates/adr.md, decision: <...>>
- Changeset: <patch | minor | major | none (pre-release)>

## Human-approval checkpoints (CLAUDE.md mandatory list)

- [ ] <e.g. contract version bump on contracts/tools> — approver: <name>
- [ ] <none — verified against the mandatory-approval list on <date>>

## Out of scope

_Explicitly excluded work someone might assume is included. Prevents scope creep during review._

- <...>
