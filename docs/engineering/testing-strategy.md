# Testing Strategy

Full strategy behind the summary in `impactgraph-modular-development` SKILL.md §6. PRD sources:
§42 (testing requirements), §33 (performance), §42.5 (security tests — enumerated in
`privacy-and-security.md` §7). Owning agent: `testing-quality`. Gates and commands:
`quality-gates.md`. Test-first is the default: write the failing test before the implementation,
especially in domain and application layers.

## 1. Layers

### 1.1 Pure domain unit — vitest project `unit` (`pnpm test:unit`)

- **Covers** (PRD §42.1): graph model, confidence calculation (signal weighting, §14),
  requirement extraction schemas, diff comparison logic, evidence validation, architecture rules,
  export formatting, redaction, configuration parsing, adapter interface conformance.
- **Location**: `packages/domain/**/*.test.ts` (and pure logic in other packages).
- **Needs**: nothing external — no I/O, no clock, no fs. Fast enough for pre-push.

### 1.2 Application / use-case — vitest project `application` (`pnpm test:application`)

- **Covers**: use cases end to end against ports — provenance stamping, supersession, staleness
  flagging, cancellation behavior, typed error paths, partial-failure degradation (AI failure
  leaves deterministic results intact).
- **Location**: `packages/application/**/*.test.ts`.
- **Needs**: in-memory fakes and builders from `packages/test-kit` (fake clock, fake persistence,
  fake `ModelProvider`, fake git port). No real adapters.

### 1.3 Contract — vitest project `contract` (`pnpm test:contract`)

- **Covers**: every schema in `packages/contracts` (webview, tools, cli, artifacts, config) —
  round-trip validation, version acceptance/rejection, JSON Schema export, backward compatibility
  of bumped versions (paired with the `schema-compat` CI job).
- **Location**: `packages/contracts/**/*.test.ts`.

### 1.4 Repository analyzer — vitest project `analyzers` (`pnpm test:analyzers`)

- **Covers**: language/framework adapters and repository-intelligence against **fixture repos**,
  pinned by **golden tests** (PRD §42.3): expected graph nodes/edges per fixture, expected impact
  results for sample specifications, expected review results for sample diffs.
- **Location**: adapter packages (`packages/repository-intelligence`, `packages/language-adapters`,
  `packages/framework-adapters`) with fixtures in `packages/test-kit/fixtures`.

### 1.5 Git — vitest project `analyzers` (lives in `packages/git`)

- **Covers**: staged + unstaged changes, commit ranges, renames, copies, deletions, binary files,
  submodules, ignored files, untracked files, merge commits, empty diffs, and missing baselines
  (approved model references a commit that no longer exists). Argument-array safety (ADR-0007).
- **Needs**: programmatically constructed temporary git repositories (built by test-kit helpers) —
  deterministic author/date/committer so goldens are stable.

### 1.6 VS Code integration — `@vscode/test-electron` (`pnpm test:integration:vscode`)

- **Covers** (PRD §42.4): extension activation, commands, tree views, editor navigation,
  configuration editing, SecretStorage, webview communication, cancellation, error states.
- **Location**: `apps/vscode-extension/src/test` (see its `README.md`). Runs under xvfb in CI
  (`test-vscode-integration` job — the slow lane). Never in git hooks, never in
  `pnpm quality:gates`: it downloads and launches Electron.
- **Build**: the suites are bundled to CJS by `src/test/build.mjs` (esbuild, same as the
  extension — there is no `tsc` emit step) into `dist/test/`, with `dist/test/package.json`
  pinning `{"type":"commonjs"}`. Files are `*.ts`, not `*.test.ts`, so the `extension` vitest
  project never collects them and the repo-wide test lint override (which forbids importing
  `vscode`) does not apply; `apps/vscode-extension/src/test/**` has its own ESLint override
  with the same test allowances.
- **Two launches per run**: a _trusted_ lane (`--disable-workspace-trust`) for the nine areas,
  and an _untrusted_ lane that leaves workspace trust on so PRD §35 restricted-mode behavior is
  exercised for real. Each lane gets a throwaway user-data dir, extensions dir, and workspace —
  a fresh `git init`-ed copy of `packages/test-kit/fixtures/ts-basic` (the fixture itself is
  never modified; analyzer goldens depend on it).
- **Runner**: a ~90-line registry in `src/test/harness.ts` (`node:assert/strict`), not Mocha —
  `--extensionTestsPath` only requires a module exporting `run(): Promise<void>` that rejects
  on failure, and this keeps the dependency tree unchanged. `skipTest(reason)` prints the skip
  and repeats it in the summary; a lane that skipped everything is impossible to misread as
  green.
- **Rules**: assert on command ids, files on disk and engine state — never on notification text
  (locale-fragile) and never on webview internals. Suites share one window and one workspace, so
  their order in `suite/index.ts` is part of the contract.

### 1.7 Webview — vitest project `webview` (`pnpm test:webview`), Playwright in a later milestone

- **Covers**: message-contract handling both directions, rendering states (loading, partial,
  error, stale), graph interaction logic (headless Cytoscape), accessibility roles (PRD §37).
- **Location**: `apps/vscode-extension/webview`.

### 1.8 E2E happy path (mocked AI)

