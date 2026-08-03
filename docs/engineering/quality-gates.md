# Quality Gates

Every automated gate, its exact command, what it checks, where it runs, and why it blocks.
Local umbrella: `pnpm quality:gates` (= `format:check` + `lint` + `quality:loc` + `typecheck` +
`test:unit` + `test:application` + `test:contract` + `test:analyzers` + `test:cli` +
`test:quality`) — run it before requesting
any review (`/run-quality-gates`). Hook wiring: `git-workflow.md`. Test-layer detail:
`testing-strategy.md`. Owning agent: `testing-quality`.

All vitest suites run with `--passWithNoTests` so the setup is green before product source exists;
CI jobs that need product apps are guarded with
`hashFiles('apps/vscode-extension/package.json') != ''`.

## 1. Gate catalog

| Gate                 | Exact command                                                             | Checks                                                                                                                                            | CI job (`ci.yml`)                           | Why it blocks                                                                                 |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Formatting           | `pnpm format:check` (`prettier --check .`)                                | Consistent formatting, zero-diff style                                                                                                            | `format`                                    | Style churn hides real diffs in review                                                        |
| Lint + boundaries    | `pnpm lint` (`eslint .`)                                                  | typescript-eslint rules, **eslint-plugin-boundaries** dependency direction, import hygiene (import-x), complexity/function-size (anti-LOC-gaming) | `lint`                                      | Forbidden imports break the ports-and-adapters architecture (ADR-0004, `dependency-rules.md`) |
| Effective LOC        | `pnpm quality:loc` (`tsx scripts/quality/effective-loc/src/cli.ts`)       | ≤ 300 effective lines per source file; expired exceptions fail                                                                                    | `effective-loc` (dedicated, visible)        | Reviewability and single responsibility (ADR-0012, `effective-loc-policy.md`)                 |
| Types                | `pnpm typecheck` (root `tsc --noEmit` + `pnpm -r --if-present typecheck`) | Strict TypeScript across the monorepo                                                                                                             | `typecheck`                                 | Type errors are defects, not warnings                                                         |
| Domain unit          | `pnpm test:unit`                                                          | Pure domain logic (confidence, diff, redaction, rules — PRD §42.1)                                                                                | `test-unit`                                 | Core invariants (ADR-0002) live here                                                          |
| Application          | `pnpm test:application`                                                   | Use cases against test-kit fakes; provenance, cancellation, degradation                                                                           | `test-application`                          | The product's behavior contract                                                               |
| Contract             | `pnpm test:contract`                                                      | All `packages/contracts` schemas round-trip + version rules                                                                                       | `test-contract`                             | Unvalidated boundaries corrupt artifacts (ADR-0009)                                           |
| Analyzers            | `pnpm test:analyzers`                                                     | Fixture + golden suites, git adapter suite                                                                                                        | `test-analyzers`                            | Silent analyzer drift invalidates every downstream result (PRD §42.3)                         |
| Webview              | `pnpm test:webview`                                                       | Message handling, rendering states, a11y roles                                                                                                    | `test-webview`                              | The webview is a validated boundary too                                                       |
| Quality tooling      | `pnpm test:quality`                                                       | The LOC checker and secret scanner themselves                                                                                                     | `test-quality`                              | A broken gate is worse than no gate                                                           |
| VS Code integration  | `pnpm test:integration:vscode`                                            | All nine PRD §42.4 areas + an untrusted-workspace lane (§35); see `testing-strategy.md` §1.6                                                      | `test-vscode-integration` (xvfb, slow lane) | The extension shell is where users live                                                       |
| Build                | package builds                                                            | Everything compiles and bundles                                                                                                                   | `build`                                     | Unbuildable main is undeployable main                                                         |
| Packaging            | `@vscode/vsce` package + manifest validation                              | Extension packages cleanly, manifest sane                                                                                                         | `package-extension` (guarded)               | Catch release blockers on every PR, not at release                                            |
| Security             | `pnpm quality:secrets` + lockfile audit                                   | No committed secrets; no known-vulnerable deps                                                                                                    | `security`                                  | PRD §35; a leaked key is unrecoverable                                                        |
| Schema compatibility | artifact/contract compat check                                            | Version bumps are backward compatible or migrated                                                                                                 | `schema-compat` (guarded)                   | Artifacts are append-only records (ADR-0006, `artifact-versioning.md`)                        |
| Commit format        | commitlint (`@commitlint/config-conventional`)                            | Conventional Commits                                                                                                                              | — (commit-msg hook)                         | Changesets/release notes depend on it                                                         |

