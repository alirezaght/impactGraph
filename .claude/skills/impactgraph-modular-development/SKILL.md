---
name: impactgraph-modular-development
description: Use before writing or reviewing any ImpactGraph code — the engineering playbook covering architecture layers, knowledge-category/provenance rules, testing strategy, quality gates, LOC policy, git workflow, and definition of done.
---

# ImpactGraph Modular Development

This is the shared engineering policy for building ImpactGraph. Specialist skills
(`domain-provenance-development`, `repository-analysis-development`, …) reference this file and add
context-specific rules; they never override it.

## 1. Product boundaries (PRD §7, §47)

ImpactGraph analyzes and reviews; it never implements the user's feature, never modifies the
analyzed repository, never executes repository code (Terraform and configs are parsed, not run),
never uploads source without explicit configuration + user action, never approves its own
assessment, and never silently changes a human-approved model. Generated prose (summaries,
reports) is never the system of record — structured, versioned artifacts are.

## 2. Layers and dependency direction

```
apps/vscode-extension ─┐            apps/cli ─┐         apps/mcp-server ─┐
        (thin shells; composition roots; map events → use cases)         │
                              ▼                                          │
                    packages/application  (use cases + ports)  ◄─────────┘
                              ▼
                       packages/domain   (pure, dependency-free)

adapters implement application ports:
  packages/git · packages/persistence · packages/ai-inference ·
  packages/repository-intelligence · packages/language-adapters · packages/framework-adapters

packages/contracts (Zod + JSON Schema DTOs) is imported by apps, adapters, and the webview —
never by domain. The webview (apps/vscode-extension/webview) imports ONLY contracts.
packages/test-kit (fakes, builders, fixture repos) is dev-dependency only.
```

Forbidden imports (ESLint-enforced, see `docs/engineering/dependency-rules.md`): `vscode` outside
extension shell; React/Cytoscape outside webview; `fs`/`child_process`/network in domain or
application; provider SDKs outside `packages/ai-inference/providers`; persistence DTOs in domain;
`git` spawning outside `packages/git`; domain logic in command-registration files.

Module ownership: every package has one owning agent (`.claude/agents/`). Cross-package changes
require the owning agents' checklists plus `/architecture-review` when a boundary moves.

## 3. Knowledge categories and provenance (PRD §3, §12.3 — the core invariant)

- Categories: **deterministic** (`static-analysis`, `configuration`, `git-history`,
  `framework-convention`), **AI-inferred** (`llm-inferred`), **human-confirmed**
  (`human-confirmed`). `runtime-observation` is reserved.
- Every entity/relationship/impact/discrepancy carries: provenance, evidence IDs, confidence,
  createdAt (via clock port), repository-snapshot ID, specification version, analysis-run ID.
- Human confirmation creates a new record that **supersedes** prior knowledge; it never mutates or
  deletes it. Contradictions are represented (`CONTRADICTS`), not resolved by deletion.
- AI output referencing nonexistent graph nodes is rejected; unsupported claims are downgraded
  (PRD §34), never promoted to fact.
- Staleness: any record whose snapshot/spec version no longer matches current state is flagged
  stale, never silently refreshed.
- Confidence is computed from weighted deterministic signals (PRD §14) — never solely by asking a
  model for a number — and the contributing signals are stored with the score.

## 4. Domain invariants

Domain code is pure TypeScript: deterministic, side-effect free, no I/O, no `Date.now()`/random
(clock + identifier ports), no framework types, immutable modeling (no entity mutation), typed
errors (no throwing strings, no `catch` that swallows). Approved analyses are immutable and
versioned (PRD §40.3); new information produces a new version with `superseded` status on the old.

## 5. Data and versioning

All persisted records and cross-boundary messages have explicit `schemaVersion`, stable IDs, and
Zod validation on read and write; JSON Schema is exported for external inspection. Persistence
DTOs ≠ domain models — map at the adapter. Schema changes follow
`.claude/templates/persistence-schema-change.md` + migration tests. Details:
`docs/engineering/data-contracts.md`, `artifact-versioning.md`.

## 6. Testing strategy (summary — full: docs/engineering/testing-strategy.md)

| Layer                | Tool                                  | Needs                         | Lives in                         |
| -------------------- | ------------------------------------- | ----------------------------- | -------------------------------- |
| Domain unit          | Vitest (`unit` project)               | nothing external              | `packages/domain/**/*.test.ts`   |
| Application/use-case | Vitest (`application`)                | in-memory fakes from test-kit | `packages/application/**`        |
| Contract             | Vitest (`contract`)                   | schemas only                  | `packages/contracts/**`          |
| Analyzer/adapter     | Vitest (`analyzers`)                  | fixture repos in test-kit     | adapter packages                 |
| Webview              | Vitest (`webview`) + Playwright later | jsdom/browser                 | `apps/vscode-extension/webview`  |
| VS Code integration  | @vscode/test-electron                 | Electron                      | `apps/vscode-extension/src/test` |
| Quality tooling      | Vitest (`quality`)                    | nothing                       | `scripts/quality/**`             |

