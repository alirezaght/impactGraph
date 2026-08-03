# ADR-0006: Hybrid Persistence — SQLite Index, JSON Artifacts

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

ImpactGraph persists two very different kinds of local state (PRD §28):

1. **The repository index** — nodes, edges, symbols, file hashes, evidence rows: high-volume
   (thousands of files → tens of thousands of symbols), rebuilt from the repository, queried
   constantly (neighborhood traversal, symbol lookup, incremental invalidation by hash).
2. **Artifacts** — specifications, analysis runs, approved impact models, review reports, audit /
   supersession history: low-volume, versioned, append-only records (ADR-0002) that humans and
   agents inspect, and whose old versions must remain readable forever.

Additionally, `.impactgraph/` holds human-editable committed YAML configuration (PRD §28.1), which
is not at issue here. PRD §28.2 states plainly: "Use a local SQLite database for: repository index,
symbols, graph nodes, graph edges, …" and PRD §47.15 repeats it as a build instruction ("Use SQLite
for the local index"). PRD §47.14 rules out Neo4j.

Honest note on provenance of this decision: the original setup prompt leaned "JSON-first, avoid a
database until proven necessary." For the **index**, that lean loses to the PRD: §28.2/§47.15 are
explicit mandates, and they are right on the merits — the index's access pattern (point lookups,
partial reads, incremental updates over tens of thousands of rows) is exactly what
load-whole-JSON-into-memory handles worst. The JSON-first instinct survives where it is actually
strong: the artifact store.

## Options Considered

### Option A — Everything in JSON files

- Pros: zero native dependency; every byte human-inspectable and diffable; atomic write via
  write-temp-then-rename is easy; trivially portable.
- Cons: violates PRD §28.2/§47.15 for the index; graph queries require loading the full index into
  memory — incremental update budget (< 3 s, PRD §33) dies on serialize/deserialize of a 5,000-file
  graph; no indexes, so symbol lookup is O(n); concurrent access (extension + CLI) needs hand-rolled
  locking.

### Option B — Everything in SQLite

