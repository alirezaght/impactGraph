# Dependency Rules

This is the import-boundary policy for the monorepo defined in `architecture.md`. It is written to
be implemented **1:1** by `eslint-plugin-boundaries` + `eslint-plugin-import-x` in
`eslint.config.mjs` (flat config). If a rule here cannot be expressed in that config, fix the rule
or the config — never let them drift. Violations surface through `pnpm lint` (locally, in
pre-commit via lint-staged, and in the `lint` CI job) as errors, never warnings. Rationale:
ADR-0004 (ports and adapters), ADR-0013 (monorepo); CLAUDE.md rules 2–3.

### workspace-engine and app shells (Epic 12)

`packages/workspace-engine` composes application use cases with the adapter packages into the
full workflows (init, index, status, analyze, approve/decide, export, review, queries). It is an
adapter-tier package: it may import `application`, `domain`, `contracts`, and the other adapter
packages; nothing in it renders, parses argv, or speaks a transport. `apps/cli` and
`apps/mcp-server` are thin shells over it — the CLI adds argv parsing + text/markdown/JSON
rendering, the MCP server adds JSON-RPC framing + tool registry. App shells must not
re-implement a workflow that exists in the engine (that is the "no logic duplication" rule of
Epic 12). The `boundaries` ESLint plugin does not resolve `@impactgraph/*` package names, so the
cross-package direction is enforced by per-package `no-restricted-imports` zones in
`eslint.config.mjs` (`workspaceOnly(...)`): every package declares exactly which workspace
packages it may import, production code may never import `@impactgraph/test-kit`, and test
files are exempt from direction rules (they may use test-kit and cross packages) while the
hard safety net (`vscode`, `better-sqlite3`, provider SDKs) still applies to them.

## Element types

Each element type maps to a `boundaries/elements` pattern:

