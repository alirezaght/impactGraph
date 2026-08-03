# Release Checklist: v<version>

_Run via `/prepare-release` with the release-management skill. Publishing is manual and
human-signed — release.yml packages and validates only (no automatic marketplace publish)._

- **Version:** <x.y.z> · **Release owner:** <human name> · **Date:** <YYYY-MM-DD>
- **Release branch / tag:** <ref>

## Version and changesets

- [ ] All merged changes since last release have changesets; `changeset version` run and reviewed
- [ ] Version bump matches content: <patch | minor | major — breaking contract/artifact changes
      force at least minor; justify: <...>>
- [ ] No unreleased breaking change hidden as patch

## Quality gates — all green, including slow lanes

- [ ] `pnpm quality:gates` locally: <run link/output>
- [ ] CI on the release ref: format, lint, effective-loc, typecheck, test-unit, test-application,
      test-contract, test-analyzers, test-webview, test-quality — green
- [ ] Slow lanes green: test-vscode-integration (xvfb), build, package-extension, security,
      schema-compat
- [ ] No skipped tests without written reason; no `.only` anywhere

## Extension packaging (@vscode/vsce)

- [ ] `better-sqlite3` is still a **Node-API** build (ADR-0006 Outcome): one binary must serve
      both the system Node and Electron. Verify with `pnpm test:integration:vscode` — an ABI
      regression shows up there as `NODE_MODULE_VERSION … requires …`, never in the unit suites.
- [ ] `vsce package` succeeds; `.vsix` size <n> MB — sane vs previous release (<n> MB)
- [ ] `.vsix` contents inspected: no test-kit fixtures, no source maps beyond policy, no `.env`,
      no credentials, no scratch files

## Activation smoke test

- [ ] `.vsix` installed into a clean VS Code; activation < 500 ms without indexing (PRD §33)
- [ ] Initialize Workspace + first index on a fixture repo works end to end
- [ ] Deactivate/uninstall leaves no orphaned processes or corrupted workspace storage

## Privacy defaults verified (PRD §9, §36)

- [ ] Fresh install privacy mode = `selected-snippets` (default), visible in UI
- [ ] Telemetry off by default; no network calls on activation without configuration (verified
      with a network monitor or offline run)
- [ ] Prompt preview functional; SecretStorage-only key handling confirmed

## Artifact schema compatibility

- [ ] Workspaces created by previous release open cleanly: JSON artifacts read (migrated per
      persistence-schema-change docs), SQLite index rebuilt or migrated without data loss
- [ ] schema-compat CI job green; any schemaVersion bumps this release listed: <none | list + template links>
- [ ] Append-only history from old workspaces preserved after upgrade

## Docs and CHANGELOG

- [ ] CHANGELOG generated from changesets and human-edited for accuracy
- [ ] README / docs/engineering pages reflect shipped behavior; no docs promising unshipped features
- [ ] New/changed MCP tools and CLI commands documented

## Manifest review

- [ ] `apps/vscode-extension/package.json`: version, engines.vscode, activation events (narrow),
      contributed commands/settings match reality, categories/keywords sane
- [ ] Dependency and license audit clean (security CI job)

## Manual publish sign-off

- **Human sign-off to publish:** <name / date / signature comment>
- [ ] Tag pushed; `.vsix` archived; post-publish install-from-marketplace smoke test done
- [ ] Rollback plan noted: <previous version re-publish steps / known-good `.vsix` location>
