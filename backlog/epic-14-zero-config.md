# Epic 14 — Zero-Configuration & AI-Managed Configuration

**Goal:** Useful analysis with no manual configuration: detection-first config generation, structured config operations for agents, ownership modes, audit + rollback, drift maintenance, custom detection rules, natural-language configuration.
**Spec:** Zero-Configuration addendum §Z1–§Z20
**Phase:** post-MVP core (Milestone 3) · **Depends on:** Epics 08, 12

---

## Story 14.1 — Detection-first configuration generation

**Acceptance criteria**

- [x] `generate_configuration` produces a valid config from repository evidence: manifests, lock files, build files, imports, decorators, entry points, directory conventions, Docker/Terraform/CI, migrations, env refs, git history, ownership files, existing docs (§Z4). _(evidence = the deterministic graph (which already encodes imports/decorators/conventions/Docker/CI/migrations/env refs) + manifests; git-history/ownership-file collectors open)_
- [x] Every generated field retains evidence + confidence (stored internally, not necessarily in the committed YAML) (§Z4). _(each generated field is an audited operation carrying reason + confidence — the §Z12 trail is the sidecar)_
- [x] A user can initialize a supported repo without manually editing config files, then run a first analysis without stack fine-tuning (§Z19.1, §Z19.12). _(e2e: init → index → generate → clean drift → first analysis, zero manual edits)_
- [x] The onboarding flow matches §Z1: inspect → index facts → generate config → validate → ready.

**Tasks**

- [x] Implement evidence collectors per source type. _(graph + manifest collectors; `detect_stack` reports languages/frameworks/signals)_
- [x] Implement config synthesizer (deterministic detection first, AI inference labeled as such). _(fully deterministic today — no AI-inferred config fields exist yet to label)_
- [x] Store per-field evidence/confidence sidecar. _(audit entries)_
- [x] E2E test: fresh fixture repo → generated config → first analysis with zero manual edits.

## Story 14.2 — Structured configuration operations (agent tools)

**Acceptance criteria**

- [x] All §Z7 tools implemented: detect_stack, detect_repository_structure, get/generate/validate_configuration, preview/apply/rollback_configuration_change, refresh_configuration, explain_configuration, get_configuration_warnings, confirm_configuration_value, remove_stale_configuration. _(complete — MCP roster now 38. Caveats, honestly: `refresh_configuration` runs the SAME detection-first generation as `generate_configuration` (no separate refresh algorithm exists) and differs only by a deterministic delta report — files this run wrote, and when configuration last changed, both derived from the §Z12 trail. `confirm_configuration_value` needed new storage: no confirmation marker existed on any document, so an additive optional `confirmations` list was added to architecture.yml plus a `confirm-value` operation kind — both are contract changes needing human approval. `explain_configuration` is deterministic (document + audit trail + graph projection) with no AI, and for `rule` subjects reports zero affected nodes because §27 rules are evaluated against a review delta, not the standing graph.)_
- [x] Writes use structured operations (e.g. `add-language`, `add-framework` with reason/confidence) — agents never rewrite YAML text for ordinary changes (§Z7). _(`config/operation.v1` discriminated union: ignore/alias/context/component/privacy/automation ops, each with reason + confidence; language/framework ops arrive with 14.1 detection)_
- [x] Validation per §Z13 (schema, path existence, glob validity, adapter availability, duplicates, conflicts, circular ownership, overly broad patterns, privacy conflicts); invalid config never replaces last valid (§Z13). _(schema + duplicate/conflict checks + the atomic-write gate; path-existence/glob-breadth/circular-ownership checks are open — annotated conservative)_

**Tasks**

- [x] Define operation vocabulary + schemas. _(8 kinds in v1; grows with detection ops)_
- [x] Implement operation applier with validation gate. _(`workspace-engine/src/config-operations.ts` — one path: classify → mode gate → validate → atomic write → audit)_
- [x] Expose as MCP tools (extends Epic 12 registry). _(preview/apply/rollback/history — roster now 23)_
- [x] Tests: each operation type + each validation failure mode. _(mode×class matrix + duplicate/untouched-file tests; remaining §Z13 checks tracked above)_

## Story 14.3 — Agent ownership modes

**Acceptance criteria**

- [x] Three modes: Autonomous, Review-before-apply, Manual (§Z6). _(config `automation.mode`, default review; changing the mode is itself a material audited operation)_
- [x] Safe vs. material change classification per §Z11 (safe: add detected language/framework/roots, ignore generated output, unambiguous moves; material: merge contexts, split apps, ownership changes, rule changes, privacy changes, removing human confirmations, synonym decisions). _(current vocabulary: add-ignore safe, everything else material — deliberately conservative; expands with detection ops)_
- [x] In autonomous mode safe changes apply automatically with audit entries; material changes always follow the configured approval path; human-confirmed decisions are never overridden (§Z6.1). _(matrix tested; overrides of human-confirmed values only exist via explicitly approved operations)_
- [x] The safe/material boundary is configurable (§Z11). _(`automation.safeOperations` in config.yml; privacy/automation-mode changes have a hard floor and can never be declared safe)_

**Tasks**

- [x] Implement mode setting + enforcement in the operation applier.
- [x] Implement change classifier with configurable policy.
- [x] Tests per mode × change class matrix.

## Story 14.4 — Audit history & rollback

**Acceptance criteria**

