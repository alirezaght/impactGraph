---
description: Review boundary or dependency changes against dependency-rules.md and the ADRs; produce findings and required ADRs
argument-hint: <diff, branch, or description of the boundary change>
---

## Purpose

Have the **product-architecture** agent judge whether a proposed or implemented change respects the
locked architecture: layer directions, package boundaries, forbidden imports, and the decisions in
`docs/adr/0001…0013`. Output is a findings report plus a list of ADRs that must be written or
revisited — not code changes.

## Inputs

- `$ARGUMENTS` — a branch/diff reference, or a description of the boundary change (e.g. "move
  snapshot hashing from packages/persistence into packages/git").
- `docs/engineering/dependency-rules.md`, `docs/engineering/architecture.md`,
  `docs/engineering/bounded-contexts.md`, `docs/adr/*`.

## Preconditions

- Load `.claude/skills/impactgraph-modular-development/SKILL.md` (§2 layers, forbidden imports).
- If `$ARGUMENTS` is a diff/branch, it must be available locally (`git diff main...<branch>`).

## Agent sequence

1. **product-architecture** (primary) — the review itself.
2. Owning agent of each affected package (collaborating, consulted for context only): e.g.
   local-persistence for `packages/persistence`, graph-webview for the webview,
   repository-intelligence for `packages/repository-intelligence`.

## Skills used

- `impactgraph-modular-development` (dependency rules summary; full rules in
  `docs/engineering/dependency-rules.md`).

## Steps

1. Establish scope: enumerate the packages, ports, and contracts the change touches. If it touches
   none (pure intra-package refactor with no import graph change), report "no boundary impact" and
   end.
2. Delegate to **product-architecture** with the diff/description and instruct it to check, in
   order:
   a. Dependency direction: domain ← application ← adapters/apps; webview → contracts only;
   contracts → zod only. Any new import edge across packages listed explicitly.
   b. Forbidden imports (modular skill §2): `vscode`, React/Cytoscape, `fs`/`child_process`,
   provider SDKs, `git` spawning — each checked against its allowed home.
   c. Port shape: are new ports narrow and defined in `packages/application`? Any port change is a
   boundary move by definition.
   d. ADR conformance: does the change contradict any Accepted ADR (esp. ADR-0004 ports/adapters,
   ADR-0006 hybrid persistence, ADR-0009 versioned contracts, ADR-0010 provider abstraction,
   ADR-0011 no hosted backend)? Does it hit a Proposed ADR's revisit trigger (ADR-0008 parser
   strategy)?
   e. ESLint boundaries: would `pnpm lint` catch this? If the change is legitimate but the
   boundaries config blocks it, the config change itself needs this review's approval.
3. Consult owning agents for intent where a violation might be deliberate; record their rationale.
4. Classify each finding: **violation** (blocks merge), **decision needed** (requires an ADR via
   `/create-adr`), or **note** (allowed, document in `docs/engineering/architecture.md` if the
   structure description changes).
5. For each "decision needed", state the ADR title, the options to compare, and whether it starts
   as Proposed with a revisit trigger.
6. Report findings to the user, ordered blockers first.

## Required outputs

- Findings report: per-finding — location, rule/ADR violated or affected, classification,
  required remediation.
- List of required ADRs (titles + option sets) for `/create-adr`.
- Explicit verdict: **approved**, **approved with ADRs required before merge**, or **rejected**.

## Stop conditions

- The change requires re-litigating a locked decision (design-brief table / Accepted ADR) without
  new evidence → reject; do not draft a counter-proposal inline.
- The diff is unavailable or the description too vague to enumerate touched boundaries → stop and
  request the missing input.

## Human-review points

- Any "rejected" verdict or dependency-rules/ESLint-boundaries config change goes to the human.
- ADR acceptance is always human (per `.claude/CLAUDE.md` mandatory-approval list); this command
  only identifies and drafts the need.

## Completion criteria

- Every touched boundary has an explicit finding or an explicit "conforms" statement.
- Verdict delivered; required ADRs listed; no violation left unclassified.
