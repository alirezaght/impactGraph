# MCP Workspace Coverage Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `analyze_impact` (and the shared engine) detects insufficient repository coverage, withholds the readiness score with an explicit `insufficient-coverage` status, reports indexed/missing/candidate repositories, returns machine-readable required next actions, auto-indexes registered workspace repositories, and the MCP server states the expected workflow.

**Architecture:** A pure coverage-sufficiency verdict lives in `packages/domain` (like `computeReadiness`). `packages/workspace-engine` assembles the workspace context (repository roster, per-repo index state, unregistered candidate discovery), feeds it into the bounded summary builder, and loops indexing over `indexableRoots(roster)` (currently dead code). `packages/contracts` gains additive-optional v1 fields (`workspaceCoverage`, `requiredActions`, per-repo arrays on index/status outputs) plus a server-instructions constant. `apps/mcp-server` wires auto-indexing into `analyze_impact` and sends `instructions` on `initialize`.

**Tech Stack:** TypeScript, Zod contracts, Vitest, better-sqlite3 store (unchanged — no persisted schema change; per-repo index state is DERIVED from current-snapshot file hashes by path prefix).

## Global Constraints

- Effective LOC ≤ 300 per source file — new logic goes in new focused modules.
- No persisted schema changes; contract changes are additive-optional on v1 documents.
- Registered repository paths must stay inside the workspace root (existing security rule, unchanged). Candidates are reported, never auto-indexed.
- Deterministic core: everything here works offline with no AI provider.
- Both-end Zod validation (ADR-0009); regenerate committed JSON Schemas.
- Test-first at domain/application layers; MCP flow tests against real temp git repos (existing pattern).
- Conventional Commits; human approval required for the contract additions (flagged in final report).

---

### Task 1: Domain — coverage-sufficiency verdict

**Files:**
- Create: `packages/domain/src/impact/workspace-coverage.ts`
- Create: `packages/domain/src/impact/workspace-coverage.test.ts`
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces (Produces):**
```ts
export type WorkspaceCoverageStatus = 'adequate' | 'insufficient-coverage';
export interface CoverageSufficiencyInput {
  readonly requirementCount: number;
  readonly unmatchedRequirementCount: number;
  readonly totalConceptCount: number;
  readonly unresolvedConceptCount: number;
  readonly missingRepositoryCount: number;
}
export interface WorkspaceCoverageVerdict {
  readonly status: WorkspaceCoverageStatus;
  readonly reasons: readonly string[];
}
export const assessCoverageSufficiency = (input: CoverageSufficiencyInput): WorkspaceCoverageVerdict
```

