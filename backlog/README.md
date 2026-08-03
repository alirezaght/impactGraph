# ImpactGraph Backlog

Derived from `../Requirement.md` (main spec + Zero-Configuration addendum + Clarification Engine / Multi-Stack addendum).

Structure: **Epic → Story → Tasks.** Each story has acceptance criteria (checkboxes) and an ordered task list. Spec section references use `§` for the main document, `§Z` for the Zero-Configuration addendum, and `§C` for the Clarification/Multi-Stack addendum.

## Epics

| #   | Epic                                                                                 | Phase (§44)   | Depends on    |
| --- | ------------------------------------------------------------------------------------ | ------------- | ------------- |
| 01  | [Graph core & local storage](epic-01-graph-core.md)                                  | 0–1           | —             |
| 02  | [Repository indexing](epic-02-indexing.md)                                           | 1             | 01            |
| 03  | [TS/JS framework discovery (NestJS, Express)](epic-03-framework-discovery.md)        | 1–2           | 02            |
| 04  | [CLI](epic-04-cli.md)                                                                | 1             | 02            |
| 05  | [Specification engine & model provider interface](epic-05-specification.md)          | 3             | 01            |
| 06  | [Impact engine](epic-06-impact-engine.md)                                            | 4             | 02, 05        |
| 07  | [VS Code extension foundation & architecture explorer](epic-07-vscode-foundation.md) | 2             | 02            |
| 08  | [Architecture configuration & human correction](epic-08-architecture-config.md)      | 2             | 02, 07        |
| 09  | [Impact review UI (tree, graph, evidence)](epic-09-impact-ui.md)                     | 5             | 06, 07        |
| 10  | [Implementation-context export](epic-10-agent-export.md)                             | 5             | 06            |
| 11  | [Git review engine](epic-11-review-engine.md)                                        | 6             | 02, 06        |
| 12  | [MCP server & agent tools](epic-12-mcp.md)                                           | 7             | 04–06, 10, 11 |
| 13  | [Privacy, security & telemetry](epic-13-privacy-security.md)                         | cross-cutting | 05            |
| 14  | [Zero-configuration & AI-managed config](epic-14-zero-config.md)                     | post-MVP core | 08, 12        |
| 15  | [Clarification engine](epic-15-clarification.md)                                     | v1            | 05, 06        |
| 16  | [Multi-stack adapters & cross-stack graph](epic-16-multi-stack.md)                   | 8             | 02, 03        |
| 17  | [Testing infrastructure & quality metrics](epic-17-quality.md)                       | cross-cutting | 01            |

## Milestone 1 — CLI proves core value (§46) — ✅ reached 2026-07-31 (deterministic mode)

Goal: `impactgraph analyze feature.md` on a TypeScript repo produces an evidence-backed, graph-derived list of likely affected components, exportable as JSON. No VS Code UI required.

Scope: Epic 01 (all) → Epic 02 (stories 2.1–2.5) → Epic 04 (stories 4.1–4.3) → Epic 05 (stories 5.1–5.3) → Epic 06 (stories 6.1–6.5) → Epic 17 (story 17.1). Framework discovery (Epic 03) and everything UI/MCP comes after.

Status: the §46 flow works end-to-end (`init` → `index` → `analyze`) in deterministic-only mode, under test on the ts-basic fixture (a dependency not named in the spec is surfaced). Still open inside the milestone scope: Story 2.5 (calls/routes/data models), Story 6.3's LLM classification pass, and Story 17.1.

## Milestone 2 — MVP (§39–40)

Adds Epics 03, 07, 08, 09, 10, 11 and the MVP slice of 13 (privacy modes, SecretStorage, redaction). Complete when the 17-step MVP checklist in §39 passes.

## Milestone 3 — Agent-native v1 (§Z, §C)

Adds Epics 12, 14, 15, 16 and the remainder of 13 and 17. Complete when the revised acceptance criteria in §Z19 and §C16 pass.

## Conventions

- Stories are sliced to be independently completable (roughly 1–3 days each); tasks are the engineering breakdown inside a story.
- The core engine never depends on VS Code (§47.5); adapter and provider interfaces exist from the start even when only TS/JS is implemented (§39).
- Deterministic facts, AI inferences, and human confirmations are never mixed (§3) — this constraint appears as AC on every epic that touches the graph.
