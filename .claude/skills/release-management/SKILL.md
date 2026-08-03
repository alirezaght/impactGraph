---
name: release-management
description: Use when preparing, verifying, or publishing an ImpactGraph release — versioning with Changesets, CHANGELOG assembly, vsce packaging, extension manifest review, pre-release privacy and compatibility verification, and the manual marketplace publish. Triggers on /prepare-release, version bumps, release branches, vsix packaging, and marketplace questions.
---

# Release Management

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` (§12 "Before
release"). Orchestrated by `/prepare-release`; the artifact of record is a completed
`.claude/templates/release-checklist.md`. Process doc: `docs/engineering/release-process.md`.

## Purpose

Ship a version of ImpactGraph whose changelog is true, whose privacy defaults are intact, whose
persisted schemas don't strand existing users, and whose `.vsix` contains exactly what we
reviewed. Releases are deliberate: **marketplace publish is a MANUAL human action — there is no
auto-publish anywhere** (locked: `release.yml` does changesets versioning + packaging +
validation only).

## When to use

Cutting any release (stable or pre-release), running `/prepare-release`, adding/reviewing
changesets, fixing packaging failures, or answering "is this releasable?".

## When NOT to use

- Deciding _what_ ships → backlog + `/impact-plan`; this skill verifies, it doesn't scope.
- Schema compatibility _design_ → `typed-message-contract-development` and
  `local-artifact-persistence`; here you only verify their outputs.
- CI pipeline changes → quality-gates work with the `testing-quality` agent.

## Required context

PRD §19 (contributed commands to review), §33 (activation budget for the smoke test),
§35 (secrets rules), §36 (telemetry off by default), §9 (privacy modes,
`selected-snippets` default); the release-checklist template; `docs/engineering/release-process.md`.

## Versioning — Changesets

- Every user-visible change lands with a changeset in its own PR (main skill §11); a PR without
  one at release time means the CHANGELOG lies — go back and add it, don't hand-edit the log.
- Semver mapping: breaking persisted-artifact/contract change or removed command → **major**
  (post-1.0) and always human-approved (CLAUDE.md mandatory list); new commands, tools, views,
  adapters → **minor**; fixes → **patch**. Pre-1.0, breaking goes in minor — say so in the notes.
- `release.yml` runs `changeset version` to produce the version PR; merging it is a human
  decision, as is everything after.

## Pre-release verification (all blocking — the checklist encodes these)

1. **Quality gates**: full CI green on the release commit including slow lanes —
   `test-vscode-integration`, `test-analyzers`, `test-webview`, `build`, `package-extension`,
   `security`, `schema-compat`. No skipped tests without written reason, no `.only`.
2. **Privacy defaults** (PRD §9, §36): fresh install defaults to `privacyMode:
selected-snippets` and telemetry **off**; verified by test or manual step recorded in the
   checklist — never assumed from reading the code. No default may have drifted via a
   configuration contribution change.
3. **Artifact schema backward compatibility**: current build opens artifact stores and
   `.impactgraph/` configs produced by the previous released version (fixtures from
   `local-artifact-persistence` migration tests + `schema-compat` job). A user updating the
   extension must never lose analyses, approved models, or audit history.
4. **Activation smoke test**: install the packaged `.vsix` (not the dev host) in a clean VS Code
   profile; extension activates < 500 ms (PRD §33), `ImpactGraph: Show Index Status` and
   `ImpactGraph: Initialize Workspace` respond, no error notifications on startup.
5. **CHANGELOG accuracy**: read the assembled CHANGELOG against the actual commit range. Every
   entry corresponds to merged work; nothing user-visible is missing; breaking changes and
   migration notes are explicit. Marketing adjectives are not changelog entries.
6. **Extension manifest review** (PRD §19): `contributes.commands` matches actually-registered
   commands — every §19 command present exactly once, no dead entries; `activationEvents` are
   the minimal set (no `*`); configuration contributions match `packages/contracts/config`;
   `capabilities.untrustedWorkspaces` still declared correctly.
7. **No secrets in the vsix**: `pnpm quality:secrets` on the release tree, then inspect the
   packaged file list (`vsce ls`) — no `.env`, no local config, no SQLite/artifact test state,
   no source maps you didn't intend, `.vscodeignore` doing its job. Unzip and spot-check.

## Packaging — @vscode/vsce

- `vsce package` runs in CI (`package-extension` job, guarded by
  `hashFiles('apps/vscode-extension/package.json') != ''`) and locally during `/prepare-release`;
  packaging failures are release blockers, not warnings.
- Validate the result: `vsce ls` file list reviewed; `.vsix` installs cleanly
  (`code --install-extension`); bundled webview assets load under the strict CSP (open the graph
  view once); extension size sanity-checked against the previous release (a 3× jump means a
  bundling regression).
- The published version, git tag, CHANGELOG heading, and `package.json` version must all agree.

## Publish — manual, human, recorded

- A human runs the marketplace publish (`vsce publish` with a marketplace token that lives
  outside the repo — never in CI secrets used by PR workflows, never in the repo, PRD §35).
- Tag the release commit; attach the checked `.vsix` to the GitHub release so the marketplace
  artifact is byte-reproducible from a recorded file.
- Pre-releases use the marketplace pre-release channel — never a stable publish "to test".
- After publish: install from the marketplace itself and re-run the activation smoke test once.

## Rollback stance

The marketplace cannot un-ship a version users already have. If a bad release goes out: publish
a fixed patch version — and because artifacts are append-only and the index is a disposable
cache (ADR-0006), the patch must read whatever state the bad version wrote (add the migration or
quarantine path first). Never instruct users to delete `.impactgraph/` or artifact stores as a
remedy.

## Common failure modes

- Auto-publish "just for pre-releases" — locked out; the manual step is the control.
- Hand-editing CHANGELOG at release time instead of fixing missing changesets — history and log
  diverge permanently.
- Smoke-testing the dev extension host instead of the packaged `.vsix` — bundling bugs ship.
- A debug `activationEvents: ["*"]` left in the manifest — activation budget destroyed in the
  field, invisible in dev.
- `.vscodeignore` gap packaging a local `.impactgraph/` or test SQLite file into the vsix.
- Shipping a contracts version bump whose migration PR missed the release branch — update
  strands existing artifact stores.
- Verifying telemetry-off by reading the default in code while a settings contribution overrides
  it — verify on a clean profile.

## Checklist

- [ ] All changesets present; version PR reviewed; version/tag/CHANGELOG/manifest agree
- [ ] Full CI green on the release commit, slow lanes included
- [ ] Privacy defaults verified on clean profile: `selected-snippets`, telemetry off
- [ ] Previous-version artifacts and config open cleanly in the release build
- [ ] Packaged `.vsix` smoke-tested: activation < 500 ms, core commands respond, graph view loads
- [ ] Manifest reviewed against PRD §19; minimal activation events
- [ ] `vsce ls` + unzip inspection clean; `pnpm quality:secrets` green
- [ ] `.claude/templates/release-checklist.md` completed and attached; human approval recorded
- [ ] Manual publish done by a human; tag pushed; `.vsix` attached to the GitHub release

## Definition of done

A human has approved and manually published a `.vsix` that passed packaging validation, the
clean-profile smoke test, privacy-default verification, and backward-compatibility checks — with
a truthful CHANGELOG, an agreeing version everywhere, and a completed release checklist on file.
