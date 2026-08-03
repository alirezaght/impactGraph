# Test Plan: <feature / change name>

_Companion to the feature plan when test work is non-trivial. Layers and ownership:
docs/engineering/testing-strategy.md; strategy summary in the main skill §6. Test-first for domain
and application layers._

- **Plan / PR:** <link>
- **Author / date:** <name> / <YYYY-MM-DD>

## Coverage per vitest project

### unit (packages/domain)

- Covers: <invariants, supersession, staleness, confidence-signal math (PRD §14)>
- Cases: <list named tests>
- Needs: nothing external (pure domain)

### application (packages/application)

- Covers: <use cases with test-kit fakes; typed errors; cancellation token honored>
- Cases: <...>
- Fakes needed from test-kit: <existing | new: <name>>

### contract (packages/contracts)

- Covers: <schema parse/reject, schemaVersion handling, provenance fields schema-required>
- Cases: <...>

### analyzers (adapter packages)

- Covers: <analyzer/adapter behavior against fixture repos>
- Fixture repos: <existing <name> | new fixture: contents <...> — never the ImpactGraph repo itself>
- Golden files touched: <none | list — every golden diff explained in the PR, never regenerated blindly (PRD §42.3)>

### webview (apps/vscode-extension/webview)

- Covers: <render per provenance category (visually distinct), message validation, accessibility roles (PRD §37)>
- Cases: <...>

### quality (scripts/quality)

- <n/a unless quality tooling itself changes> | Cases: <...>

## @vscode/test-electron (apps/vscode-extension/src/test)

- Covers: <activation, command registration, end-to-end command → use case wiring>
- Cases: <...> | not needed because <no extension-shell change>

## Edge cases (PRD §42.5 — include where the change touches parsing, prompts, or input boundaries)

- [ ] Prompt injection inside repository comments/docs treated as data, not instructions
- [ ] Malformed repo: syntax errors, truncated files — degrade with warnings, run continues
- [ ] Oversized file, symlink loop, path traversal attempt — handled per analyzer proposal
- [ ] Invalid/hostile model output — schema-rejected; unknown node references downgraded (PRD §34)
- [ ] Corrupted artifact / SQLite file — typed error, previous valid state preserved
- [ ] Cancellation mid-operation — partial progress safe, re-run succeeds
- <n/a items: state why>

## Commands to run

- `pnpm test:unit && pnpm test:application && pnpm test:contract` (pre-push set)
- <plus: `pnpm test:analyzers`, `pnpm test:webview`, `pnpm test:integration:vscode` as applicable>

## Gaps accepted

_What is deliberately not tested and why (with backlog link if deferred)._

- <...>
