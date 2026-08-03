---
name: vscode-extension-development
description: Use when writing or reviewing code in apps/vscode-extension/src — the extension shell. Covers activation, command registration, progress and cancellation, SecretStorage, workspace trust, .impactgraph config validation, webview hosting, worker-process boundaries, error presentation, and @vscode/test-electron testing. Triggers on package.json contributes, activationEvents, vscode API usage, tree views, and extension host performance.
---

# VS Code Extension Development (Shell Only)

Shared policy lives in `.claude/skills/impactgraph-modular-development/SKILL.md` — load it first.
This skill adds the rules specific to `apps/vscode-extension/src`. Owning agent:
`vscode-integration`. Backlog: `backlog/epic-07-vscode-foundation.md`.

## Purpose

Keep the extension a **thin shell** (PRD §29.2): activate fast, register commands, map VS Code
events to `packages/application` use cases, report progress, host webviews, and present errors.
No analysis logic, no prompts, no domain rules, no indexing in the extension host.

## When to use

- Adding/changing anything under `apps/vscode-extension/src` (activation, commands, tree views
  from PRD §18.1–18.2/§18.6–18.7, status bar, configuration, SecretStorage, webview host).
- Editing the extension `package.json` manifest (`contributes.commands`, `activationEvents`,
  `contributes.configuration`, `contributes.jsonValidation`/`yamlValidation`).
- Writing `@vscode/test-electron` integration tests in `apps/vscode-extension/src/test`.

## When NOT to use

- Webview UI (React/Cytoscape) → `graph-webview-development`.
- Message/DTO schemas → `typed-message-contract-development`.
- Indexing, analysis, review logic → the engine skills; that code never lives in the shell.
- CLI or MCP server apps — different composition roots, same use cases.

## Required context

PRD §18 (UI surfaces), §19 (commands), §32 (indexing must not block the host), §33 (budgets),
§34 (reliability), §35 (security), §37 (accessibility); `docs/engineering/architecture.md`,
`dependency-rules.md`, `performance-budgets.md`.

## Expected outputs

- Command registrations that do nothing but validate input, resolve the use case from the
  composition root, wire progress + cancellation, and present the typed result or typed error.
- Manifest entries for every user-visible command (PRD §19), e.g. command IDs
  `impactgraph.initializeWorkspace`, `impactgraph.reindexWorkspace`,
  `impactgraph.analyzeSpecification`, `impactgraph.reviewWorkingTree`,
  `impactgraph.reviewCurrentCommit`, `impactgraph.approveImpactAnalysis`,
  `impactgraph.exportImplementationContext`, `impactgraph.configurePrivacy`,
  `impactgraph.showIndexStatus`, `impactgraph.clearLocalCache` — titles exactly as in §19
  (`ImpactGraph: Review Working Tree`, …).
- Integration tests for each new command/view (PRD §42.4).

## Architectural rules

- **Activation < 500 ms** (PRD §33). Activate lazily: no indexing, no SQLite open, no config
  parse beyond detecting `.impactgraph/` presence. Defer everything else to first command.
- **No indexing in the extension host** (PRD §32, §33). Long work runs in a worker/child process
  started by the shell; the shell only forwards progress events and cancellation.
- Every long-running command uses `vscode.window.withProgress` with a real
  `CancellationToken` plumbed into the use case; cancellation must take effect < 500 ms.
- The shell imports `packages/application` (use cases + ports), adapters only in the composition
  root, and `packages/contracts` for webview traffic. `vscode` is imported nowhere else in the
  monorepo (ESLint boundary).
- Webview hosting: `enableScripts` only where needed, strict CSP with nonce, `localResourceRoots`
  limited to the built webview bundle, no remote resources, messages validated against
  `packages/contracts/webview` before dispatch (both directions).
- Tree views (impact tree §18.3, architecture §18.6, review §18.7) are projections of use-case
  results — no computation in `TreeDataProvider`s.
- Errors: typed errors map to actionable notifications (what failed, what to do, "Show Logs"
  action). Never `console.log`; use the logging port. Never show raw stack traces to users.

## Domain rules

- The shell renders provenance (`static-analysis` … `llm-inferred` … `human-confirmed`) exactly
  as delivered — it never reclassifies, merges, or hides knowledge categories.
- Accept/reject/approve commands (`impactgraph.approveImpactAnalysis`, `impactgraph.rejectImpact`,
  `impactgraph.addManualImpact`) forward the user decision to a use case; the shell never mutates
  an analysis artifact itself.

## Security & privacy rules (PRD §35)

- API keys only via `context.secrets` (SecretStorage) — never settings, globalState, or files.
- Respect `vscode.workspace.isTrusted`: in untrusted workspaces disable indexing, config-driven
  execution, and any provider calls; declare `capabilities.untrustedWorkspaces` accordingly.
- Current privacy mode (PRD §9) is always visible (status bar/view) and never changed silently;
  `impactgraph.configurePrivacy` is the only shell path that changes it, with confirmation.
- `.impactgraph/*.yml` gets schema validation + autocomplete via the JSON Schema generated from
  `packages/contracts/config` (PRD §17) — register it in the manifest, don't hand-write a second
  schema.
- Logs surfaced through the OutputChannel contain IDs and structure only — no source code,
  no secrets, no full file contents.

## Testing requirements

- `@vscode/test-electron` suite in `apps/vscode-extension/src/test`, run by
  `pnpm test:integration:vscode` (CI job `test-vscode-integration`, xvfb lane). Cover: activation
  (assert < 500 ms with a measured budget test), each new command, tree views, SecretStorage
  round-trip, webview message validation, cancellation, and error states (PRD §42.4).
- Shell logic that doesn't need Electron (pure mapping/formatting) is extracted and unit-tested
  in the `unit` vitest project.
- Never assert on notification text verbatim across locales; assert on error codes/IDs.

## Common failure modes

- Doing work in `activate()` "just this once" — activation creeps past 500 ms. Measure it.
- Registering a command in code but not in `contributes.commands` (or vice versa) — CI manifest
  review and the release checklist both catch this; don't rely on them.
- Passing a fresh `CancellationTokenSource().token` instead of the one from `withProgress` —
  cancel button does nothing.
- Importing an adapter (e.g. `packages/persistence`) directly inside a command handler instead
  of resolving the use case from the composition root.
- Catching a typed error and showing `error.message` from a provider — may leak provider detail;
  map to the error taxonomy first.
- Spawning the indexer inline in the host because "the repo is small".

## Checklist

- [ ] Change stays in the shell: no analysis/prompt/domain logic added to `src/`
- [ ] Activation path unchanged or re-measured (< 500 ms)
- [ ] New commands: manifest entry + registration + integration test + PRD §19 title match
- [ ] Cancellation token reaches the use case; cancel verified in an integration test
- [ ] Secrets via SecretStorage only; workspace trust behavior stated in the PR
- [ ] Webview messages validated with `packages/contracts/webview` on the host side
- [ ] `pnpm quality:gates` green; `pnpm test:integration:vscode` green locally

## Definition of done

The shell change maps a VS Code surface to an existing use case with progress, cancellation, and
typed error presentation; activation stays under budget; manifest, schema registration, and
`@vscode/test-electron` coverage exist; and nothing in `apps/vscode-extension/src` computes,
stores, or decides what only the core engine may.
