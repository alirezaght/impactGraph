---
description: Audit a diff for knowledge-category violations — mixed categories, missing provenance/evidence/IDs, history mutation, AI promoted to fact
argument-hint: <branch or diff to audit (default: working tree vs main)>
---

## Purpose

Have the **domain-provenance** agent audit a diff against the core product principle (PRD §3,
§12.3; ADR-0002): the three knowledge categories stay separate, every record is fully attributed,
and history is append-only. This runs in `/develop-feature` Stage 6 and whenever the modular
skill's "before requesting review" checklist flags changed knowledge records.

## Inputs

- `$ARGUMENTS` — branch or diff reference; default `git diff main...HEAD` plus working tree.
- `docs/engineering/provenance-model.md`, `packages/domain` provenance types.

## Preconditions

- The diff compiles and targeted tests run (audit findings must map to real code, not WIP noise).
- Load `.claude/skills/impactgraph-modular-development/SKILL.md` §3.

## Agent sequence

1. **domain-provenance** (primary) — the audit.
2. **impact-modeling** / **specification-intelligence** / **repository-intelligence**
   (collaborating) — consulted when findings land in their packages, to distinguish violation from
   intended semantics.

## Skills used

- `domain-provenance-development` (primary), `impactgraph-modular-development` §3.

## Steps

1. Collect the diff and filter to files that create, transform, persist, render, or export
   knowledge records (nodes, edges, impacts, requirement mappings, discrepancies, config values).
   If none, report "no provenance-relevant changes" and end.
2. Delegate to **domain-provenance** to check each touched record path for the violation classes:
   a. **Mixed categories** — one structure, collection, field, or UI payload blending
   deterministic, `llm-inferred`, and `human-confirmed` knowledge without a discriminant;
   merges that lose the category of an input.
   b. **Missing attribution** — records created or transformed without provenance, evidence IDs,
   confidence, createdAt, repository-snapshot ID, specification version, or analysis-run ID;
   transformations that drop any of these from their inputs.
   c. **History mutation** — updates or deletes where supersession is required: human corrections
   overwriting prior records, re-analysis replacing instead of versioning (PRD §40.3),
   contradiction resolved by deletion instead of a `CONTRADICTS` representation, stale records
   silently refreshed instead of flagged.
   d. **AI output promoted to fact** — `llm-inferred` records gaining deterministic provenance,
   AI references to nonexistent graph nodes accepted instead of rejected, unsupported claims
   kept at full strength instead of downgraded (PRD §34), AI prose treated as system of record.
   e. **Confidence not signal-derived** — confidence set from a model-supplied number or a
   constant instead of computed from weighted deterministic signals with the contributing
   signals stored (PRD §14).
3. For each finding: file/line, violation class, the record type affected, and the concrete fix
   (usually: split the type, carry the IDs through, supersede instead of mutate, downgrade instead
   of promote).
4. Check test coverage: does a test pin each invariant the diff touches? Missing tests are
   findings too (route to testing-quality via the fix).
5. Report findings, blockers first.

## Required outputs

- Findings list grouped by violation class (a–e), each with location and required fix.
- Explicit verdict: **clean**, **fixable findings**, or **blocking** (any class-c history
  mutation or class-d promotion is blocking by default).

## Stop conditions

- The diff intentionally changes provenance/category/supersession semantics → stop the audit and
  escalate: that needs `/create-adr` + human approval before it can be judged.

## Human-review points

- All blocking findings and any proposed exception to append-only history go to the human
  (mandatory-approval list: "deleting or rewriting historical analysis data").

## Completion criteria

- Every provenance-relevant file in the diff audited against all five classes; verdict delivered;
  blockers either fixed and re-audited or explicitly escalated.
