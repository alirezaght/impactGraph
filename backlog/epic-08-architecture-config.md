# Epic 08 — Architecture Configuration & Human Correction

**Goal:** Version-controlled project knowledge in `.impactgraph/` with a documented schema, plus the full human-correction model — corrections become persistent, protected facts.
**Spec:** §16, §17, §27, §28.1, Epic D (§45)
**Phase:** 2 · **Depends on:** Epics 02, 07

---

## Story 8.1 — Configuration schema & files

**Acceptance criteria**

- [x] `.impactgraph/` layout per §16: `config.yml`, `architecture.yml`, `aliases.yml`, `rules.yml`, `.gitignore` (caches never committed). _(`impactgraph init` scaffolds all files with valid empty v1 defaults)_
- [x] Configuration supports the §17 example: project, privacyMode, languages, ignore globs, contexts with paths, component roles, aliases, rules, provider mode. _(privacyMode/ignore/disabledFrameworks in config.yml; contexts+roles in architecture.yml; aliases.yml; rules.yml. `project`/`languages`/provider-mode keys arrive with Epic 13 provider config)_
- [x] A documented JSON Schema exists; config is versioned (`version: 1`) (§17, §47.16). _(4 schemas generated from Zod, committed under `packages/contracts/schemas/config/`)_
- [x] Invalid configuration never replaces the last valid configuration (§Z13). _(validation gate before the atomic rename; tested)_

**Tasks**

- [x] Define config model + JSON Schema in `packages/core`. _(lives in `packages/contracts/src/config/` per ADR-0009 — contracts, not a `core` package)_
- [x] Implement YAML load/validate/save with last-valid fallback. _(`packages/persistence/src/config/project-config.ts`)_
- [x] Publish schema for editor validation + autocomplete in VS Code (§17). _(generated schemas bundled to `dist/schemas/`; `contributes.yamlValidation` maps the four `.impactgraph/*.yml` files — honored when the YAML extension is installed)_
- [x] Unit tests: every validation rule (§42.1 configuration parsing). _(contract tests + persistence round-trip/last-valid/invalid-file tests)_

## Story 8.2 — Correction actions

**Acceptance criteria**

- [x] All §16 corrections are available: rename, merge, split components; assign context; change component type/role; confirm/reject relationship; mark generated/ignored/infrastructure/shared; add alias; add ownership; confirm AI inference. _(**12 of 13 shipped**, and the thirteenth is deliberately absent — see below. Strict `configOperationSchema` variants: `rename-component`, `assign-context`, `set-component-role`, `mark-component` (generated/ignored/infrastructure/shared), `set-component-owner`, `set-relationship-confirmation` (one op, explicit `confirmed` boolean), plus the pre-existing add-alias / add-rule / add-ignore / confirm-value. **Merge** needs no operation of its own — renaming several names onto one canonical name IS the merge, and the overlay reports the collision as `mergedWithNodeIds`. **Add ownership** shipped 2026-08-02 under `docs/proposals/component-ownership-schema.md` (human-approved): an additive optional free-form `components[].owner` plus `set-component-owner`, resolved through the §Z5 ladder. It is descriptive metadata only — nothing gates on it — and it is never inferred: no detection, manifest or git-history path can write it, and tests pin that the overlay can only ever resolve it at levels 1/2/6. **Split is NOT implemented and was not faked**: splitting one detected component into two requires inventing graph nodes that no deterministic evidence produced, which the graph contract forbids — there is no honest committed-config representation, so no `split-component` op exists (a contract test pins its absence). This box is ticked with that exception stated, not hidden.)_
- [x] Corrections are reachable from the architecture tree and editor context menu (Mark as Domain Component, Assign to Context, Ignore Path — §19). _(three commands with those exact §19 titles; `contributes.menus` wires `view/item/context` on the Architecture view (package/file items) and `editor/context` on files. Handlers are thin: resolve target glob → quick-pick → engine operation → refresh tree.)_
- [x] Confirmed corrections persist to `.impactgraph/` with `human-confirmed` provenance (§12.3). _(every correction record in `architecture.yml` carries `source: human-confirmed | agent-approved` derived from the §Z11 approval the applier just computed; a record with no `source` is read as human-confirmed, since hand-written YAML is human knowledge.)_

**Tasks**