| Element type      | Pattern                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`          | `packages/domain/**`                                                                                                                                                               |
| `application`     | `packages/application/**`                                                                                                                                                          |
| `contracts`       | `packages/contracts/**`                                                                                                                                                            |
| `adapter`         | `packages/repository-intelligence/**`, `packages/language-adapters/**`, `packages/framework-adapters/**`, `packages/git/**`, `packages/persistence/**`, `packages/ai-inference/**` |
| `extension-shell` | `apps/vscode-extension/src/**`                                                                                                                                                     |
| `webview`         | `apps/vscode-extension/webview/**`                                                                                                                                                 |
| `cli`             | `apps/cli/**`                                                                                                                                                                      |
| `mcp-server`      | `apps/mcp-server/**`                                                                                                                                                               |
| `test-kit`        | `packages/test-kit/**`                                                                                                                                                             |
| `quality-scripts` | `scripts/quality/**`                                                                                                                                                               |

## Allowed-dependency matrix

"May import" means importing the target's public entry point (`index.ts`). Blank = forbidden.

| From ↓ / To →       | domain   | application | contracts | adapter      | extension-shell | webview  | cli      | mcp-server | test-kit |
| ------------------- | -------- | ----------- | --------- | ------------ | --------------- | -------- | -------- | ---------- | -------- |
| **domain**          | ✔ (self) |             |           |              |                 |          |          |            |          |
| **application**     | ✔        | ✔ (self)    |           |              |                 |          |          |            |          |
| **contracts**       |          |             | ✔ (self)  |              |                 |          |          |            |          |
| **adapter**         | ✔        | ✔ (ports)   | ✔         | ✔ (see note) |                 |          |          |            |          |
| **extension-shell** | ✔        | ✔           | ✔         | ✔            | ✔ (self)        |          |          |            |          |
| **webview**         |          |             | ✔         |              |                 | ✔ (self) |          |            |          |
| **cli**             | ✔        | ✔           | ✔         | ✔            |                 |          | ✔ (self) |            |          |
| **mcp-server**      | ✔        | ✔           | ✔         | ✔            |                 |          |          | ✔ (self)   |          |
| **test-kit**        | ✔        | ✔           | ✔         | ✔            |                 |          |          |            | ✔ (self) |
| **quality-scripts** |          |             |           |              |                 |          |          |            |          |

Notes:

- **domain depends on nothing** — not even `contracts`. It imports only its own modules and the
  TypeScript standard type library.
- **contracts depends on `zod` only.** Contracts are standalone DTO schemas; they never import
  domain types. Mapping between DTOs and domain models lives in application and adapters
  (`data-contracts.md`).
- **adapter → adapter** is allowed only along declared production edges:
  `repository-intelligence` → `language-adapters`/`framework-adapters`/`git`/`persistence` (it
  orchestrates them), and `framework-adapters` → `language-adapters` (framework enrichment
  consumes the fragment vocabulary — `GraphFragment`, `DecoratorFact`, `FragmentBuilder` — that
  language adapters produce; PRD §31). All other adapter-to-adapter imports are forbidden —
  adapters talk through application ports, not to each other.
- **test-kit is dev-only.** Any element may import it in `*.test.ts`/`test/**` files; no shipped
  source file may import it (enforced via a `boundaries` rule scoped by file pattern).
- **quality-scripts** import nothing from the workspace (they analyze it as text); their own tests
  run in the vitest `quality` project.
- Apps import adapters solely in their **composition roots** to bind ports; app business logic
  goes through `application`.

## Forbidden module imports per zone

Independent of package edges, these Node/npm modules are banned by zone (`import-x/no-restricted-paths`

- `no-restricted-imports`):

| Module(s)                                                                       | Allowed only in                                                                               | Forbidden everywhere else because                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `vscode`                                                                        | `extension-shell`                                                                             | Core must run in CLI/MCP/workers (PRD §29, §47.5)                            |
| `react`, `react-dom`                                                            | `webview`                                                                                     | UI stays out of engine and shell                                             |
| `cytoscape` (+ layout plugins)                                                  | `webview`                                                                                     | ADR-0005; graph rendering is a view concern                                  |
| `node:fs`, `node:fs/promises`, `node:path` (write-capable use)                  | `adapter` zone, apps, quality-scripts                                                         | domain/application are pure; I/O goes through `FileSystemPort`               |
| `node:child_process`, `node:worker_threads`                                     | `packages/repository-intelligence` (worker launch), `packages/git`, `extension-shell/workers` | Process execution is an adapter concern; never in domain/application/webview |
| Provider SDKs (`@anthropic-ai/*`, `openai`, `@google/*`, etc.)                  | `packages/ai-inference/src/providers/**`                                                      | ADR-0010; provider independence (PRD §8)                                     |
| `better-sqlite3`                                                                | `packages/persistence`                                                                        | ADR-0006; index store is swappable                                           |
| Any `git` spawning (`child_process` with `git`, `simple-git`, `isomorphic-git`) | `packages/git`                                                                                | ADR-0007; args as array, no shell interpolation                              |
| Network clients (`node:http(s)` request, `fetch` to external hosts, `axios`)    | `packages/ai-inference`                                                                       | Privacy invariants (PRD §9, §35); deterministic core is offline              |

## Structural bans

- **Deep imports forbidden.** Only package entry points may be imported
  (`@impactgraph/domain`, never `@impactgraph/domain/src/impact/...`). Enforced with
  `import-x/no-internal-modules` allowing only `index.ts` re-exports. Within a package, relative
  imports are free.
- **Circular dependencies forbidden** at both file and package level
  (`import-x/no-cycle`, `maxDepth: ∞`). A cycle between packages is an architecture bug —
  escalate to product-architecture (`bounded-contexts.md`), do not suppress.
- **No `eslint-disable` for boundary rules** without a linked LOC-exception-style entry approved
  by product-architecture. Boundary suppressions in code review are treated as merge blockers.

## How violations surface

1. Editor: ESLint diagnostics inline (flat config picked up by the ESLint extension).
2. `pnpm lint` — the single command; boundaries and restricted imports are part of the normal
   ESLint run, not a separate tool.
3. Pre-commit: lint-staged runs `eslint --fix --max-warnings 0` on staged files.
4. CI: the `lint` job blocks the PR. There is no override lane; changing the matrix means editing
   this document and `eslint.config.mjs` in the same PR, with `/architecture-review` and an ADR
   if a package edge changes.