## 2. Where each gate runs

| Gate                                    | Pre-commit                                  | Pre-push | PR             | main | Release (`release.yml`) |
| --------------------------------------- | ------------------------------------------- | -------- | -------------- | ---- | ----------------------- |
| Formatting                              | ✔ (prettier write via lint-staged)          | —        | ✔              | ✔    | ✔                       |
| Lint + boundaries                       | ✔ (`eslint --fix --max-warnings 0`, staged) | —        | ✔              | ✔    | ✔                       |
| Effective LOC                           | ✔ (`quality:loc --files <staged>`)          | —        | ✔              | ✔    | ✔                       |
| Secret scan                             | ✔ (`quality:secrets --staged`)              | —        | ✔ (`security`) | ✔    | ✔                       |
| Commit format                           | ✔ (commit-msg)                              | —        | —              | —    | —                       |
| Typecheck                               | —                                           | ✔        | ✔              | ✔    | ✔                       |
| Unit / application / contract / quality | —                                           | ✔        | ✔              | ✔    | ✔                       |
| Analyzers / webview                     | —                                           | —        | ✔              | ✔    | ✔                       |
| VS Code integration                     | —                                           | —        | ✔              | ✔    | ✔                       |
| Build / packaging / schema-compat       | —                                           | —        | ✔              | ✔    | ✔ + release validation  |

Rationale for the split: hooks must stay fast (see `git-workflow.md` — Electron tests, analyzer
fixture suites, and builds are deliberately not in hooks). CI is the complete net; hooks are the
early net.

## 3. CI mechanics (`ci.yml`)

Jobs: `format`, `lint`, `effective-loc`, `typecheck`, `test-unit`, `test-application`,
`test-contract`, `test-analyzers`, `test-webview`, `test-quality`, `test-vscode-integration`,
`build`, `package-extension`, `security`, `schema-compat`. Concurrency-cancel on PRs,
least-privilege `permissions:`, pnpm store cache, Node from `.nvmrc` via `node-version-file`.
`release.yml` is separate — full gates + packaging validation, **no automatic marketplace
publish** (`release-process.md`).

## 4. The no-weakening rule

Gates are **never** loosened to get green. Concretely forbidden as fixes: raising the LOC limit,
adding a lint `disable` without a documented exception, adding `--passWithNoTests` semantics to a
suite that has tests by deleting them, `.only`/skips without written reason, blanket-regenerating
goldens, marking a CI job non-required, and lowering `--max-warnings`... in the wrong direction.

When a gate fails:

1. Reproduce locally with the exact command from §1.
2. Route to the **owning agent** of the failing area (`.claude/agents/` — e.g. analyzer golden
   diff → `repository-intelligence` or `language-adapter`; boundary lint → `product-architecture`;
   LOC → split by responsibility per `effective-loc-policy.md`).
3. Fix the cause. If the gate itself is wrong, that is a change to this document + human approval
   — an explicit decision, never a quiet config edit.

Legitimate escape hatches exist and are all reviewed and expiring: LOC exceptions
(`scripts/quality/loc-exceptions.json` + `.claude/templates/loc-exception.md`), documented lint
disables with reasons, deliberately updated goldens with explained diffs.