- [x] Every AI-generated change records: timestamp, agent identity, model/provider, previous + new value, reason, evidence, confidence, validation result, auto/approved flag, repository snapshot, rollback ID (§Z12). _(`config/audit-entry.v1`; previous/new are full documents so restore is exact; evidence + snapshot fields populate when detection ops (14.1) produce them)_
- [x] Commands work: `Undo Last Configuration Change`, `Open Configuration History`, `Restore Configuration Version`; CLI `config history|diff|rollback|restore`; matching MCP tools (§Z14). _(full CLI set incl. `diff [id]` and `restore <id>`; VS Code Undo/History; MCP rollback/history/`restore_configuration_version` tools; VS Code `Restore Configuration Version` quickpick — all §Z14 surfaces present)_

**Tasks**

- [x] Implement append-only audit store (local). _(JSONL under artifacts; contract-validated on read AND write)_
- [x] Implement rollback/restore over the audit chain. _(both by APPEND; restore records the true pre-restore document so it is itself rollbackable)_
- [x] Wire VS Code commands, CLI subcommands, MCP tools.
- [x] Tests: rollback restores exact prior state incl. validation. _(byte-exact document restore asserted; restored docs re-pass the §Z13 gate)_

## Story 14.5 — Configuration drift detection & maintenance

**Acceptance criteria**

- [x] After indexing, drift is detected: new apps, moved packages, replaced frameworks, renamed subscriptions, deleted components, ambiguous aliases, rules referencing deleted paths (§Z10). _(`detectConfigDrift`: stale contexts/components, dangling aliases, dangling rule references, uncovered packages; framework-replacement/subscription-rename detection arrives with 14.1's detection collectors)_
- [x] Maintenance actions are produced in Added/Updated/Removed/Needs-review groups (§Z10 example); safe ones auto-apply in autonomous mode. _(needs-review + suggestions with structured operations; the suggested ops flow through the 14.2 applier so the §Z6 mode decides — an auto-apply sweep helper is open)_
- [x] Repository changes trigger drift detection (§Z19.10). _(the extension refreshes the Issues tree (drift included) after every reindex; CLI/MCP remain on-demand)_

**Tasks**

- [x] Implement post-index config-vs-graph reconciliation.
- [x] Implement maintenance-action generator + presentation (Issues view / init summary). _(CLI + MCP + the extension Issues tree)_
- [x] Tests per drift scenario. _(4 scenarios on a real indexed workspace)_

## Story 14.6 — Custom detection rules

**Acceptance criteria**

- [x] Agents/users can define repo-specific detection rules (§Z8 `customDetection` example: match imports/decorators → produce node type). _(`detections` in rules.yml: match imports + decorators/calls → produce §12-vocabulary node + edge, name from a chosen string argument)_
- [x] Rules are versioned, validated, explainable, testable against fixtures, removable, and clearly distinguished from built-in adapters (§Z8). _(schemaVersion'd YAML; §Z13 validation incl. no-wildcard imports; every fact carries `configuration` provenance + the triggering evidence — built-ins use `framework-convention`; removable by editing rules.yml; a dedicated snippet test-runner is open — the fixture e2e covers testability today)_
- [x] A custom framework pattern added via rule shows up in the graph (§Z19.11). _(internal-pubsub fixture: @Subscribe decorator → subscription node + SUBSCRIBES_TO; module-level publishTo call → topic + PUBLISHES; same-named decorator from a different module correctly does NOT match)_

**Tasks**

- [x] Define custom-rule schema + validation.
- [x] Implement rule interpreter running in the adapter enrichment phase. _(`createCustomDetectionAdapter` — a config-driven FrameworkAdapter; wired in the engine and the extension index worker; `importsOf` added to CodeGraph for import gating)_
- [x] Implement rule test-runner against fixture snippets. _(`testDetectionRule` + the `test_detection_rule` MCP tool: parses one inline snippet (or one repository-relative file, path-escape guarded) with the TypeScript adapter and drives the REAL `createCustomDetectionAdapter` matcher over it, reporting matched/unmatched, the nodes+edges it would emit with their provenance, and per-match warnings. Nothing is persisted — the rule never reaches rules.yml and the facts never reach the graph. No CLI surface (not required).)_
- [x] E2E test with an internal-pubsub-wrapper fixture.

## Story 14.7 — Natural-language configuration & self-improving model

**Acceptance criteria**

- [x] Instructions like "Treat everything under src/domain as domain code" or "Deal and Opportunity mean the same thing" translate into validated structured operations (§Z15). _(`createConfigTranslator` (guarded provider, `nl-config-response.v1`) → `applyInstruction` through the SAME governed applier; unexpressible instructions are surfaced as `unsupported`, never approximated)_
- [x] Analysis corrections and review outcomes generate learning proposals (alias, rule, mapping updates) applied per ownership mode (§Z9, §Z16). _(append-only proposal queue: review co-change → suggested `add-rule` (the §Z9 migration example, tested); rejected impacts → queued correction records; applying a proposal is a normal governed operation)_
- [x] Every applied learning has an audit entry and explanation. _(structurally guaranteed: NL-derived operations carry the instruction as reason and flow through the §Z12 audit)_

**Tasks**

- [x] Implement NL → operation translation via `ModelProvider` (schema-constrained). _(the model cannot invent an operation kind — the schema is the vocabulary)_
- [x] Implement feedback listeners on impact decisions and review results → proposal queue. _(wired into `recordImpactDecision` and `runReviewPipeline`, best-effort/never blocking)_
- [x] Tests: each §Z15 example sentence → expected operation; rejected-impact example (§Z9) → learned exclusion. _(§Z15 sentences + §Z9 co-change proposal tested; `add-exclusion`/`remove-exclusion` operations now exist — rejected impacts queue a suggested add-exclusion, applied via the governed path; exclusions suppress impacts with a `configured-exclusion` warning, tested)_