- Pros: one storage engine, one backup story; artifacts become queryable across runs (e.g. "all
  reviews touching component X") for free; transactional writes everywhere.
- Cons: append-only human-readable records buried in a binary file — inspecting an approved model
  or diffing two analysis runs now requires tooling; blob-in-row storage of large specs is
  unergonomic; schema migrations start applying to _records_ that ADR-0002 says must stay readable
  forever, raising migration risk for data we otherwise never touch; overkill for dozens of
  small documents.

### Option C — Hybrid: SQLite index + JSON artifacts (chosen)

SQLite (via better-sqlite3) for the derived index in non-version-controlled workspace storage
(PRD §28.2); versioned, append-only JSON files for artifacts; YAML in `.impactgraph/` for committed
config (PRD §28.1).

- Pros: each store matches its access pattern — the index gets real queries, transactions, and
  incremental writes; artifacts stay small, human-inspectable, schema-versioned (ADR-0009), and
  atomic-write friendly; the index is a **disposable cache** (rebuildable from the repository, PRD
  §34's "preserve previous valid indexes" applies) while artifacts are **records** — the hybrid
  makes that distinction physical.
- Cons: two persistence code paths in `packages/persistence`; better-sqlite3 is a native module —
  prebuilt binaries must match the VS Code Electron ABI, a real packaging concern; cross-store
  consistency (artifact referencing a snapshot ID in the index) is by ID discipline, not by
  transaction.

## Decision

Option C. `packages/persistence` exposes two ports: an index store (SQLite: nodes, edges, symbols,
hashes, evidence, provider cache per PRD §28.2) and an artifact store (JSON: specifications,
analysis runs, approved models, reviews, audit history — append-only, schema-versioned, atomic
temp-file-rename writes). The index may be deleted and rebuilt at any time; artifacts may not.

**Migration threshold (explicit):** artifacts move into SQLite only when one of these becomes real —
(a) features need **cross-run queries** over artifact content (not just "load run by ID"), or
(b) a per-workspace artifact store grows beyond **~25 MB**, making load-whole-file-and-parse
impractical on the PRD §33 interaction budgets. Until then, JSON artifacts stand.

## Consequences

- Positive: PRD mandate honored; index performance scales with SQL indexes, not JSON parse time;
  artifacts are debuggable with `cat` and reviewable in PRs when exported; the disposable-cache /
  permanent-record boundary is architectural.
- Negative: native-module packaging for the extension must be tested per platform in CI
  (`package-extension` job); two serialization layers to keep schema-versioned; developers must
  learn which store owns what (documented in docs/engineering/artifact-versioning.md).

## Outcome (2026-08-02) — native ABI cost measured, then eliminated

The §42.4 electron lane exercised the extension against a real VS Code 1.131 (Electron 42) and
immediately hit the "Negative" bullet above:

```
better_sqlite3.node was compiled against NODE_MODULE_VERSION 137
(local Node 24); this version of Node.js requires 146 (Electron)
```

Facts worth recording so nobody re-derives them:

1. **It was an ABI mismatch, not code signing.** An earlier investigation attributed the failure
   to macOS hardened-runtime Team IDs; that was wrong and would have sent the fix in the wrong
   direction. The failure is platform-independent — Linux CI and a shipped `.vsix` fail too.
2. **The index worker does not escape it.** `fork()` from the extension host runs Electron's Node
   (`ELECTRON_RUN_AS_NODE=1`), so moving indexing off the host for §33 does not sidestep the ABI.
3. **The CLI was never affected**, running under the system Node the module was built for.

**Resolution: upgrade, not a rebuild step.** The obvious fix was `@electron/rebuild` at package
time. It was implemented, and then deleted, because it turned out to be unnecessary and would
have been permanent complexity for nothing:

- better-sqlite3 **11.x cannot compile against Electron 42 at all** — its C++ predates V8 changes
  (`v8::Context::GetIsolate` removed, `PropertyCallbackInfo::This` gone, new required `tag`
  arguments). A rebuild step would have failed regardless of configuration.
- better-sqlite3 **13.x is built on Node-API** (`node-addon-api` + platform prebuilds with no ABI
  in the filename). Node-API is **ABI-stable across Node versions and Electron**, so one binary
  serves the CLI, the MCP server, vitest, and the extension host.

Upgrading `better-sqlite3` 11.10.0 → 13.0.2 took the electron lane from **24 passed / 15 failed**
to **39 passed / 0 failed** (untrusted lane 4/4) with no rebuild, no `@electron/rebuild`
dependency, no per-platform binaries, and no ABI-switching in the build. The rebuild tooling,
the CI packaging step, and the release-checklist ABI gate were all removed again.

**Consequence for this ADR:** the "native-module packaging must be tested per platform" cost is
now much smaller than assumed — Node-API is the property that makes better-sqlite3 viable for a
VS Code extension. Any future swap to a non-Node-API native module reintroduces the whole
problem, so treat Node-API as a requirement of this decision, not an incidental detail.

## Revisit Trigger

Either migration-threshold condition above; or better-sqlite3 ABI maintenance across VS Code
Electron upgrades costing more than one day per release cycle (then evaluate WASM SQLite as the
adapter swap, not a schema change). With Node-API the ABI-maintenance cost is currently ~zero;
the trigger to watch is a better-sqlite3 major that abandons Node-API, or an Electron upgrade
that breaks the prebuilds.

## Links

- PRD §28.1–28.3, §33, §34, §47.14–15
- Related: ADR-0001, ADR-0002 (append-only records this store must protect), ADR-0004 (both stores
  sit behind ports), ADR-0009 (artifact schema versioning)
- docs/engineering/artifact-versioning.md, docs/engineering/data-contracts.md
