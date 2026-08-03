---
description: Prepare a release — changesets, vsce packaging validation, privacy-default verification, schema compatibility; publishing stays human-only
argument-hint: <optional: intended version or release scope note>
---

## Purpose

Walk a release candidate through `.claude/templates/release-checklist.md` using the
`release-management` skill: version via Changesets, validate packaging with `@vscode/vsce`, verify
privacy defaults, and confirm artifact-schema compatibility. This command prepares and validates;
**the decision to publish to any marketplace or registry is made manually by a human** —
`release.yml` deliberately performs packaging + validation only, never automatic publish.

## Inputs

- `$ARGUMENTS` — optional intended version or scope note (e.g. "first CLI-only preview").
- Pending changesets in `.changeset/`, `docs/engineering/release-process.md`,
  `.claude/templates/release-checklist.md`.

## Preconditions

- `main` is green in CI including slow lanes (`test-vscode-integration`, `build`,
  `package-extension`, `security`, `schema-compat`).
- No open blocking findings from `/review-privacy`, `/review-provenance`, `/review-contracts`.
- Load `.claude/skills/release-management/SKILL.md`.

## Agent sequence

1. **testing-quality** (primary for gate/coverage verification).
2. **ai-inference-privacy** — privacy-default verification step.
3. **local-persistence** — artifact/config schema compatibility step.
4. **vscode-integration** — packaging and activation smoke test.
5. **product-architecture** — confirms no Proposed ADR's revisit trigger fires with this release.

## Skills used

- `release-management` (primary), `impactgraph-modular-development` §12 "Before release".

## Steps

1. Open `.claude/templates/release-checklist.md` and work it top to bottom; every step below maps
   to checklist items — check them off with evidence, not intentions.
2. **Changesets**: verify every user-visible change since the last tag has a changeset with the
   correct semver level; run `pnpm changeset version` (or verify the release PR from `release.yml`
   did); review the generated CHANGELOG entries for accuracy — no invented features, no omitted
   breaking changes.
3. **Quality**: run `/run-quality-gates` with all targeted suites (`analyzers webview vscode`).
   All green, no skipped tests without written reason.
4. **Packaging validation** (vscode-integration): `pnpm --filter vscode-extension package` /
   `vsce package` succeeds; inspect the `.vsix` contents — no test files, no fixtures, no source
   maps with embedded sources unless intended, no `.env`, nothing from `packages/test-kit`.
   Install the `.vsix` locally and smoke-test activation (< 500 ms budget, PRD §33) and one
   end-to-end command.
5. **Privacy-default verification** (ai-inference-privacy): a fresh install has privacy mode
   `selected-snippets`, telemetry off, no provider configured, no network activity at activation;
   SecretStorage empty; `.env` exclusion active. Record how each was verified.
6. **Schema compatibility** (local-persistence): artifacts and `.impactgraph/` config written by
   the previous released version load under this one (migration or tolerant read); JSON Schemas in
   the package match the Zod source; `schema-compat` CI job green for the release commit.
7. **ADR sweep** (product-architecture): no Accepted ADR is contradicted by this release; note any
   Proposed ADR (e.g. ADR-0008) whose revisit trigger this release fires.
8. Assemble the release summary: version, changelog, checklist with evidence, `.vsix` validation
   result, privacy verification, schema-compat result — and hand it to the human.

## Required outputs

- Completed `.claude/templates/release-checklist.md` with per-item evidence.
- Versioned changesets/changelog; validated `.vsix` (path + inspection notes).
- Privacy-default verification record; schema-compat confirmation.
- A publish recommendation — explicitly marked as _recommendation_.

## Stop conditions

- Any checklist item cannot be evidenced → stop; the release does not proceed on assurances.
- Packaging pulls in excluded content, or a fresh install shows any network activity or non-default
  privacy posture → stop, route to the owning agent, restart from step 3 after the fix.
- Backward-incompatible artifact schema without a migration → stop (this should have been caught
  by `/review-contracts`; it is release-blocking here).

## Human-review points

- **Publishing is human-only.** This command never runs `vsce publish`, `npm publish`, or creates
  marketplace releases, and never advises bypassing that. The human takes the summary and decides.
- Version level (major/minor/patch) confirmation on the changeset output.

## Completion criteria

- Checklist complete with evidence; artifacts validated; the release summary is in the human's
  hands; no publish action taken by this command.
