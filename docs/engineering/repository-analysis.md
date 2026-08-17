# Repository Intelligence Engine

Design reference for the Repository Intelligence Engine (PRD §C15.1): deterministic repository
discovery, indexing, and knowledge-graph construction. Code lives in
`packages/repository-intelligence`, orchestrated by `application/index-repository`, with parsing
delegated to `packages/language-adapters` / `packages/framework-adapters`
(`language-adapters.md`), git state from `packages/git`, and storage in the SQLite index via
`packages/persistence` (ADR-0006). Owner: repository-intelligence agent (`bounded-contexts.md`).
Everything this engine produces is a **deterministic fact** — provenance `static-analysis`,
`configuration`, `git-history`, or `framework-convention`; never `llm-inferred`
(`provenance-model.md`).

## Pipeline

```
scan → hash → parse (adapters) → graph assembly → snapshot binding
```

1. **Scan** (`repository-intelligence/src/scanner`): walk the workspace through the
   `FileSystemPort`; apply ignore rules from `.impactgraph/config.yml` (PRD §17) plus defaults
   (`node_modules/**`, `dist/**`, `.terraform/**`, …); respect `.env` exclusion (PRD §35); handle
   symlinks and oversized files defensively (PRD §42.5 — repository content is untrusted; never
   follow links out of the workspace; cap file size, skip and report). Ignored paths never appear
   in results (PRD §40.1).
2. **Hash** (`src/hasher`): content-hash every candidate file. Hashes are the incremental-indexing
   currency and part of the dirty-state digest in snapshot IDs (`artifact-versioning.md`).
3. **Parse**: route each file to the registered `LanguageAdapter` by extension/detection; adapters
   return `GraphFragment`s of language-neutral facts (PRD §30, §C14). Files no adapter claims go
   to the **fallback adapter** (below). Adapters run inside the worker, never the extension host.
4. **Graph assembly** (`src/assembly`): merge fragments into the shared Repository Knowledge
   Graph — resolve cross-file references (import targets, call edges), dedupe nodes by
   deterministic ID, then run **framework detection handoff**: `FrameworkAdapter.detect(graph)`
   followed by `enrich(...)` for each detected framework (PRD §31), adding e.g. NestJS modules,
   Express routes, Terraform→Cloud Run `DEPLOYED_AS` edges, Pub/Sub `PUBLISHES`/`SUBSCRIBES_TO`
   edges — including the cross-stack edges of PRD §C13. Custom detection rules (§Z8) run here too,
   flagged as custom (`language-adapters.md`).

   Unresolved references stay warnings — with one modelled exception: an `extends`/`implements`
   reference whose target lives outside the index (a mixin in site-packages, a vendor base class)
   becomes an `unresolved-external-boundary` node (`external-type:<file>#<name>`, provenance
   `static-analysis`) with a real `EXTENDS`/`IMPLEMENTS` edge. Dropping it stated the class's
   member set as complete when it was not, and the assumption check then fabricated
   "member does not exist" for members inherited from unindexed bases
   (the `SqlOutboundQueueRepository.list_rows` field failure). The boundary node is what lets
   `resolveMember` (domain) answer "could not verify" instead: a member set reachable from such a
   node is OPEN, and only closed-world absence may block a plan.

5. **Snapshot binding**: the finished index generation is bound to a repository snapshot
   descriptor — repo identity, branch, commit, dirty status, index version, timestamp (PRD §23.1,
   §32: "the index must be tied to a repository snapshot"). Every fact carries that
   `repositorySnapshotId`.

## Generic discovery (PRD §15.1)

Independent of framework adapters, the engine identifies: workspaces, packages, source roots,
test roots, build configuration, entry points, imports, symbols, routes, data models, migrations,
jobs, environment configuration, and infrastructure files. This deterministic inventory is what
zero-configuration onboarding builds on (§Z3–Z4): the AI generates configuration _from_ these
detection results (`impactgraph.detect_stack`, `detect_repository_structure` — §Z7); this engine
never guesses — inference belongs to other engines and is labeled as such (PRD §15.3).

Currently implemented in `src/assembly/package-facts.ts` (workspaces, packages, package→file
CONTAINS) and `src/assembly/discovery-facts.ts`:

| Fact                 | Emitted as                                        | Provenance        | Evidence                                          |
| -------------------- | ------------------------------------------------- | ----------------- | ------------------------------------------------- |
| Source / test root   | `directory:<path>` node + package `CONTAINS` root | `static-analysis` | `file-presence` on the dir                        |
| Build config file    | `CONFIGURES` edge file → package                  | `configuration`   | `file-presence` on the file                       |
| Manifest entry point | `EXPOSES` edge package → file                     | `configuration`   | `config-entry` on `main`/`module`/`bin`/`exports` |

