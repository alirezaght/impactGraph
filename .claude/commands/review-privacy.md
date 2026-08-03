---
description: Privacy audit of a diff — data flow, redaction, secrets, prompt preview, consent, privacy-mode visibility, logs, telemetry
argument-hint: <branch or diff to audit (default: working tree vs main)>
---

## Purpose

Have the **ai-inference-privacy** agent run the `.claude/templates/privacy-review.md` checklist
against a diff. ImpactGraph's promise is local-first (PRD §9, §35, §42.5; ADR-0001,
ADR-0011): nothing leaves the machine without explicit configuration and user action. This review
is **blocking** on any external data flow that lacks that.

## Inputs

- `$ARGUMENTS` — branch or diff reference; default `git diff main...HEAD` plus working tree.
- `docs/engineering/privacy-and-security.md`, `.claude/templates/privacy-review.md`,
  `.claude/templates/threat-model.md` (consult for prompt-injection posture).

## Preconditions

- Load `.claude/skills/ai-inference-safety/SKILL.md` and
  `impactgraph-modular-development` §8.

## Agent sequence

1. **ai-inference-privacy** (primary) — the audit.
2. **vscode-integration** (collaborating) — SecretStorage usage, workspace trust, configuration UI
   visibility of the active privacy mode.
3. **local-persistence** (collaborating) — nothing secret or source-derived lands in artifacts or
   the SQLite index beyond what the privacy mode allows.

## Skills used

- `ai-inference-safety` (primary), `impactgraph-modular-development` §8.

## Steps

1. Trace **data flow**: for every diff path, list where repository content, specification text,
   config values, or derived records travel — in-process, to disk, to a child process, or to the
   network. Any new network edge outside `packages/ai-inference/providers/*` is an immediate
   blocking finding.
2. Delegate the `.claude/templates/privacy-review.md` checklist to **ai-inference-privacy**,
   covering at minimum:
   a. **Redaction** — common secret patterns redacted before any prompt assembly; redaction runs
   before privacy-mode filtering, not after.
   b. **`.env` exclusion** — environment files excluded by default from indexing, snippets, and
   prompts; the exclusion list is config-extensible but never config-removable silently.
   c. **SecretStorage** — API keys only via VS Code SecretStorage; never in settings JSON,
   `.impactgraph/` YAML, artifacts, logs, or test fixtures.
   d. **Prompt preview** — every external send path offers preview-before-send; preview shows the
   actual payload after redaction and mode filtering.
   e. **Consent** — external calls require explicit configuration AND a user action; no default
   that transmits; `external-agent` mode makes no provider calls at all (ADR-0010).
   f. **Privacy-mode visibility** — active mode (`local-only` / `selected-snippets` default /
   `full-context` / `external-agent`) visible in the UI and recorded on every AI-generated
   record; the extension never switches modes silently.
   g. **Logs** — logging port only; logs carry no source code, prompts, or secrets (PRD §34:
   provider failures logged without exposing source).
   h. **Telemetry** — off by default; any new telemetry event enumerated with its exact payload.
3. Prompt-injection check (PRD §42.5): repository content and specification text are handled as
   untrusted data in any prompt-assembly change; no repository-derived string becomes an
   instruction channel.
4. Verify deterministic degradation: with no provider configured, every touched feature still
   works or degrades visibly (modular skill §8).
5. Report checklist results; each item pass/fail/n-a with evidence (file/line).

## Required outputs

- Completed `.claude/templates/privacy-review.md` with per-item evidence.
- Data-flow summary listing every external edge (expected: none, or provider calls already
  configured and previewed).
- Verdict: **clean** / **fixable** / **BLOCKING**.

## Stop conditions

- **Blocking, no exceptions:** any external data flow without explicit configuration + user
  action; secrets outside SecretStorage; `.env` content reachable by a prompt; telemetry on by
  default. Do not proceed to gates or PR until resolved.

## Human-review points

- Anything that transmits data externally, changes privacy modes, redaction, or SecretStorage
  handling requires human approval (mandatory-approval list) — this review verifies the approval
  exists; it cannot grant it.

## Completion criteria

- Checklist fully evaluated with evidence; data-flow summary complete; no blocking finding open;
  human approvals for privacy-relevant changes recorded.