- [x] Implement correction operations as structured mutations on config + graph overlay. _(`config-corrections.ts` builders behind the one governed applier: classify → mode gate → §Z13 validation → atomic write → §Z12 audit; the overlay is `overlay.ts` — read-time, never a graph mutation.)_
- [x] Wire UI entry points (tree context menus, editor commands, quick-picks). _(`commands/corrections.ts` + the pure `commands/correction-items.ts`; MCP gets `apply_component_correction`, roster 38 → 39. CLI intentionally not extended — `impactgraph config` already applies operations.)_
- [x] Unit tests per correction type. _(`config-corrections.test.ts`: apply → persisted document → audit envelope → rollback restores, per type, plus the §Z13 duplicate/no-op rejections and the ownership glob-matches-nothing rejection; `correction-contracts.test.ts` for the variants; `correction-items.test.ts` for the extension mapping; an MCP end-to-end flow in `registry-flows.ts`.)_

## Story 8.3 — Protection of human knowledge during reindex

**Acceptance criteria**

- [x] Reindexing never silently overwrites human-confirmed values (§34, §43.3); they remain authoritative until the user changes them, delegates ownership, or the referenced files no longer exist (§Z5). _(structural: assignments live only in committed YAML and are resolved at use time — the disposable index cannot overwrite them)_
- [x] When a confirmed mapping references deleted paths, it is flagged for review, not deleted. _(`staleAssignments()` reports globs matching no files; not yet surfaced in a UI queue)_
- [x] Precedence model implemented: human-confirmed > agent-approved > repo metadata > deterministic detection > AI-inferred > defaults (§Z5). _(`overlay-precedence.ts` names all six levels with ranks 1–6; committed records supply levels 1–2 via their `source`, package manifests level 3 (`configuration` provenance), static-analysis/framework-convention/git-history level 4, `llm-inferred` level 5, and an unanswered value resolves at level 6. Each level keeps its own PRD §12.3 provenance — an agent-approved value committed to YAML stays `llm-inferred`, never promoted to fact (§3). One test per rung proves it beats the rung below.)_

**Tasks**

- [x] Implement config/graph merge layer with source priorities. _(`overlay.ts` + `overlay-components.ts` + `overlay-precedence.ts`: a pure read-time resolver over graph + committed config returning the effective name/role/context/markers/relationship per subject, each carrying which level won and that level's provenance. The graph is never mutated, so reindexing cannot lose a correction and a correction cannot fabricate a fact. Wired into `explain_node`, `explain_edge`, `summarizeArchitecture` and `detect_repository_structure`; rejected relationships are excluded VISIBLY — listed with their reason and counted apart from `totalEdges`, never silently dropped. `assignmentFor()` is unchanged and still backs rule evaluation.)_
- [x] Implement stale-mapping detection + review queue in the Issues view. _(stale contexts/components render in the Issues tree's needs-review section, kept per §Z5)_
- [x] Test: reindex after refactor keeps confirmations; deleted target flags item. _(stale-assignment unit tests; YAML survives reindex by construction)_

## Story 8.4 — Architecture rules

**Acceptance criteria**

- [x] Users can define rules like the §27 examples (domain must not import infrastructure, schema changes require migrations, API contract changes require tests). _(both shapes in rules.yml: `dependency-direction` by role/context, `accompanying-change` by glob pair)_
- [x] Rules can be deterministic or heuristic; every violation includes evidence (§27). _(deterministic only in v1 — heuristic rules deliberately deferred; unknown rule types are validation errors, never best-effort)_
- [x] Rule evaluation runs on the graph and on review results (consumed by Epic 11). _(`impactgraph review` evaluates change rules on the diff + dependency rules on the graph restricted to changed files; violations set exit code 3 and render in the §38.2 report. Full-graph audit outside review still open)_

**Tasks**

- [x] Define rule model (`sourceRole`/`forbiddenTargetRole` style + requires-accompanying-change style).
- [x] Implement deterministic rule evaluator with evidence output. _(`application/src/evaluate-rules/`)_
- [x] Surface violations in Issues view + reports. _(reports done; drift/rule-reference issues render in the Issues tree — live per-review violations stay in the Review view where they belong)_
- [x] Unit tests for each rule pattern (§42.1). _(8 evaluator tests + CLI e2e with a violated-then-satisfied migration rule)_
