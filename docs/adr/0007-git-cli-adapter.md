# ADR-0007: Git Access via the Git CLI Behind an Adapter

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** Project maintainer, Claude Code setup

## Context

Git is load-bearing for ImpactGraph: review compares the approved impact model against the actual
diff and working tree (PRD §10.5, §22–24), `git-history` is a provenance type (PRD §12.3), file
hashes and snapshot IDs anchor every analysis run (ADR-0002), and repositories in scope include
multi-app monorepos with potentially unusual layouts (PRD §6.3). We need accurate diffs — including
rename/copy detection — status, blame-adjacent history queries, and stable snapshot identification,
from within a VS Code extension, a CLI, and an MCP server on user machines.

## Options Considered

### Option A — Git CLI via a controlled adapter (chosen)

`packages/git` spawns the user's `git` binary with args passed **as an array** (never shell
interpolation), preferring plumbing commands with NUL-terminated output.

- Pros: **fidelity** — the CLI is the reference implementation; rename/copy detection
  (`-M`/`-C`), pathspecs, sparse checkouts, worktrees, and submodules behave exactly as the user's
  git behaves, which matters because review verdicts (matched / missing / unexpected, PRD §38.2)
  must agree with what the developer sees in their own tooling; **zero native-build pain** — no
  compiled dependency in the extension package (a lesson also applied in ADR-0006's cons list);
  developers using ImpactGraph have git installed by definition of the product.
- Cons: parsing porcelain/plumbing text output is a real contract with git's formatting; PATH
  dependency — git version and availability vary per machine; process-spawn overhead per call;
  behavior differences across git versions can leak in.

### Option B — isomorphic-git (pure JS)

- Pros: no external binary, fully deterministic dependency; runs anywhere Node runs; no
  output-parsing — structured API.
- Cons: incomplete fidelity for exactly our needs — rename/copy detection, full pathspec semantics,
  and submodule support are weak or absent; reimplements git in JS, so subtle divergence from the
  user's git is possible on the diffs we score reviews with; performance on large repositories lags
  the CLI significantly.

### Option C — nodegit / libgit2 bindings

- Pros: fast, structured API over the canonical C library; no text parsing.
- Cons: native module compiled against libgit2 **and** the Electron ABI — historically the single
  most painful dependency class for VS Code extensions (build matrix, ABI breaks on VS Code
  updates); libgit2 itself trails git CLI features (notably around newer diff heuristics and
  submodule edge cases); maintenance status of the bindings has been unreliable.

## Decision

Option A. `packages/git` is the only place in the codebase that invokes git (enforced by lint —
see `.claude/CLAUDE.md` rule 3). Implementation discipline:

- Args always as arrays to `child_process` variants that do not use a shell.
- Prefer plumbing over porcelain, with `-z` (NUL termination) wherever supported
  (`git status -z`, `git diff --name-status -z -M`), so filenames with spaces/newlines parse safely.
- Detect and record the git version at adapter startup; fail with a clear message below the
  supported floor.
- **Contract tests**: a fixture-repository suite (PRD §42.2) exercises every parsed command shape —
  renames, copies, binary files, submodule pointers, exotic filenames — so a git upgrade that
  changes output breaks CI, not review results.
- Repository content, including filenames and commit messages, is untrusted data (PRD §35).

## Consequences

- Positive: review diffs match the user's own git exactly; no native packaging burden; the adapter
  boundary (ADR-0004) keeps every parsing decision in one tested package; MCP server and CLI reuse
  it unchanged.
- Negative: we own a text-parsing contract with git and must maintain the version floor and contract
  tests; environments without git on PATH (rare for our users, possible in odd CI) fail — the error
  path must be explicit; per-call process spawn means batching matters on hot paths (status + diff
  in one review pass, not per-file calls).

## Revisit Trigger

If contract tests reveal sustained cross-version parsing instability, or a required capability
(e.g. reading packfiles without a checkout) exceeds what the CLI exposes cleanly — then re-evaluate
libgit2 via WASM before native bindings.

## Links

- PRD §6.3, §10.5, §12.3, §22–24, §35, §38.2, §42.2
- Related: ADR-0002 (git-history provenance), ADR-0004 (adapter boundary), ADR-0006 (same
  no-native-modules lean, and the one exception made there)
- docs/engineering/implementation-review.md, docs/engineering/testing-strategy.md
