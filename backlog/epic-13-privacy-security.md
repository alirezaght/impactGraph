# Epic 13 — Privacy, Security & Telemetry

**Goal:** Configurable per-workspace privacy modes, secret safety, prompt-injection defenses, and opt-in privacy-preserving telemetry.
**Spec:** §9, §35, §36, §40.6, §42.5, Epic K (§45)
**Phase:** cross-cutting (MVP slice: 13.1–13.3) · **Depends on:** Epic 05

---

## Story 13.1 — Privacy modes

**Acceptance criteria**

- [x] Four modes implemented: local-only, selected-snippets (default), full-context, external-agent (§9). _(enforced in `createGuardedProvider` — external-agent blocks everything, local-only blocks external providers and allows local endpoints)_
- [x] No external provider is ever called without explicit configuration (§40.6); local-only permits deterministic analysis or a local model only. _(no provider config → null provider; external strategy without a key → null provider; every configured provider is guard-wrapped — no other call path exists)_
- [x] Selected-snippets sends only minimum evidence (symbols, signatures, ranges, metadata, spec text, dependency paths) (§9.2). _(current prompts send spec text (extraction) and candidate names/paths (classification) only; a mode-aware snippet builder for richer full-context prompts is open)_
- [x] Current mode always visible in UI; mode never changes silently (§9); changing privacy mode is a "material change" needing explicit action (§Z11). _(status bar + Configure Privacy since Epic 07)_

**Tasks**

- [x] Implement mode enforcement in the provider-call layer (single choke point). _(`guarded-provider.ts` — mode gate + redaction + consent + audit in one place)_
- [x] Implement snippet-minimization builder for prompts. _(`buildPromptSnippets` in ai-inference: local-only/external-agent emit nothing; selected-snippets sends symbols/signatures/user selections only; full-context capped + redacted; secret-bearing paths excluded wholesale; 6 tests)_
- [x] UI: status-bar indicator + `Configure Privacy` command (§19).
- [x] Tests: each mode blocks/allows exactly the documented data classes. _(guard matrix in `privacy.test.ts`)_

## Story 13.2 — Secrets & credentials

**Acceptance criteria**

- [x] API keys stored via VS Code SecretStorage; never in config files or logs (§35, §40.6). _(config's provider schema HAS no key field; extension stores via `context.secrets`; CLI/MCP read `IMPACTGRAPH_API_KEY`)_
- [x] `.env` and secret-bearing files excluded from indexing and prompts by default; common secret patterns redacted from any outbound payload and from logs (§35). _(scanner has excluded `.env` since Epic 02; `isSecretBearingPath` + the guard redacts every outbound prompt; audit entries carry sizes/pattern names only)_
- [x] Logs never contain raw secrets or full source files (§35). _(provider errors carry status/category only; audit is summary-only, asserted in test)_

**Tasks**

- [x] Implement SecretStorage integration + `Configure Model Provider` command.
- [x] Implement redaction engine (pattern library + tests) applied to prompts, logs, telemetry. _(11 pattern classes; telemetry does not exist yet — 13.5)_
- [x] Security tests: redaction, .env exclusion (§42.5). _(redaction + path tests; scanner exclusion tested since Epic 02)_

## Story 13.3 — Prompt preview & external-call audit

**Acceptance criteria**

- [x] User can preview exactly what would be sent externally before it is sent, where practical (§35). _(guard exposes a `confirmSend(preview)` hook with the exact redacted payload; the extension currently confirms destination+mode before the job (worker cannot prompt mid-run) — exact-payload preview UI is a follow-up; headless CLI/MCP proceed without preview, documented)_
- [x] Every external model request is recorded in a local audit log (provider, mode, payload summary, timestamp) (Epic K). _(`.impactgraph/artifacts/ai-audit.jsonl`, append-only, summary-only; blocked/declined/failed outcomes recorded too)_

**Tasks**

- [x] Implement prompt-preview UI hook in the provider layer.
- [x] Implement audit log store + viewer command. _(store done since 13.3; `impactgraph.openAiAuditLog` opens `.impactgraph/artifacts/ai-audit.jsonl` read-only in the editor, "no AI calls recorded yet" info message when absent)_
- [x] Tests: audit entries created for each call; none in external-agent mode. _(external-agent audits a 'blocked' entry and provably never reaches a provider)_

## Story 13.4 — Prompt-injection & malicious-repo defenses

**Acceptance criteria**

- [x] Repository source and comments are treated as untrusted data, never instructions (§42.5). _(extraction/classification prompts delimit repo/spec content and declare it untrusted; hostile symbol names flow through as data)_
- [x] Injection attempts embedded in code/docs do not alter analysis behavior (fixture-tested). _(`fixtures/malicious` + `repository-intelligence/src/security.test.ts`: injection class names parsed as inert symbols)_
- [x] Invalid model output, path traversal, oversized files, symlinks are all handled per §42.5. _(invalid output → typed error (provider tests); traversal imports contained; oversized + symlink loop/escape → warnings, never crashes)_

**Tasks**

- [x] Add data/instruction separation in prompt construction (delimiting, role separation). _(in place since the extractor/classifier prompts; guard adds redaction on top)_
- [x] Build malicious-repo fixture (injection strings, traversal names, symlink loops). _(committed fixture + runtime-created symlinks/oversized file — symlinks are not committable cross-platform)_
- [x] Add the §42.5 security test suite to CI. _(analyzers project → `quality:gates` and CI)_

## Story 13.5 — Telemetry (opt-in)

**Acceptance criteria**

- [x] Telemetry is off by default; explicit opt-in; visible and reversible (§36). _(`impactgraph.telemetry.enabled` default false AND gated on VS Code's global switch; events land in a visible output channel; no remote transmission exists)_
- [x] Never collected: source code, spec text, filenames, repository names, graph content (§36). _(structurally impossible: events built only via allowlist constructors — enums, buckets, counts; tested incl. path-smuggling attempts)_
- [x] Only allowed metrics: command usage counts, index-duration buckets, error categories, adapter usage, feature adoption (§36). _(exactly the five §36 event constructors; anything else has no constructor)_

**Tasks**

- [x] Implement telemetry client with allowlisted event schema. _(events.ts constructors + client.ts gated sink; command registration records usage)_
- [x] Settings UI + docs. _(contributes.configuration `impactgraph.telemetry.enabled` with full markdown description of behavior and denylist)_
- [x] Test: no denylisted fields can be emitted (schema-enforced). _(events.test.ts: paths, messages, repo names, free text all rejected by construction)_
