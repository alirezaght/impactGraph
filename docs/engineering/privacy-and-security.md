# Privacy and Security

The concrete guide to ImpactGraph's privacy and security posture. Sources of truth: PRD §9
(privacy modes), §35 (security), §36 (telemetry), §42.5 (security tests). Related docs:
`ai-provider-boundary.md` (what enters prompts), `data-contracts.md` (validated boundaries),
`testing-strategy.md`. ADRs: 0001 (local-first), 0007 (git CLI adapter), 0011 (no hosted backend).
Owning agent: `ai-inference-privacy`; skill: `ai-inference-safety`. Any change to data flow,
redaction, privacy modes, or SecretStorage requires `/review-privacy` **and human approval**
(CLAUDE.md mandatory-approval list).

## 1. Privacy modes (PRD §9)

Per-workspace, always visible in the UI, never changed silently by the extension.

| Mode                                     | What may leave the machine                                                                                                                                             | AI features                                                                                                          | Notes                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `local-only` (§9.1)                      | Nothing — no source, no repository metadata                                                                                                                            | Only via a user-configured **local** model endpoint                                                                  | Deterministic analysis fully available |
| `selected-snippets` (§9.2) — **default** | Minimum evidence for the specific analysis: relevant symbols, function signatures, selected source ranges, architecture metadata, specification text, dependency paths | Full, evidence-scoped                                                                                                | Prompt preview applies                 |
| `full-context` (§9.3)                    | Larger source sections, explicitly permitted by the user                                                                                                               | Full                                                                                                                 | Still redacted; still previewable      |
| `external-agent` (§9.4)                  | Nothing sent by ImpactGraph itself                                                                                                                                     | External agent (Claude Code, Cursor, MCP client) calls ImpactGraph tools and decides what it does with returned data | No `ModelProvider` instantiated        |

**Offline-deterministic guarantee** (ADR-0001, ADR-0011): indexing, graph construction,
deterministic impact candidates, implementation review, and export work with zero network access,
in every mode. There is no hosted backend and no remote database.

## 2. Outbound-data controls

- **No external call without explicit configuration** — a provider must be configured _and_ the
  privacy mode must permit the payload. Absence of configuration means absence of calls.
- **Prompt preview + explicit consent** (PRD §35): the user can inspect the exact final payload
  before it is sent; external model requests are inspectable.
- **Exported reports** (PRD §38) declare in their metadata whether they contain source excerpts,
  so a user knows what they are pasting into a ticket or sharing.
- **Telemetry** (PRD §36): off by default, explicit opt-in only; never source code, specification
  text, filenames, repository names, or graph content — only command usage counts, index-duration
  buckets, error categories, adapter usage, feature adoption. Visible and reversible.

## 3. Secrets

- API keys and provider credentials live in **VS Code SecretStorage only** (PRD §35). Never in
  settings JSON, never in `.impactgraph/` YAML, never committed, never in artifacts.
- Secrets never appear in persisted artifacts, the SQLite index, logs, or prompts. Logs never
  contain raw secrets or full source files (PRD §35); use the logging port, never `console.log`.
- `.env` and environment files are **excluded from indexing and prompts by default**; common
  secret patterns (keys, tokens, connection strings, private keys) are redacted before any
  evidence leaves the process. Redaction has dedicated unit tests (PRD §42.1) and its own gate in
  pre-commit: `pnpm quality:secrets` (staged scan) and the `security` CI job.

## 4. The analyzed repository is hostile input

- **Untrusted data, not instructions** (PRD §42.5): repository source, comments, and docs may
  contain prompt-injection text. Prompts delimit repository content as data; instruction text
  never originates from the repository (see `ai-provider-boundary.md` §4).
- **No repository code execution during analysis** (PRD §35): Terraform and configuration files
  are parsed, never run; no package-manager scripts (`postinstall` etc.) execute during scan;
  analysis is static only.
- **Workspace trust respected**: in untrusted workspaces the extension stays in restricted
  behavior — no configured-provider calls, no state-changing operations.
