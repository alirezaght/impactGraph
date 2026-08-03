# Release Process

How ImpactGraph versions and ships (VS Code extension via `@vscode/vsce`; CLI and MCP server
follow the same versioning). Skill: `release-management`. Checklist:
`.claude/templates/release-checklist.md`. Gates: `quality-gates.md`. Releases require **human
approval** (CLAUDE.md mandatory-approval list) — always.

## 1. Changesets flow

- **Every user-facing change ships with a changeset** in the same PR: `pnpm changeset`, pick the
  affected packages/apps, choose patch/minor/major, write the changelog entry in user language
  (what changed for them, not which file moved). Internal-only changes (CI, docs, test-kit) may
  skip with an explicit "no changeset needed" note in the PR.
- Semver judgment calls: any artifact/contract **schema version bump** is at least minor; a
  privacy-mode behavior change is never a patch; breaking a documented CLI flag or MCP tool
  contract is major.
- The Changesets bot maintains a **version PR** against `main` that aggregates pending changesets,
  bumps versions, and updates changelogs. Merging the version PR is the versioning act — it is
  reviewed like any PR and needs the same human approval as a release.

## 2. Release validation (`release.yml`)

`release.yml` is separate from `ci.yml` and runs on the version-PR merge / release tag:

- The **full gate matrix** — everything in `quality-gates.md` §1 including the slow lanes
  (`test-vscode-integration`, `test-analyzers`, `build`).
- **Packaging + validation only — no automatic marketplace publish.**

Guarded jobs (`hashFiles('apps/vscode-extension/package.json') != ''`) activate once the extension
app exists.

## 3. Packaging and manifest validation

- `@vscode/vsce` packages the extension; the run fails on manifest problems (missing publisher,
  bad `engines.vscode`, unlicensed deps, oversized bundle).
- Manifest checks beyond vsce: activation events match the command roster (no eager `*`
  activation — activation budget B1 in `performance-budgets.md`), contributed configuration keys
  match `packages/contracts/config`, and the README/changelog shipped in the VSIX are current.
- The produced `.vsix` is attached to the release run as an artifact and is what gets published —
  publish exactly the validated bytes, never a locally rebuilt package.

## 4. Manual marketplace publish

Publishing to the VS Code Marketplace (and Open VSX) is a **deliberate human action**:

- No workflow publishes automatically. A maintainer downloads the validated `.vsix` from the
  release run (or triggers a manually-dispatched publish step) after the checklist is complete.
- **Marketplace credentials are never exposed to PR jobs**: the publish token lives in a protected
  environment that only the manual publish step can access; `ci.yml` runs with least-privilege
  `permissions:` and has no access to it. A malicious PR must never be one workflow-file edit away
  from publishing.

## 5. Pre-release checklist

Complete `.claude/templates/release-checklist.md` before publishing. Highlights (the template is
authoritative): changesets versioned and changelog readable; `vsce package` validates; extension
activation smoke-tested from the actual `.vsix`; **privacy defaults verified** — privacy mode
`selected-snippets`, telemetry off (PRD §9, §36); artifact schemas backward-compatible or migrated
(`schema-compat`, `artifact-versioning.md`); performance baselines re-run for the release
(`performance-budgets.md` §3); open `Proposed` ADRs reviewed for revisit triggers that fire at
this release.

## 6. Post-release verification

Within a day of publish:

- Install the published extension from the marketplace into a clean VS Code profile; verify
  activation, initialize a fixture repo, run one analysis and one review offline
  (the offline-deterministic guarantee, `privacy-and-security.md` §1).
- Verify the marketplace listing (readme, changelog, version) matches the tag.
- Confirm no credential or token appeared in any public log of the release run.
- File issues for anything found; do not hot-edit the published package.

## 7. Hotfix path

For a defect in the published version that cannot wait for the normal train:

1. Branch `fix/<slug>` from the release tag (not from `main` if `main` has moved on with
   unreleased work).
2. Minimal fix + regression test + changeset (patch). Full `release.yml` validation runs — the
   gate matrix is **not** reduced for hotfixes (no-weakening rule, `quality-gates.md` §4).
3. Manual publish per §4, checklist per §5 (abridged only where items are demonstrably
   unaffected — noted in the PR).
4. Merge the fix back into `main` immediately so the next release contains it.

Never hotfix by republishing the same version number, and never bypass validation because "it's
one line" — one line is exactly what breaks activation.
