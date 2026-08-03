# ADR-0003: TypeScript as the Primary Implementation Language

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

ImpactGraph ships three apps over one core: a VS Code extension, a CLI, and an MCP server (PRD §1,
§29). The VS Code extension host is a Node.js runtime, so at least the extension shell must be
JavaScript/TypeScript. The first and most accurate language adapter targets TypeScript/JavaScript
itself (PRD §30, §6.1), for which the TypeScript compiler API is the reference implementation
(ADR-0008). The question is whether the shared core (`packages/domain`, `packages/application`,
engines, adapters) is also TypeScript, or whether a second language carries the heavy analysis work.

## Options Considered

### Option A — TypeScript everywhere (chosen)

One language for apps, core, adapters, tooling, and tests; strict mode; Node 22.

- Pros: zero FFI/IPC boundary between extension, CLI, MCP server, and core — one composition-root
  import; the TypeScript compiler API (our primary parser, ADR-0008) is a native dependency;
  Zod-based contracts (ADR-0009) share types end-to-end including the webview; one toolchain for
  lint, test, LOC enforcement (ADR-0012), and release; the team (human + Claude) context-switches
  less; MCP and VS Code ecosystems are TypeScript-first.
- Cons: CPU-bound indexing in Node is slower than Rust/Go — PRD §33 budgets (5,000 files < 2 min,
  incremental < 3 s) must be met with worker processes and incrementality rather than raw speed;
  single-threaded by default, so parallelism is explicit (workers/child processes); memory overhead
  of JS object graphs for large repositories.

### Option B — Rust (or Go) core with a thin TypeScript shell

Analysis engine as a native binary or NAPI module; TS only for the extension/CLI/MCP surfaces.

- Pros: markedly faster indexing and lower memory; tree-sitter is native Rust; a compiled core is
  harder to misuse across boundaries.
- Cons: every domain type exists twice (Rust + TS) with serialization contracts between them —
  directly multiplying the provenance-model surface of ADR-0002; native builds per platform for a
  VS Code extension is real distribution pain (see the same reasoning in ADR-0007 against native
  git bindings); the TS compiler API — our best parser — lives in Node anyway, so the "fast core"
  still round-trips into JS for the most important language; contributor and agent velocity drops.

### Option C — TypeScript core, Python for AI/heuristic components

- Pros: Python ML ecosystem for embeddings/heuristics.
- Cons: PRD §8 requires provider-independent structured-output calls, not local ML — nothing in V1
  needs Python; shipping a Python runtime inside a VS Code extension is worse than any benefit;
  two-language contracts for AI payloads undermine the single validated boundary of ADR-0010.

## Decision

Option A. TypeScript (strict) on Node 22 for every app, package, script, and test in the monorepo
(ADR-0013). Performance risk is handled architecturally: indexing runs in worker/child processes,
never the extension host (PRD §33), work is incremental and cancellable, and hot paths are measured
against the budgets in docs/engineering/performance-budgets.md before any rewrite discussion.

## Consequences

- Positive: one type system spans domain → contracts → webview; parser fidelity for TS/JS is maximal;
  tooling (ESLint boundaries, Vitest, tsx scripts) is uniform; Claude Code operates in a single
  well-supported language.
- Negative: we accept a performance ceiling and must engineer around it (workers, SQLite index per
  ADR-0006, progressive disclosure per PRD §33); if a future adapter needs a native parser, it enters
  via WASM (tree-sitter, ADR-0008) rather than platform binaries, which costs some speed.

## Revisit Trigger

Measured, repeated failure of PRD §33 budgets on representative repositories after worker-based
parallelism and incremental indexing are exhausted — the escape hatch is a WASM/native module behind
an existing port, not a core rewrite.

## Links

- PRD §6.1, §8, §29, §30, §33
- Related: ADR-0004 (ports keep an escape hatch open), ADR-0007, ADR-0008, ADR-0012, ADR-0013
- docs/engineering/architecture.md, docs/engineering/performance-budgets.md