- **Shell/Git argument safety** (ADR-0007): git runs via the controlled adapter in `packages/git`
  with argument **arrays** — never shell string interpolation; no other package may spawn git.
  Shell commands require explicit user action unless clearly safe and internal (PRD §35).
- **Symlinks and path traversal**: analyzers resolve paths and refuse to follow links or `..`
  escapes outside the workspace root; oversized files are skipped and reported (PRD §42.5).
- **Restricted write locations**: persistence writes only to the workspace `.impactgraph/`
  directory and the extension's designated storage (SQLite index) — never elsewhere in the
  repository, never outside the workspace/extension storage (see ADR-0006, `artifact-versioning.md`).

## 5. Surface hardening

- **Webview**: strict CSP, no remote resources; every webview ↔ extension message is a versioned
  contract from `packages/contracts/webview`, Zod-validated **on both sides** — an invalid message
  is rejected, not partially handled (ADR-0009, `data-contracts.md`).
- **MCP server**: tools that modify state (e.g. approving a model, writing configuration) require
  appropriate confirmation (PRD §35); read-only tools are clearly separated in
  `packages/contracts/tools`.
- **CLI**: same validated contracts (`packages/contracts/cli`); no interactive secrets on argv.

## 6. Threat-model summary

Full template: `.claude/templates/threat-model.md`. Privacy reviews: `.claude/templates/privacy-review.md`.

| Asset               | Threat                                         | Mitigation                                                                                    |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Repository source   | Exfiltration via prompts                       | Privacy modes, evidence minimization, prompt preview, redaction, `.env` exclusion             |
| Secrets/credentials | Leakage to logs/artifacts/prompts              | SecretStorage only; redaction; secret scan gate (`quality:secrets`, `security` CI job)        |
| User's machine      | Code execution from analyzed repo              | Static parsing only; no scripts during scan; workspace trust                                  |
| Analysis integrity  | Prompt injection in repo content               | Data/instruction separation; output validation; node-reference rejection; downgrade (PRD §34) |
| Workspace files     | Path traversal / symlink escape / rogue writes | Path resolution guards; restricted write locations                                            |
| Git history         | Argument injection                             | Array args via `packages/git` adapter only (ADR-0007)                                         |
| Extension host      | Malicious webview messages                     | Strict CSP; Zod validation both directions                                                    |
| Approved models     | Silent mutation                                | Append-only supersession; immutable approved versions (ADR-0002)                              |
| User privacy        | Telemetry overreach                            | Off by default; content never collected (PRD §36)                                             |

## 7. Security tests (PRD §42.5 — all required)

Maintained in the suites described in `testing-strategy.md` (unit + analyzers + integration):

- Secret redaction (patterns, boundaries, prompts, logs)
- `.env` exclusion
- Malicious repository content handling
- Prompt injection inside comments or documentation
- Invalid model output (Zod rejection, node-reference rejection, downgrade path)
- Path traversal attempts
- Oversized files
- Symlink handling

The `security` CI job (secret scan + lockfile audit) blocks every PR; see `quality-gates.md`.
These tests are never skipped or weakened to get a green build.

## Provider-call choke point (Epic 13)

Every model call flows through `createGuardedProvider` (`packages/ai-inference`): privacy-mode
enforcement (external-agent blocks all calls; local-only blocks external providers), secret
redaction of every outbound prompt (`redaction.ts`, 11 pattern classes), an optional
`confirmSend` consent hook receiving the exact redacted payload, and an append-only audit log at
`.impactgraph/artifacts/ai-audit.jsonl` (summary only — provider, mode, sizes, redaction counts,
outcome; never prompt text). Providers are fetch-based (no SDK dependency); API keys come from
VS Code SecretStorage (`impactgraph.apiKey`) or `IMPACTGRAPH_API_KEY` — the `provider` config
schema deliberately has no key field. An external strategy without a key degrades to the null
provider: deterministic analysis is never blocked by AI configuration (PRD §8).