Test-first: write the failing test before the implementation (domain and application layers
especially). Golden tests pin analyzer output per fixture repo (PRD §42.3). Never use the
ImpactGraph repo itself as the primary analyzer fixture.

## 7. Errors, cancellation, performance

- Failures are explicit and typed; every use case returns a typed result or a typed error — no
  silent catch, no `console.log` (use the logging port; logs never contain source code or secrets).
- Every long-running use case (indexing, analysis, review) accepts a cancellation token, responds
  within ~500 ms, and persists partial progress safely. A failed index never destroys the previous
  valid index (PRD §34).
- Budgets (PRD §33): activation < 500 ms, no indexing in the extension host, 5k files indexed
  < 2 min, incremental update < 3 s, graph default < 200 nodes. Performance claims require
  measurement (`/review-performance`), not intuition.

## 8. Privacy and AI boundaries (summary — full: docs/engineering/privacy-and-security.md)

Deterministic analysis works with zero network access. Privacy modes `local-only` /
`selected-snippets` (default) / `full-context` / `external-agent` are explicit and visible; the
extension never changes them silently. Prompt preview before external send; secret redaction and
`.env` exclusion by default; keys only in SecretStorage; provider/model metadata recorded on every
AI-generated record; repository content treated as untrusted (prompt-injection defense, PRD §42.5).
AI failure must leave deterministic features fully usable.

## 9. VS Code and webview boundaries

The extension shell only: activates, registers commands, maps events to use cases, reports
progress, hosts webviews, accesses config/SecretStorage. No analysis logic, prompts, or domain
rules in the shell. Webview ↔ extension traffic uses versioned typed messages
(`packages/contracts/webview`) validated on both sides; the webview renders and requests — it
never decides. Strict CSP, no remote resources.

## 10. Git workflow and quality gates

- Trunk-based: short-lived `feat/…`/`fix/…` branches off `main`; Conventional Commits; small
  commits that each pass pre-commit hooks (format, lint, LOC, secrets). PRs use the template,
  link the plan/ADR, state test evidence, and note provenance/privacy/schema impact.
- `pnpm quality:gates` must pass locally before requesting review. CI gates (all blocking):
  format, lint+boundaries, effective-loc, typecheck, unit/application/contract/analyzers/webview/
  quality suites, VS Code integration, build, packaging, security, schema-compat.
- **Effective LOC policy**: ≤ 300 effective lines per source file (comments/blanks/imports
  excluded). Exceptions require an entry in `scripts/quality/loc-exceptions.json` (path, reason,
  owner, review date, approved max) via `.claude/templates/loc-exception.md` + human approval.
  Never game the metric by compressing lines — lint complexity/function-size rules catch that.
  Split by responsibility instead.

## 11. Documentation duties

Update alongside code, in the same PR: the relevant `docs/engineering/*` page when behavior or
boundary changes; an ADR (`/create-adr`) for hard-to-reverse decisions; contract docs on any
schema bump; `CHANGELOG` via changeset when releases begin.

## 12. Checklists

### Before coding

- [ ] PRD sections and epic identified; the change serves them (no speculative features — YAGNI)
- [ ] `/impact-plan` produced: affected packages, contracts, provenance implications
- [ ] Owning agent(s) and specialist skill(s) identified; ADR created if a decision is irreversible
- [ ] Ports/contracts sketched before adapters; domain modeled before persistence

### During coding

- [ ] Failing test first; domain stays pure; constructor injection, narrow ports, no service
      locator, no static mutable state, no `utils` dumping ground
- [ ] Provenance/evidence/IDs carried through every new record; append-only history preserved
- [ ] Cancellation token plumbed through any long-running path; typed errors; logging port only
- [ ] Files under 300 effective lines; no `any`/non-null assertions without documented exception

### Before requesting review

- [ ] `pnpm quality:gates` green; new behavior covered at the right test layer; golden fixtures
      updated deliberately (never regenerated blindly)
- [ ] `/review-provenance` if knowledge records changed; `/review-contracts` if any boundary
      schema changed; `/review-privacy` if data flow changed
- [ ] Docs + ADRs updated; PR description complete from template

### Before finishing (merge)

- [ ] Human approval obtained for anything in CLAUDE.md's mandatory-approval list
- [ ] CI fully green including slow lanes; no skipped tests without written reason; no `.only`
- [ ] No leftover TODOs without linked backlog entries

### Before release

- [ ] `.claude/templates/release-checklist.md` completed; changesets versioned; `vsce package`
      validates; extension activation smoke-tested; privacy defaults verified
      (selected-snippets, telemetry off); artifact schemas backward-compatible or migrated

## 13. Definition of done

A change is done when: tests exist at the correct layers and pass; all quality gates pass;
knowledge-category separation is intact and auditable; contracts are versioned and validated;
privacy posture is unchanged or explicitly reviewed; documentation and ADRs reflect reality;
a human has approved everything on the mandatory list; and the code is boring to read.