Roots are the conventional directories (`src`, `lib`, `app`, `test`, `tests`, `__tests__`, `spec`)
that actually exist in the scan; the closed §12.1 node roster has no dedicated source-root or
test-root type, so both share `directory` and are distinguished by path. Build config is
manifest-adjacent `tsconfig.json`, `vite.config.*`, `esbuild.*`, `webpack.config.*`, `Makefile`,
`Dockerfile`. Entry points whose target file does not exist (typically build output) are dropped
rather than guessed. Nothing here parses configuration beyond the manifest JSON already read for
package discovery.

## Incremental indexing (PRD §32)

- **Change detection**: rescan compares stored vs. current hashes; only changed/new/deleted files
  proceed (PRD §40.1: "incremental re-indexing updates changed files only").
- **Scoped invalidation**: a changed file invalidates its own fragments plus assembly outputs that
  referenced them (reverse-dependency tracking in the index); framework enrichment re-runs only
  for affected subgraphs.
- **Generation model**: a new index generation is built beside the current one and swapped in only
  after validation — a failed index never destroys the previous valid index (PRD §34;
  `artifact-versioning.md` validate-before-replace).
- Budget: incremental update < 3 s for a small change; initial index of 5,000 files < 2 min
  (PRD §33 — product targets; measure via `/review-performance`, see `performance-budgets.md`).
- Human-confirmed architecture is never overwritten by reindexing (PRD §43.3); reindex output that
  conflicts with a `human-confirmed` record creates a `CONTRADICTS` link or a staleness flag, per
  `provenance-model.md`.

## Execution model: worker, never the extension host

Indexing runs in a child process (Node) spawned and supervised by
`apps/vscode-extension/src/workers/` — required by PRD §32/§33 (no indexing in the extension host;
activation < 500 ms) and by `dependency-rules.md` (`node:child_process` allowed only in designated
zones). The CLI and MCP server run the same pipeline in-process or in a worker thread — the engine
itself is host-agnostic (no `vscode` import anywhere in it). Communication with the worker uses
typed, versioned messages; progress and warnings stream back incrementally.

## Cancellation and partial progress

- Every entry point accepts a `CancellationToken` (application port) and must respond within
  ~500 ms (our budget) — checked between files and between pipeline stages, and passed into
  adapters for long single-file parses.
- Cancellation persists partial progress **safely**: completed, validated file fragments are kept
  with their hashes so the next run resumes; the half-built generation is never swapped in. Cancel
  never corrupts, and never loses the previous valid index.
- Progress reporting (PRD §32): files scanned/parsed/total, current phase, per-adapter counts —
  surfaced as VS Code progress, CLI output, and `impactgraph.get_workspace_status`.

## Failure isolation per file

A parser crash or pathological file must cost exactly one file (PRD §32 "recover from parser
failure", §34 "allow analysis to continue with partial language support"):

- Each file parse is wrapped; failures produce a typed `ParseFailure` record (file, adapter,
  error category, recoverable flag) — recorded as a parser warning, not thrown up the pipeline.
- Failed files fall back to the fallback adapter so they still exist in the graph.
- Repeated adapter-wide failure (e.g. grammar failed to load) degrades that adapter for the run
  and reports it once, loudly — see the degradation matrix in `language-adapters.md`.
- The engine never executes repository code — Terraform, configs, and scripts are parsed, not run
  (PRD §35, §47.17).

## Unsupported-language fallback

Files without a supporting adapter still yield deterministic value via the fallback adapter
(`language-adapters/src/fallback`): File and Directory nodes, `CONTAINS` edges, size/hash
metadata, and conservative text-level evidence (path-based references, env-var mentions). Facts,
provenance `static-analysis`, low-granularity — clearly reported as partial support (PRD §34
"clearly report unsupported files or frameworks"), never silently absent.

## Index status reporting

`ImpactGraph: Show Index Status` (PRD §19), `impactgraph status` (§20), and
`impactgraph.get_workspace_status` (§21) all read one status structure: bound snapshot (commit,
branch, dirty), index generation + `indexSchemaVersion`, file counts (indexed / fallback-only /
failed / ignored), per-adapter coverage, parser warnings, last full and incremental run durations,
and staleness (snapshot vs. current HEAD/working tree). Status is a first-class contract
(`contracts/cli`, `contracts/tools`) — agents decide whether to reindex based on it (§Z3 step 8–9).

Implemented today on that shared structure: `freshness` (derived at answer time by the same
assessor the analyze path uses — never persisted; git being unavailable degrades, it never fails
status), categorized `indexWarnings` whose `totalCount` is always the true total (when the
persisted warning list was capped, the report says `sampled: true` with `omittedWarningCount`
instead of letting two tools disagree about the same fact), `ignoredCount`, the repository-roster
`limitations`, and a `server` block whose version is read from the app's own manifest (degrading to
`unknown`, never a fabricated number; `impactgraph --version` mirrors it). Per-repository index
states carry a typed `reasonCode` (`not-indexed` | `disabled` | `path-missing` |
`path-outside-root`); every downstream derivation (required actions, coverage block, review scope)
keys off the code — human-readable reason sentences are presentation, never the API.
