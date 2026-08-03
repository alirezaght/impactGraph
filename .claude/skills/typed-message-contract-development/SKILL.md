---
name: typed-message-contract-development
description: Use when creating or changing anything in packages/contracts — webview messages, MCP tool schemas, CLI JSON output and exit codes, persisted artifact schemas, AI response DTOs, or the .impactgraph config schema. Covers Zod-first schema design, JSON Schema generation, versioning and compatibility rules, dual-end validation, and contract tests. Triggers on schema bumps, new tool definitions, DTO changes, and boundary payloads.
---

# Typed Message Contract Development

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill adds rules for `packages/contracts`. Decision record: ADR-0009. Reviews via
`/review-contracts`. Backlog: `backlog/epic-12-mcp.md`, `backlog/epic-10-agent-export.md`.

## Purpose

Every typed boundary in ImpactGraph is defined once, in `packages/contracts`, as a versioned Zod
schema with generated JSON Schema. The boundaries:

| Subpath               | Boundary                                                                                                                                       | PRD      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `contracts/webview`   | Extension host ↔ webview messages                                                                                                              | §18      |
| `contracts/tools`     | MCP tool inputs/outputs (`impactgraph.submit_specification`, `impactgraph.review_implementation`, `impactgraph.apply_configuration_change`, …) | §21, §Z7 |
| `contracts/cli`       | CLI JSON output + exit codes                                                                                                                   | §20      |
| `contracts/artifacts` | Persisted JSON artifacts (specs, analyses, approved models, reviews, audit history)                                                            | §28      |
| `contracts/config`    | `.impactgraph/` YAML schema + structured configuration operations                                                                              | §17, §Z7 |
| AI response DTOs      | Structured output schemas passed to `ModelProvider.generateStructuredOutput<T>`                                                                | §8, §34  |

## When to use

Any new or changed schema, message type, tool definition, exit code, artifact record, or
config field; any compatibility question ("can I add this field?"); generating JSON Schema.

## When NOT to use

- Implementing the handler behind a tool/message → app and engine skills.
- Storage mechanics for artifacts → `local-artifact-persistence`.
- Prompt construction or redaction → `ai-inference-safety`.

## Required context

PRD §17 (config example + "Configuration must have a documented JSON Schema"), §20 (exit codes
must distinguish: success, warnings found, review discrepancies found, configuration error,
indexing failure, provider failure, unsupported project), §21 + §Z7 (tool rosters),
§34 ("Validate AI output against schemas… Reject references to nonexistent nodes");
`docs/engineering/data-contracts.md`, `artifact-versioning.md`; ADR-0009.

## Expected outputs

Zod schema + inferred TS types, generated JSON Schema artifact (for external inspection, VS Code
YAML validation per §17, and MCP tool listings), a `schemaVersion`/message-version bump when
required, contract tests in the `contract` vitest project, and an updated
`docs/engineering/data-contracts.md` entry. Boundary-specific templates:
`.claude/templates/webview-message-contract.md`, `command-contract.md`,
`ai-inference-contract.md`, `persistence-schema-change.md`.

## Architectural rules

- **Zod is the single source of truth.** JSON Schema is _generated_ from Zod, committed, and
  diffed in review — never hand-edited. A hand-written JSON Schema drifting from Zod is a
  blocking finding.
- **`packages/contracts` depends on `zod` only.** No domain imports, no `vscode`, no adapter
  types. Contracts are standalone DTO schemas; **DTO ↔ domain mapping lives in
  `packages/application` or the adapters, never in contracts** (locked in the architecture
  table). If a mapper appears in this package, move it.
- **Validation at BOTH ends.** Sender validates before serializing; receiver validates before
  acting — extension host and webview, MCP server and tool caller, CLI and its consumers,
  persistence write and read, AI response before use. "The other side already validated" is not
  an accepted argument.
- Every message/record carries its version (`schemaVersion` for records, versioned message/tool
  names or a version field for messages). Receivers handle unknown versions explicitly (typed
  error, never silent best-effort parse).