Rules (each reason is one sentence naming the numbers):
- `requirementCount === 0` → adequate (empty spec is readiness's job).
- unmatched ratio ≥ 0.5 → insufficient ("N of M requirements match no indexed component").
- `totalConceptCount > 0` and every concept unresolved → insufficient ("none of the K specification concepts resolve to any indexed component").
- `missingRepositoryCount > 0 && unmatchedRequirementCount > 0` → insufficient ("R registered repositories are not in the index while N requirements are unmatched").
- otherwise adequate, reasons empty.

- [ ] Failing tests: adequate on zero requirements; adequate on well-matched; insufficient at exactly 50% unmatched; insufficient when all concepts unresolved; insufficient on missing repos + any unmatched; reasons text pinned.
- [ ] Implement pure function (no I/O, no Date).
- [ ] `pnpm vitest run --project unit packages/domain/src/impact/workspace-coverage.test.ts` green.
- [ ] Commit `feat(domain): deterministic workspace coverage sufficiency verdict`.

### Task 2: Contracts — coverage block, required actions, per-repo outputs, server instructions, tool descriptions

**Files:**
- Create: `packages/contracts/src/tools/guidance.ts` (`MCP_SERVER_INSTRUCTIONS`)
- Modify: `packages/contracts/src/cli/impact-summary.ts` (add `workspaceCoverageSchema`, `requiredActionSchema`; extend `cliImpactSummarySchema` with `workspaceCoverage` + `requiredActions`, both `.optional()` additive v1)
- Modify: `packages/contracts/src/cli/outputs.ts` (`repositoryIndexStateSchema`; `cliIndexOutputSchema.repositories?`, `cliStatusOutputSchema.repositories?` + `candidateRepositories?`)
- Modify: `packages/contracts/src/tools/tools.ts` (descriptions for `index_workspace`, `get_workspace_status`, `analyze_impact`)
- Modify: `packages/contracts/src/index.ts` (exports)
- Tests: `packages/contracts/src/tools/tools.test.ts`, new `packages/contracts/src/cli/workspace-coverage.test.ts`
- Regenerate committed JSON Schemas (`packages/contracts/schemas/…`).

**Interfaces (Produces):**
```ts
export const requiredActionSchema = z.object({
  action: z.enum(['refresh-stale-index','index-registered-repositories','register-missing-repositories','confirm-candidate-repositories','report-limited-scope']),
  reason: z.string().min(1),
  instruction: z.string().min(1),          // imperative sentence for the coding agent
  repositories: z.array(z.string().min(1)).optional(),
}).strict();

export const workspaceCoverageSchema = z.object({
  status: z.enum(['adequate','insufficient-coverage']),
  reasons: z.array(z.string().min(1)),
  repositories: z.object({
    indexed: z.array(z.object({ name: z.string().min(1), path: z.string().min(1).optional(), fileCount: z.number().int().min(0) }).strict()),
    registeredButMissing: z.array(z.object({ name: z.string().min(1), reason: z.string().min(1) }).strict()),
    candidates: z.array(z.object({ name: z.string().min(1), path: z.string().min(1), hint: z.string().min(1) }).strict()),
  }).strict(),
  affectedRequirementIds: z.array(z.string().min(1)),
  affectedConcepts: z.array(z.string().min(1)),
}).strict();

export const repositoryIndexStateSchema = z.object({
  name: z.string().min(1), path: z.string().min(1).optional(),
  indexed: z.boolean(), fileCount: z.number().int().min(0),
  reason: z.string().min(1).optional(),
}).strict();
```

`MCP_SERVER_INSTRUCTIONS` states the 5-step workflow: (1) `get_workspace_status` to validate coverage, (2) `index_workspace` (indexes root + every registered repository), (3) verify central concepts resolve (`find_components`), (4) `analyze_impact` — if `workspaceCoverage.status === 'insufficient-coverage'` readiness is withheld and `requiredActions` must be followed before trusting impacts, (5) present limitations when complete coverage is impossible. Also: never treat a partial graph as the final answer; candidates require user confirmation.

- [ ] Failing contract tests: schemas accept/reject shape samples; instructions mention all five steps and 'insufficient-coverage'; updated descriptions mention registered repositories / coverage validation / requiredActions.
- [ ] Implement schemas + instructions + description edits; regenerate JSON Schemas.
- [ ] `pnpm vitest run --project contract` green.
- [ ] Commit `feat(contracts): workspace coverage status, required actions and MCP workflow guidance`.

### Task 3: repository-intelligence — multi-root scan merged into one snapshot graph

**Files:**
- Create: `packages/repository-intelligence/src/scanner/multi-root.ts`
- Modify: `packages/repository-intelligence/src/index-repository.ts` (`additionalRoots?: readonly {name, rootDir, relativePrefix}[]` on request; `IndexSummary.rootFileCounts?: readonly {name, fileCount}[]`)
- Test: `packages/repository-intelligence/src/scanner/multi-root.test.ts` (+ index-repository multi-root case)

**Interfaces (Produces):**
```ts
export interface AdditionalRoot { readonly name: string; readonly rootDir: string; readonly relativePrefix: string; }
export const scanRoots = (rootDir: string, additionalRoots: readonly AdditionalRoot[], options: ScanOptions): ScanResult & { rootFileCounts: readonly {name: string; fileCount: number}[] }
```
Main root scanned with the additional roots' prefixes excluded (ignore globs); each additional root scanned from its own directory (own `.gitignore` chain) and rebased under `relativePrefix`; results merged, files de-duplicated by `relativePath`. Single-root behavior byte-identical (goldens must not change).

- [ ] Failing tests on a temp fixture (root + two subdirectory repos): merged file list carries prefixed paths; excluded root double-scan; per-root counts; disabled/absent roots simply not passed in.
- [ ] Implement; verify `pnpm vitest run --project analyzers` (goldens untouched).
- [ ] Commit `feat(repository-intelligence): index additional registered roots into the workspace snapshot`.

### Task 4: workspace-engine — roster-driven indexing, discovery, per-repo index state

**Files:**
- Create: `packages/workspace-engine/src/repository-discovery.ts`
- Create: `packages/workspace-engine/src/repository-coverage.ts`
- Modify: `packages/workspace-engine/src/indexing.ts` (read roster, pass `additionalRoots`, return `repositories` on outcome)
- Modify: `packages/workspace-engine/src/index.ts` (exports)
- Tests: `packages/workspace-engine/src/repository-discovery.test.ts`, `packages/workspace-engine/src/repository-coverage.test.ts` (temp dirs, real store)

**Interfaces (Produces):**
```ts
// repository-discovery.ts — unregistered candidates, NEVER indexed automatically
export interface CandidateRepository { readonly name: string; readonly path: string; readonly hint: string; }
export const discoverCandidateRepositories = (rootDir: string, roster: RepositoryRoster): readonly CandidateRepository[]
// depth-1 subdirectories containing .git, excluding registered members and the root itself

// repository-coverage.ts — DERIVED per-repo index state (no schema change)
export interface RepositoryIndexState { readonly name: string; readonly path?: string; readonly indexed: boolean; readonly fileCount: number; readonly reason?: string; }
export interface WorkspaceRepositoryContext {
  readonly repositories: readonly RepositoryIndexState[];       // roster members with indexed/fileCount from current-snapshot file hashes by prefix
  readonly missing: readonly {name: string; reason: string}[];  // registered, enabled, absent or unindexed
  readonly candidates: readonly CandidateRepository[];
  readonly limitations: readonly string[];                      // roster limitations
}
export const collectWorkspaceRepositoryContext = async (rootDir: string): Promise<Failable<WorkspaceRepositoryContext>>
export const ensureRegisteredRepositoriesIndexed = async (rootDir: string): Promise<Failable<{ reindexed: boolean }>>
// reindexes (performIndexRun) iff the store has a current snapshot AND an enabled+present member has zero files under its prefix
```
`performIndexRun` outcome gains `repositories: readonly RepositoryIndexState[]` (from `rootFileCounts` + roster).

- [ ] Failing tests: discovery finds unregistered git dir, skips registered ones; context reports indexed/missing per member; `ensureRegisteredRepositoriesIndexed` reindexes exactly when a registered member is absent from the snapshot; multi-root `performIndexRun` produces one graph containing both repos' files.
- [ ] Implement; run engine test project.
- [ ] Commit `feat(workspace-engine): roster-driven multi-root indexing, candidate discovery and per-repo index state`.

### Task 5: workspace-engine reports — coverage block, required actions, readiness withholding

**Files:**
- Create: `packages/workspace-engine/src/reports/workspace-coverage-block.ts`
- Create: `packages/workspace-engine/src/reports/required-actions.ts`
- Modify: `packages/workspace-engine/src/reports/impact-summary.ts` (accept optional `workspace?: WorkspaceRepositoryContext`; emit `workspaceCoverage` + `requiredActions`; withhold readiness on insufficient; add coverage reasons to `provisionalReasons`; add roster limitations to `impactQuery.limitations`)
- Modify: `packages/workspace-engine/src/reports/impact-summary-facts.ts` (add `conceptResolution(specification, analysis)` → `{ totalConceptCount, unresolvedConceptCount, unresolvedConceptNames }` counting distinct requirement concepts named by `unknown-concept`/`unresolved-concept` warnings)
- Tests: `packages/workspace-engine/src/reports/workspace-coverage-block.test.ts`, `required-actions.test.ts`

**Interfaces (Produces):**
```ts
export const buildWorkspaceCoverage = (input: { specification; analysis; context?: WorkspaceRepositoryContext }): CliImpactSummary['workspaceCoverage']  // uses domain assessCoverageSufficiency
export const buildRequiredActions = (input: { coverage; freshness; context?: WorkspaceRepositoryContext }): CliImpactSummary['requiredActions']
```
Action derivation order: `refresh-stale-index` (freshness.stale) → `index-registered-repositories` (enabled+present member unindexed) → `register-missing-repositories` (roster.absent) → `confirm-candidate-repositories` (candidates exist AND status insufficient) → `report-limited-scope` (insufficient and nothing else actionable). Readiness withholding precedence: provisional extraction message (existing) wins; else insufficient coverage → `readinessWithheldReason: 'Repository coverage is insufficient — a readiness score over a graph that is missing the feature's repositories would be misleading. Follow requiredActions and re-run the analysis.'`

- [ ] Failing tests: insufficient → readiness absent + withheld reason + provisional true with coverage reason; adequate → readiness present, `report-limited-scope` absent; each action trigger pinned; both blocks always emitted (empty-arrays allowed).
- [ ] Implement; wire `buildImpactSummary`.
- [ ] Commit `feat(workspace-engine): coverage verdict, required actions and readiness withholding in the bounded summary`.

### Task 6: MCP server — auto-index, per-repo outputs, server instructions

**Files:**
- Modify: `apps/mcp-server/src/registry-impacts.ts` (analyze: `ensureRegisteredRepositoriesIndexed` before building; pass `workspace` context into summary)
- Modify: `apps/mcp-server/src/registry.ts` (index/status handlers emit `repositories` / `candidateRepositories`)
- Modify: `apps/mcp-server/src/server.ts` (`initialize` → `instructions: MCP_SERVER_INSTRUCTIONS`)
- Modify: `apps/cli/src/commands/analyze.ts`, `index-command.ts`, `status.ts` (pass context / emit new optional fields so CLI and MCP stay one contract)
- Tests: new `apps/mcp-server/src/registry-coverage.test.ts` (temp multi-repo workspace), `apps/mcp-server/src/server.test.ts` (instructions asserted)

- [ ] Failing tests covering the user's list:
  - multi-repo feature: two registered subrepos, spec concepts hitting both → impacts span both roots, status adequate;
  - missing sibling: registered-but-absent → `registeredButMissing` + `register-missing-repositories`;
  - unresolved central concepts → insufficient-coverage;
  - most requirements unmatched → insufficient-coverage + readiness withheld (`specification.readiness` absent);
  - automatic workspace indexing: register repo after index → `analyze_impact` reindexes and the summary's indexed repositories include it;
  - requiredActions machine-readable (action enum asserted);
  - candidate discovery → `confirm-candidate-repositories` with instruction to ask the user;
  - misleading-partial prevention: insufficient → `analysis.provisional` true with coverage reason and limitations mention the roster.
- [ ] Implement handlers + instructions.
- [ ] `pnpm vitest run --project cli` (mcp-server suites live there per vitest.config) green.
- [ ] Commit `feat(mcp): coverage-gated analysis, auto-indexed registered repositories and workflow instructions`.

### Task 7: Docs + gates

- Modify: `README.md` (MCP section: the 5-step workflow), `docs/workflows/claude-code.md`, `docs/engineering/data-contracts.md` (additive v1 fields note)
- [ ] `pnpm quality:gates` fully green.
- [ ] Commit `docs: coverage-first MCP workflow`.

## Self-review

Spec coverage: every numbered requirement in the submitted specification maps to Tasks 1–6 (see test list in Task 6); non-goals respected (candidates never auto-indexed; no provenance change; no persisted-schema change). Types consistent: `WorkspaceRepositoryContext` produced in Task 4 and consumed in Tasks 5–6; `workspaceCoverage`/`requiredActions` schema names identical across Tasks 2/5/6.

## Known limitations (report at the end)

- The workspace root must itself be a git repository; registered repositories are subdirectories of it (existing security rule). True filesystem siblings (`../repo`) still require the user to open a common parent as the workspace root — the candidates mechanism + instructions tell the agent to ask for exactly that.
- Freshness and co-change history are computed from the workspace root's git only.
- The CLI `analyze --full` document keeps its existing readiness behavior; the bounded summary (MCP + default CLI) is the coverage-gated surface.
