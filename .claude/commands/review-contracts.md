---
description: Audit every typed boundary touched by a diff — versions, both-end validation, compatibility, JSON Schema regeneration, contract tests
argument-hint: <branch or diff to audit (default: working tree vs main)>
---

## Purpose

Audit ALL typed boundaries a diff touches (ADR-0009; `docs/engineering/data-contracts.md`):
webview messages, MCP tool payloads, CLI output, persisted artifacts, AI DTOs, and config schemas.
One command covers them all so no boundary is reviewed in isolation while another silently drifts.

## Inputs

- `$ARGUMENTS` — branch or diff reference; default `git diff main...HEAD` plus working tree.
- `packages/contracts/*` (`contracts/webview`, `contracts/tools`, `contracts/cli`,
  `contracts/artifacts`, `contracts/config`), `docs/engineering/data-contracts.md`,
  `docs/engineering/artifact-versioning.md`.

## Preconditions

- Load `.claude/skills/typed-message-contract-development/SKILL.md` — it defines versioning rules,
  both-end validation patterns, and compatibility policy; this command applies it, not restates it.

## Agent sequence

Per touched boundary, delegate to its owner; **product-architecture** arbitrates cross-boundary
consistency:

| Boundary                                                 | Contracts dir                            | Owning agent         | Template                       |
| -------------------------------------------------------- | ---------------------------------------- | -------------------- | ------------------------------ |
| Webview messages                                         | `contracts/webview`                      | graph-webview        | `webview-message-contract.md`  |
| MCP tools (`impactgraph.submit_specification`, …)        | `contracts/tools`                        | vscode-integration   | `command-contract.md`          |
| CLI output (`impactgraph analyze spec.md` JSON/Markdown) | `contracts/cli`                          | vscode-integration   | `command-contract.md`          |
| Persisted artifacts                                      | `contracts/artifacts`                    | local-persistence    | `persistence-schema-change.md` |
| AI request/response DTOs                                 | in `contracts` + `packages/ai-inference` | ai-inference-privacy | `ai-inference-contract.md`     |
| Config (`.impactgraph/` YAML)                            | `contracts/config`                       | local-persistence    | `persistence-schema-change.md` |

## Skills used

- `typed-message-contract-development` (primary), `local-artifact-persistence` (artifact/config
  boundaries), `ai-inference-safety` (AI DTOs).

## Steps

1. Enumerate touched boundaries: diff files under `packages/contracts/**` plus any producer or
   consumer of a contract (webview handlers, MCP tool registrations, CLI formatters, persistence
   adapters, AI provider adapters). A consumer-only change still gets audited — it can break
   validation symmetry without touching the schema file.
2. For each boundary, delegate to the owning agent to verify, using the matching template as the
   checklist:
   a. **Versioning** — schema change ⇒ `schemaVersion` bump; breaking vs additive correctly
   classified; no reuse of an existing version for new shape.
   b. **Both-end validation** — Zod `parse`/`safeParse` at producer AND consumer (extension and
   webview; server and client; write and read for artifacts). No `as`-cast across a boundary.
   c. **Compatibility** — old persisted artifacts still load (migration or tolerant read per
   `artifact-versioning.md`); old webview/MCP clients get a typed version error, not a crash;
   CLI output changes flagged as breaking for CI consumers.
   d. **JSON Schema regeneration** — exported JSON Schemas regenerated from the Zod source and
   committed; `schema-compat` CI job will compare them, do not hand-edit.
   e. **Contract tests** — `pnpm test:contract` covers the new/changed shape: valid samples,
   invalid samples rejected, version-mismatch behavior, round-trip where applicable.
3. Cross-boundary pass (**product-architecture**): the same concept crossing two boundaries (e.g.
   an impact record in an artifact AND a webview message) stays consistent; DTOs never leak domain
   types (contracts are standalone; mapping lives in application/adapters).
4. AI DTO extra check (**ai-inference-privacy**): response schemas enforce
   node-reference-existence validation hooks and never define fields that would carry source
   snippets beyond the configured privacy mode.
5. Report findings per boundary, blockers first.

## Required outputs

- Boundary-by-boundary findings table (checks a–e each pass/fail/n-a with location).
- List of required version bumps not yet made, and missing contract tests.
- Verdict: **clean** / **fixable** / **blocking** (unversioned breaking change or missing
  consumer-side validation is blocking).

## Stop conditions

- A boundary schema changed with no template filled and no version decision → stop; complete the
  template with the owning agent before re-auditing.
- A change requires breaking a published artifact format without a migration → escalate.

## Human-review points

- Every `schemaVersion` bump requires human approval (mandatory-approval list) — verify it was
  obtained or route the request now.

## Completion criteria

- All touched boundaries enumerated and audited (a–e); JSON Schemas regenerated; contract tests
  green; verdict delivered; version-bump approvals recorded.