Runs inside the VS Code integration lane. The flow: open fixture repo → submit specification →
deterministic analysis → **mocked AI inference** (fake `ModelProvider` from test-kit — never a
live provider in CI) → modify + approve model → apply a simulated diff to the fixture →
run review → inspect discrepancies (matched / missing / unexpected / divergent). This proves the
whole product loop without network access.

### 1.9 Quality tooling — vitest project `quality` (`pnpm test:quality`)

- **Covers**: the effective-LOC checker itself (tokenizer edge cases, exception expiry, exit
  codes) and the secret scanner. Location: `scripts/quality/**`.

### 1.10 Performance benchmarks

Benchmark fixtures and methodology are defined in `performance-budgets.md`. Run locally via
`/review-performance` and mandatorily before release; not a per-PR CI gate initially (measured,
recorded baselines instead of flaky CI thresholds).

## 2. Fixture strategy

- All fixture repos live in `packages/test-kit/fixtures`. PRD §42.2 target set: TypeScript
  Express, NestJS, Python FastAPI, Java, Astro, Terraform GCP, Cloud Run service, Pub/Sub
  publisher+consumer, monorepo, database-migration workflow — added incrementally with adapters.
  Indexed today: `ts-basic`, `express-app`, `nestjs-app`, `internal-pubsub`, `malicious`.
  Committed as inert file fixtures until their Epic 16 adapters land: `fastapi-app`,
  `java-spring`, `astro-site`, `terraform-gcp`.
- **Never use the ImpactGraph repository itself as the primary analyzer fixture** — it changes
  constantly and would couple product tests to our own refactors.
- Fixtures are minimal but real: real imports, real routes, real configs — no lorem-ipsum stubs.

## 3. Golden-test discipline

- Goldens (expected nodes/edges/impacts/reviews per fixture) are committed and reviewed like code.
- Update goldens **deliberately, one behavior change at a time**, with the diff explained in the
  PR — never blanket-regenerate to silence failures. A golden diff without a corresponding
  intentional analyzer change is a bug report, not an update.
- Goldens are ordered/normalized (stable IDs, sorted output) so diffs are readable.
- Graph goldens live in `packages/test-kit/goldens/<fixture>.graph.txt` (one sorted line per
  node/edge; volatile fields excluded), produced by `serializeGraphGolden` from test-kit and
  compared by `graph-goldens.test.ts` in the analyzers suite — which runs in CI, so the
  committed-golden comparison is the CI diff. Regenerate deliberately with
  `UPDATE_GOLDENS=<fixture> pnpm test:analyzers graph-goldens` — **scoped to one fixture** — and
  justify every changed line in the PR. `UPDATE_GOLDENS=1` rewrites EVERY golden and should be
  avoided while other work is in flight: a blanket regeneration silently adopts whatever
  unrelated in-progress code is on disk, producing a golden that nobody deliberately reviewed.
  (This happened on 2026-08-02 and is why the flag is scopeable.)
- Impact goldens (`<fixture>.<sample>.analysis.txt`) and review goldens
  (`<fixture>.<target>.review.txt`) live beside them, produced by `serializeAnalysisGolden` /
  `serializeReviewGolden` and compared by `analysis-goldens.test.ts`. The graph goldens pin what
  the repository **is**; these pin what the engine **concludes** — an impact line carries
  likelihood, impact type, directness, confidence to two decimals, and the contributing
  confidence signals, so a weighting change cannot slip through unreviewed. Impacts are keyed by
  component name rather than node id, so an id-scheme refactor does not churn every golden.
  Regenerate with `UPDATE_GOLDENS=1 pnpm test:analyzers analysis-goldens`.

## 4. When each layer runs

| Layer (project)              | Local dev             | Pre-commit | Pre-push | PR (CI job)               | main | Release       |
| ---------------------------- | --------------------- | ---------- | -------- | ------------------------- | ---- | ------------- |
| Domain unit (`unit`)         | on save/watch         | —          | ✔        | `test-unit`               | ✔    | ✔             |
| Application (`application`)  | ✔                     | —          | ✔        | `test-application`        | ✔    | ✔             |
| Contract (`contract`)        | ✔                     | —          | ✔        | `test-contract`           | ✔    | ✔             |
| Analyzer + git (`analyzers`) | on demand             | —          | —        | `test-analyzers`          | ✔    | ✔             |
| Webview (`webview`)          | on demand             | —          | —        | `test-webview`            | ✔    | ✔             |
| VS Code integration (+E2E)   | on demand             | —          | —        | `test-vscode-integration` | ✔    | ✔             |
| Quality tooling (`quality`)  | on demand             | —          | ✔        | `test-quality`            | ✔    | ✔             |
| Perf benchmarks              | `/review-performance` | —          | —        | —                         | —    | ✔ (checklist) |

Pre-commit runs no test suites — it runs prettier, eslint --fix, staged LOC, and secret scan (see
`git-workflow.md`). All vitest projects use `--passWithNoTests` so the setup is green before
product source exists.

## 5. Non-negotiables

- No `.only`, no skipped tests without a written reason in the PR.
- Tests never hit the network; AI is always the test-kit fake in CI.
- New behavior is covered **at the right layer** — an integration test is not a substitute for a
  missing domain unit test.
- Failures route to the owning agent; gates are never loosened (see `quality-gates.md`).