- Exit codes (`contracts/cli`) are an exported enum with one value per §20 category; apps map
  typed errors to them — no literal numbers in `apps/cli`.
- AI response DTOs reference graph nodes **by ID only**; the schema must not permit free-form
  node definitions — nonexistent-node rejection (PRD §34) starts with the schema shape.

## Versioning and compatibility rules

- **Additive (no bump needed):** new _optional_ field with safe absence semantics; new message
  type; new tool. Receivers must already ignore unknown fields (`passthrough`/strip decided per
  boundary and documented — pick one per subpath and keep it).
- **Breaking (bump + migration/compat plan + human approval per CLAUDE.md):** removing or
  renaming a field, changing a type, tightening validation, changing field semantics, changing
  an exit-code meaning, making an optional field required.
- **No implicit enum expansion.** Adding an enum value is breaking for _consumers_ that
  exhaustively switch (old CLI consumers, persisted-artifact readers, webview). Either model the
  value set as `string` + known-values list from day one, or treat additions as breaking with a
  version bump. Never just append to `z.enum` on a persisted or emitted type.
- Persisted artifact schemas: old versions are never deleted from the codebase — readers for
  every historical version stay, with fixtures (see `local-artifact-persistence`).
- CI job `schema-compat` diffs generated JSON Schemas against the base branch and fails on
  breaking changes without a version bump.

## Security & privacy rules

- Schemas are the privacy choke point: no field for raw secrets, provider keys, or full file
  bodies outside the explicitly-designed evidence/snippet shapes. A schema that _could_ carry a
  secret invites one — constrain with maximum lengths and enumerated shapes.
- MCP tools that modify state (`impactgraph.apply_configuration_change`,
  `impactgraph.approve_analysis`) must encode confirmation semantics in the contract
  (PRD §35: state-modifying tools require appropriate confirmation).
- Reject-unknown behavior on inbound external payloads (MCP inputs, imported specs): strict
  parsing, size limits, no prototype-polluting keys.

## Testing requirements

All in the `contract` vitest project (`pnpm test:contract`):

- Valid/invalid fixture pairs per schema (boundary values, missing fields, wrong types,
  oversized payloads, unknown versions).
- Round-trip: `parse(serialize(x))` is identity for every DTO.
- Generated JSON Schema snapshot tests — regeneration is a reviewed diff, never a blind update.
- Compatibility tests: current reader parses fixtures of every prior version; prior-version
  reader behavior against current output is documented per boundary.
- Exit-code mapping table test: every §20 category has exactly one code, no reuse.

## Common failure modes

- Editing the generated JSON Schema to "fix" a validation issue — fix the Zod source.
- Importing a domain type "because the shapes match today" — they diverge tomorrow, invisibly.
- `z.enum([...]).catch('unknown')` on a decision-bearing field — silently reclassifies data.
- Widening a field to `z.any()` under deadline pressure — the boundary is now unvalidated.
- Adding a required field and calling it additive because "we always send it" — old persisted
  records don't.
- Two subtly different `ImpactSummary` schemas in `tools` and `cli` — extract the shared shape.

## Checklist

- [ ] Schema in Zod, JSON Schema regenerated and committed, docs entry updated
- [ ] Version bump classified (additive vs breaking) with the enum rule checked explicitly
- [ ] Both ends validate; unknown-version path is a typed error with a test
- [ ] No domain imports; no mapping code in contracts
- [ ] Contract tests: fixtures, round-trip, snapshot, prior-version compatibility
- [ ] Breaking change: human approval obtained (CLAUDE.md mandatory list), `schema-compat` green
- [ ] Relevant template completed; `/review-contracts` run

## Definition of done

One Zod source of truth exists for the boundary, both ends validate it, its version and
compatibility class are explicit and tested against prior versions, JSON Schema is regenerated,
and no domain type, mapper, or secret-capable field lives in `packages/contracts`.
